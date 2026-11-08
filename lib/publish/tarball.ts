// Packs a project the way the EAS CLI does: a gzipped tar with everything under `project/`. Server only.

import { gzipSync } from "node:zlib"

const BLOCK = 512

function field(block: Buffer, offset: number, length: number, value: string) {
  block.write(value, offset, length, "utf8")
}

function octal(value: number, length: number) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`
}

/** Tar's name field holds 100 bytes, and a longer path spills its folders into the 155 byte prefix field. */
function splitPath(path: string) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" }
  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
    const prefix = path.slice(0, slash)
    const name = path.slice(slash + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  throw new Error(`This file's path is too long to package: ${path}`)
}

function header(path: string, size: number) {
  const block = Buffer.alloc(BLOCK)
  const { name, prefix } = splitPath(path)
  field(block, 0, 100, name)
  field(block, 100, 8, octal(0o644, 8))
  field(block, 108, 8, octal(0, 8))
  field(block, 116, 8, octal(0, 8))
  field(block, 124, 12, octal(size, 12))
  field(block, 136, 12, octal(0, 12))
  field(block, 156, 1, "0")
  field(block, 257, 8, "ustar\u000000")
  field(block, 345, 155, prefix)
  // The checksum counts its own field as spaces.
  block.fill(" ", 148, 156)
  const checksum = block.reduce((sum, byte) => sum + byte, 0)
  field(block, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `)
  return block
}

export function projectTarball(files: { path: string; content: string }[]) {
  const parts: Buffer[] = []
  for (const { path, content } of files) {
    const body = Buffer.from(content, "utf8")
    parts.push(header(`project/${path}`, body.length), body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK))
  }
  // Two empty blocks end an archive.
  parts.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(parts))
}
