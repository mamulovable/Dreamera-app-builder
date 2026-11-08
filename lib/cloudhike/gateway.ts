// The data API of generated apps. An app can't hold its database or storage
// credentials, since anyone can read them out of an app, and CloudHike has nowhere
// to run server code for it yet. So this site holds them and answers for the app.

import { createHash } from "node:crypto"
import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { and, eq, sql } from "drizzle-orm"
import postgres from "postgres"

import { db, projectBackends, projects } from "@/db"
import type { DataCollection } from "@/lib/agent-protocol"
import {
  CREATE_VALUES_TABLE,
  LEGACY_BACKUP_TABLE,
  LEGACY_TABLE,
  RecordInputError,
  VALUES_TABLE,
  addColumnSql,
  addForeignKeySql,
  appTables,
  columnsFromRequest,
  columnsFromStored,
  createTableSql,
  quote,
  rowToDocument,
  type AppColumn,
  type AppTable,
} from "@/lib/cloudhike/app-schema"
import { unseal } from "@/lib/cloudhike/crypto"

export type AppEnvironment = Record<string, string | undefined>

const MAX_CONNECTED_APPS = 25
// One app's share of its database's connections, on a server with many apps.
const POOL_SIZE = 2

type AppConnection = {
  sealed: string
  env: AppEnvironment
  sql: postgres.Sql | null
  s3: S3Client | null
  /** The collections this process last brought the database up to date with. */
  prepared: { signature: string; done: Promise<void> } | null
}

// Kept across dev hot reloads, so each one doesn't leave pools connected.
const globalForApps = globalThis as unknown as { appforgeApps?: Map<string, AppConnection> }
const connections = (globalForApps.appforgeApps ??= new Map<string, AppConnection>())

function connect(url: string) {
  return postgres(url, { prepare: false, max: POOL_SIZE, idle_timeout: 60, connect_timeout: 10, onnotice: () => {} })
}

function forget(projectId: string) {
  const connection = connections.get(projectId)
  connections.delete(projectId)
  connection?.sql?.end({ timeout: 5 }).catch(() => {})
}

/** Closes an app's connections, after it's disconnected or its credentials changed. */
export const closeAppConnection = forget

function connectionFor(projectId: string, sealed: string) {
  const known = connections.get(projectId)
  if (known?.sealed === sealed) {
    // Most recently used goes last, so the first one is the one to close.
    connections.delete(projectId)
    connections.set(projectId, known)
    return known
  }
  if (known) forget(projectId)

  const env = JSON.parse(unseal(sealed)) as AppEnvironment
  const connection: AppConnection = {
    sealed,
    env,
    sql: env.DATABASE_URL ? connect(env.DATABASE_URL) : null,
    s3:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? new S3Client({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            forcePathStyle: true,
            credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
          })
        : null,
    prepared: null,
  }
  connections.set(projectId, connection)
  if (connections.size > MAX_CONNECTED_APPS) forget(connections.keys().next().value!)
  return connection
}

export type GatewayApp = { connection: AppConnection; env: AppEnvironment; sql: postgres.Sql | null; s3: S3Client | null; collections: DataCollection[]; tables: Map<string, AppTable> }

/** A connected app's credentials and the tables of its collections, or null if it isn't connected. */
export async function getGatewayApp(projectId: string): Promise<GatewayApp | null> {
  const [row] = await db
    .select({
      environment: projectBackends.environment,
      collections: sql<DataCollection[] | null>`${projects.plan}->'collections'`,
    })
    .from(projectBackends)
    .innerJoin(projects, eq(projects.id, projectBackends.projectId))
    .where(and(eq(projectBackends.projectId, projectId), eq(projectBackends.state, "ready")))
  if (!row?.environment) return null
  const connection = connectionFor(projectId, row.environment)
  const collections = row.collections ?? []
  return { connection, env: connection.env, sql: connection.sql, s3: connection.s3, collections, tables: appTables(collections) }
}

/**
 * Makes sure the tables match the plan before a request uses them, once per process
 * for each version of the plan. That covers an app whose plan just changed, and an
 * app from before tables existed, whose records move into them on its first request.
 */
