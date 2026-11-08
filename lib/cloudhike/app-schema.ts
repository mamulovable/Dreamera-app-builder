// How a generated app's collections are laid out in its own database: each one is
// a table with a typed column per field. Everything here is worked out from the
// plan, and tables and columns are only ever added, so nobody's data can be lost.

import type { DataCollection, DataFieldType } from "@/lib/agent-protocol"

export type AppColumn = {
  field: string
  column: string
  type: DataFieldType
  /** The table this column points to, when it holds the id of another record. */
  references: string | null
}

export type AppTable = {
  collection: string
  name: string
  shared: boolean
  columns: AppColumn[]
  items: DataCollection["items"]
}

/** Saved values can be anything a screen wants to keep, so this is the one table that holds JSON. */
export const VALUES_TABLE = "appforge_values"
/** Where apps kept everything before they had tables. Renamed, not deleted, once it's been moved out. */
export const LEGACY_TABLE = "appforge_records"
export const LEGACY_BACKUP_TABLE = "appforge_records_legacy"

// CloudHike's other services may share this database, so the app's tables get a prefix of their own.
const TABLE_PREFIX = "app_"
const MAX_IDENTIFIER_LENGTH = 63
const SYSTEM_COLUMNS = new Set(["id", "owner_id", "created_at", "updated_at"])
const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"])
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

const COLUMN_TYPES: Record<DataFieldType, string> = {
  string: "text",
  number: "double precision",
  boolean: "boolean",
  "string[]": "text[]",
}

function snakeCase(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
}

/** A field whose name would be a system column gets its own, such as `owner_id_value`. */
function columnName(field: string) {
  const column = snakeCase(field)
  return SYSTEM_COLUMNS.has(column) ? `${column}_value` : column
}

/** The tables for a plan's collections, by collection name. Names Postgres couldn't hold are left out. */
export function appTables(collections: DataCollection[]) {
  const usable = collections.filter((c) => IDENTIFIER.test(c.name))
  const tableOf = (name: string) => `${TABLE_PREFIX}${snakeCase(name)}`
  const names = new Set(usable.map((c) => c.name))

  const tables = new Map<string, AppTable>()
  const usedTables = new Set<string>()
  for (const collection of usable) {
    const name = tableOf(collection.name)
    if (name.length > MAX_IDENTIFIER_LENGTH || usedTables.has(name)) continue
    usedTables.add(name)

    const columns = new Map<string, AppColumn>()
    for (const { name: field, type, references } of collection.fields) {
      if (!IDENTIFIER.test(field) || SYSTEM_FIELDS.has(field)) continue
      const column = columnName(field)
      if (column.length > MAX_IDENTIFIER_LENGTH || columns.has(column)) continue
      const linked = type === "string" && references && names.has(references)
      columns.set(column, { field, column, type, references: linked ? tableOf(references) : null })
    }
    tables.set(collection.name, {
      collection: collection.name,
      name,
      shared: collection.shared === true,
      columns: [...columns.values()],
      items: collection.items,
    })
  }
  // A collection that lost out above can't be pointed at.
  for (const table of tables.values()) {
    for (const column of table.columns) {
      if (column.references && !usedTables.has(column.references)) column.references = null
    }
  }
  return tables
}

/** The value as this column stores it, or undefined if it can't hold it. */
function toColumnValue(value: unknown, { type, references }: AppColumn) {
  if (value === null) return null
  // Forms often send an empty string for "nothing picked", which can't point at a record.
  if (references && value === "") return null
  switch (type) {
    case "string":
      if (typeof value === "string") return value
      return typeof value === "number" || typeof value === "boolean" ? String(value) : undefined
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined
      const parsed = typeof value === "string" && value.trim() ? Number(value) : NaN
      return Number.isFinite(parsed) ? parsed : undefined
    }
    case "boolean":
      if (typeof value === "boolean") return value
      return value === "true" ? true : value === "false" ? false : undefined
    case "string[]":
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" || typeof entry === "number")) return undefined
      return value.map(String)
  }
}

/** A request's fields don't fit the collection's table. The message is safe to show. */
export class RecordInputError extends Error {}

/** A request's fields as columns. Anything the table can't store is refused, so it can't be silently lost. */
export function columnsFromRequest(table: AppTable, fields: Record<string, unknown>) {
  const values: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue
    const column = table.columns.find((c) => c.field === field)
    if (!column) throw new RecordInputError(`${table.collection} has no field "${field}".`)
    const stored = toColumnValue(value, column)
    if (stored === undefined) throw new RecordInputError(`"${field}" should be a ${column.type} value.`)
    values[column.column] = stored
  }
  return values
}

/** Stored fields as columns, for sample and older records, which can't be sent back. What doesn't fit is left empty. */
export function columnsFromStored(table: AppTable, fields: Record<string, unknown>) {
  const values: Record<string, unknown> = {}
  for (const column of table.columns) {
    values[column.column] = fields[column.field] === undefined ? null : (toColumnValue(fields[column.field], column) ?? null)
  }
  return values
}

/** A row as the app sees it. An empty column is left out, the same as a field that was never set. */
export function rowToDocument(table: AppTable, row: Record<string, unknown>) {
  const document: Record<string, unknown> = {}
  for (const { field, column } of table.columns) {
    if (row[column] !== null && row[column] !== undefined) document[field] = row[column]
  }
  return {
    ...document,
    id: row.id,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  }
}

export function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

export function createTableSql({ name }: AppTable) {
  const table = quote(name)
  return [
    `create table ${table} (
      id text primary key,
      owner_id text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index ${quote(`${name.slice(0, 50)}_owner_idx`)} on ${table} (owner_id, created_at desc)`,
  ]
}

export function addColumnSql({ name }: AppTable, { column, type }: AppColumn) {
  return `alter table ${quote(name)} add column ${quote(column)} ${COLUMN_TYPES[type]}`
}

/**
 * Deleting a record empties the links to it. Not validated, so a link added to a
 * table that already has rows only applies from now on, rather than failing on old ones.
 */
export function addForeignKeySql({ name }: AppTable, { column, references }: AppColumn, constraint: string) {
  return `alter table ${quote(name)} add constraint ${quote(constraint)}
    foreign key (${quote(column)}) references ${quote(references!)} (id)
    on delete set null deferrable not valid`
}

export const CREATE_VALUES_TABLE = `
  create table if not exists ${quote(VALUES_TABLE)} (
    owner_id text not null,
    key text not null,
    value jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, key)
  )`
