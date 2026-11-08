// Server-only client for CloudHike Storage (S3-compatible). Never import this from client components.

import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let client: S3Client | null = null

function getClient() {
  if (client) return client
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
  if (!S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error("Storage is not configured.")
  }
  client = new S3Client({
    endpoint: S3_ENDPOINT || undefined,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  })
  return client
}

function getBucket() {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error("Storage is not configured.")
  return bucket
}

/** Keeps object keys readable and URL-safe. */
export function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
  return cleaned.slice(-100) || "file"
}

export async function uploadObject(key: string, body: Uint8Array, contentType: string) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

export async function copyObject(fromKey: string, toKey: string) {
  const bucket = getBucket()
  await getClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: toKey,
      CopySource: `${bucket}/${fromKey.split("/").map(encodeURIComponent).join("/")}`,
    })
  )
}

export async function deleteObjects(keys: string[]) {
  if (keys.length === 0) return
  await getClient().send(
    new DeleteObjectsCommand({
      Bucket: getBucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    })
  )
}

/** A temporary download link; the bucket itself stays private. */
export async function getObjectUrl(key: string, expiresInSeconds = 60 * 60) {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  })
}