export function ensureAppDatabase({ connection, env, collections }: GatewayApp) {
  const signature = JSON.stringify(collections)
  if (connection.prepared?.signature !== signature) {
    const prepared = { signature, done: prepareAppDatabase(env, collections) }
    connection.prepared = prepared
    prepared.done.catch(() => {
      if (connection.prepared === prepared) connection.prepared = null
    })
  }
  return connection.prepared!.done
}

// --- Records ---------------------------------------------------------------

/** Who a request acts as. Records belong to a person when they're signed in, and otherwise to one install. */
export type Owner = { id: string; email: string | null; signedIn: boolean }

export function deviceOwner(deviceId: string): Owner {
  return { id: `device:${createHash("sha256").update(deviceId).digest("hex")}`, email: null, signedIn: false }
}

export function userOwner(user: { id: string; email: string }): Owner {
  return { id: `user:${user.id}`, email: user.email, signedIn: true }
}

/** Sample records of shared collections belong to nobody, so nobody can change them. */
const SAMPLE_OWNER = ""

/** Keeps one install from filling a database that its owner pays for. */
const MAX_RECORDS_PER_OWNER = 5000
const MAX_LIST = 500
const INSERT_BATCH = 200
/** Only one process changes an app's tables at a time. */
const PREPARE_LOCK = 7206114
const FOREIGN_KEY_VIOLATION = "23503"

export class RecordLimitError extends Error {}

type Row = Record<string, unknown>

/** The fields a request may set. Identity and timestamps are the server's. */
export function cleanFields(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = input as Record<string, unknown>
  return fields
}

function foreignKeyName(table: AppTable, column: AppColumn) {
  return `appforge_fk_${createHash("sha256").update(`${table.name}.${column.column}`).digest("hex").slice(0, 16)}`
}

/** Adds rows that all have the same columns. One already there stays as it is. */
async function insertRows(tx: postgres.TransactionSql, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH) as postgres.MaybeRow[]
    await tx`insert into ${tx(table)} ${tx(batch as never)} on conflict do nothing`
  }
}

/** Moves an app's records out of the one table they used to share, and keeps that table as a backup. */
async function moveLegacyRecords(tx: postgres.TransactionSql, tables: Map<string, AppTable>) {
  const [{ legacy }] = await tx<{ legacy: string | null }[]>`select to_regclass(${quote(LEGACY_TABLE)})::text as legacy`
  if (!legacy) return

  for (const table of tables.values()) {
    const rows = await tx<{ owner: string; id: string; data: Row; created_at: Date; updated_at: Date }[]>`
      select owner, id, data, created_at, updated_at from ${tx(LEGACY_TABLE)} where collection = ${table.collection}`
    await insertRows(
      tx,
      table.name,
      rows.map(({ owner, id, data, created_at, updated_at }) => ({
        id,
        owner_id: owner,
        created_at,
        updated_at,
        ...columnsFromStored(table, data),
      }))
    )
  }
  await tx`
    insert into ${tx(VALUES_TABLE)} (owner_id, key, value, created_at, updated_at)
    select owner, id, data->'value', created_at, updated_at from ${tx(LEGACY_TABLE)} where collection = '$values'
    on conflict do nothing`
  await tx.unsafe(`alter table ${quote(LEGACY_TABLE)} rename to ${quote(LEGACY_BACKUP_TABLE)}`)
}

/** Adds what the collections need that the database doesn't have yet. Only runs DDL when something is missing. */
async function updateTables(tx: postgres.TransactionSql, tables: Map<string, AppTable>) {
  const list = [...tables.values()]
  const names = list.map((table) => table.name)
  const existing = await tx<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = current_schema() and table_name in ${tx(names.length > 0 ? names : [""])}`
  const hasTable = new Set(existing.map((row) => row.table_name))
  const hasColumn = new Set(existing.map((row) => `${row.table_name}.${row.column_name}`))

  for (const table of list) {
    if (!hasTable.has(table.name)) {
      for (const statement of createTableSql(table)) await tx.unsafe(statement)
    }
    for (const column of table.columns) {
      if (!hasColumn.has(`${table.name}.${column.column}`)) await tx.unsafe(addColumnSql(table, column))
    }
  }
}

/** After records have moved, since a link that doesn't fit shouldn't stop them moving. */
async function addForeignKeys(tx: postgres.TransactionSql, tables: Map<string, AppTable>) {
  const constraints = await tx<{ conname: string }[]>`
    select conname from pg_constraint where connamespace = current_schema()::regnamespace and conname like 'appforge_fk_%'`
  const has = new Set(constraints.map((row) => row.conname))
  for (const table of tables.values()) {
    for (const column of table.columns) {
      const name = foreignKeyName(table, column)
      if (column.references && !has.has(name)) await tx.unsafe(addForeignKeySql(table, column, name))
    }
  }
}

/** Samples can point to each other in any order, and to a record that's private, so isn't there: those links are emptied. */
async function insertSamples(tx: postgres.TransactionSql, tables: Map<string, AppTable>) {
  await tx`set constraints all deferred`
  for (const table of tables.values()) {
    if (!table.shared) continue
    await insertRows(
      tx,
      table.name,
      table.items.map(({ id, ...fields }) => ({ id: String(id), owner_id: SAMPLE_OWNER, ...columnsFromStored(table, fields) }))
    )
  }
  for (const table of tables.values()) {
    if (!table.shared) continue
    for (const { column, references } of table.columns) {
      if (!references) continue
      await tx`
        update ${tx(table.name)} set ${tx(column)} = null
        where owner_id = ${SAMPLE_OWNER} and ${tx(column)} is not null
          and not exists (select 1 from ${tx(references)} target where target.id = ${tx(table.name)}.${tx(column)})`
    }
  }
}

/**
 * Brings the app's database up to date with its collections: a table for each and
 * a column for each field, the links between them, and the sample records of shared
 * ones. Safe to run again, and all of it happens or none of it does.
 */
export async function prepareAppDatabase(env: AppEnvironment, collections: DataCollection[]) {
  const url = env.DIRECT_URL || env.DATABASE_URL
  if (!url) throw new Error("The project has no database.")
  const tables = appTables(collections)
  const client = connect(url)
  try {
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${PREPARE_LOCK})`
      await tx.unsafe(CREATE_VALUES_TABLE)
      await updateTables(tx, tables)
      await moveLegacyRecords(tx, tables)
      await addForeignKeys(tx, tables)
      await insertSamples(tx, tables)
    })
  } finally {
    await client.end({ timeout: 5 }).catch(() => {})
  }
}

/** A link to a record that isn't there, in words the app can show. */
function linkError(error: unknown, table: AppTable) {
  return (error as { code?: string })?.code === FOREIGN_KEY_VIOLATION
    ? new RecordInputError(`This ${table.collection} record points to something that no longer exists.`)
    : error
}

export async function listRecords(client: postgres.Sql, table: AppTable, owner: Owner) {
  const rows = await client<Row[]>`
    select * from ${client(table.name)}
    ${table.shared ? client`` : client`where owner_id = ${owner.id}`}
    order by created_at desc, id
    limit ${MAX_LIST}`
  return rows.map((row) => rowToDocument(table, row))
}

export async function getRecord(client: postgres.Sql, table: AppTable, id: string, owner: Owner) {
  const [row] = await client<Row[]>`
    select * from ${client(table.name)}
    where id = ${id} ${table.shared ? client`` : client`and owner_id = ${owner.id}`}
    limit 1`
  return row ? rowToDocument(table, row) : null
}

export async function insertRecord(client: postgres.Sql, table: AppTable, id: string, owner: Owner, fields: Row) {
  const values = columnsFromRequest(table, fields)
  const [{ count }] = await client<{ count: number }[]>`
    select count(*)::int as count from ${client(table.name)} where owner_id = ${owner.id}`
  if (count >= MAX_RECORDS_PER_OWNER) throw new RecordLimitError(`This collection is limited to ${MAX_RECORDS_PER_OWNER} records per person.`)
  try {
    const [row] = await client<Row[]>`
      insert into ${client(table.name)} ${client({ id, owner_id: owner.id, ...values } as never)}
      returning *`
    return rowToDocument(table, row)
  } catch (error) {
    throw linkError(error, table)
  }
}

/** Only the owner can change a record, even in a shared collection. */
export async function updateRecord(client: postgres.Sql, table: AppTable, id: string, owner: Owner, fields: Row) {
  const values = columnsFromRequest(table, fields)
  try {
    const [row] = await client<Row[]>`
      update ${client(table.name)} set ${client({ ...values, updated_at: new Date() } as never)}
      where owner_id = ${owner.id} and id = ${id}
      returning *`
    return row ? rowToDocument(table, row) : null
  } catch (error) {
    throw linkError(error, table)
  }
}

export async function deleteRecord(client: postgres.Sql, table: AppTable, id: string, owner: Owner) {
  await client`delete from ${client(table.name)} where owner_id = ${owner.id} and id = ${id}`
}

export async function getValue(client: postgres.Sql, key: string, owner: Owner) {
  const [row] = await client<{ value: unknown }[]>`
    select value from ${client(VALUES_TABLE)} where owner_id = ${owner.id} and key = ${key}`
  return row?.value ?? null
}

export async function setValue(client: postgres.Sql, key: string, owner: Owner, value: unknown) {
  await client`
    insert into ${client(VALUES_TABLE)} (owner_id, key, value)
    values (${owner.id}, ${key}, ${client.json(value as postgres.JSONValue)})
    on conflict (owner_id, key) do update set value = excluded.value, updated_at = now()`
}

export async function deleteValue(client: postgres.Sql, key: string, owner: Owner) {
  await client`delete from ${client(VALUES_TABLE)} where owner_id = ${owner.id} and key = ${key}`
}

// --- Files -----------------------------------------------------------------

const DOWNLOAD_SECONDS = 60 * 60
const UPLOAD_SECONDS = 60 * 10

// The bucket also holds the database's backups, so only this shape of key can ever be served.
const UPLOAD_KEY = /^uploads\/[a-f0-9]{16}\/[A-Za-z0-9_.-]+$/

export function isUploadKey(key: string) {
  return UPLOAD_KEY.test(key) && !key.includes("..")
}

export function ownerFolder(owner: Owner) {
  return createHash("sha256").update(owner.id).digest("hex").slice(0, 16)
}

export function fileUploadUrl(app: GatewayApp, key: string, contentType: string) {
  return getSignedUrl(app.s3!, new PutObjectCommand({ Bucket: app.env.S3_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: UPLOAD_SECONDS,
  })
}

export function fileDownloadUrl(app: GatewayApp, key: string) {
  return getSignedUrl(app.s3!, new GetObjectCommand({ Bucket: app.env.S3_BUCKET, Key: key }), { expiresIn: DOWNLOAD_SECONDS })
}

export async function deleteFile(app: GatewayApp, key: string) {
  await app.s3!.send(new DeleteObjectCommand({ Bucket: app.env.S3_BUCKET, Key: key }))
}

// --- Signed-in people ------------------------------------------------------

const SESSION_CACHE_MS = 60_000
const MAX_CACHED_SESSIONS = 2000
const sessions = new Map<string, { owner: Owner | null; expires: number }>()

/** Who a CloudHike Auth token belongs to, or null if it isn't valid. Checked once a minute per token. */
export async function ownerFromToken(env: AppEnvironment, token: string): Promise<Owner | null> {
  if (!env.AUTH_URL || !env.AUTH_PUBLISHABLE_KEY) return null
  const cacheKey = createHash("sha256").update(`${env.AUTH_URL}:${token}`).digest("hex")
  const cached = sessions.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.owner

  const response = await fetch(`${env.AUTH_URL.replace(/\/$/, "")}/get-session`, {
    headers: { "x-api-key": env.AUTH_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (response.status >= 500) throw new Error(`CloudHike Auth answered ${response.status}.`)
  const data = response.ok ? await response.json().catch(() => null) : null
  const owner = data?.user?.id ? userOwner(data.user) : null

  if (sessions.size >= MAX_CACHED_SESSIONS) sessions.clear()
  sessions.set(cacheKey, { owner, expires: Date.now() + SESSION_CACHE_MS })
  return owner
}

// --- Rate limit ------------------------------------------------------------

const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 1200
const rates = new Map<string, { count: number; resets: number }>()

/** A per-process guard against one address hammering an app's database. */
export function isRateLimited(projectId: string, address: string) {
  const now = Date.now()
  if (rates.size > 10_000) rates.clear()
  const key = `${projectId}:${address}`
  const rate = rates.get(key)
  if (!rate || rate.resets <= now) {
    rates.set(key, { count: 1, resets: now + RATE_WINDOW_MS })
    return false
  }
  rate.count++
  return rate.count > RATE_LIMIT
}
