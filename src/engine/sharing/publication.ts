import { ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import type { Document } from "../document";
import { ArchiveReader, archiveOptions, decodeFigcraft, encodeFigcraftBlob, MAX_ARCHIVE_MEMBER } from "../file-format";

export const PUBLIC_FILE_BYTES = 16 * 1024 * 1024;

export function cleanOnlineName(value: string): string {
  const trimmed = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  const visible = trimmed.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "");
  return Array.from(visible).slice(0, 256).join("");
}

/** Publish the current document. Private version and branch histories stay on the device. */
export async function prepareOnlineSnapshot(document: Document, nextId: bigint, requestedName = "") {
  const name = cleanOnlineName(requestedName) || cleanOnlineName(document.name);
  const archive = await encodeFigcraftBlob({ ...document, name }, String(nextId));
  if (archive.size > PUBLIC_FILE_BYTES) throw new Error("This server keeps files up to 16 MiB");
  return archive;
}

/** Apply server limits before the general-purpose native reader inflates any member. */
export async function validateOnlineSnapshot(archive: Blob) {
  if (!archive.size || archive.size > PUBLIC_FILE_BYTES) throw new Error("This server keeps files up to 16 MiB");
  const reader = new ZipReader(new ArchiveReader(archive), archiveOptions);
  try {
    let expanded = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      expanded += entry.uncompressedSize;
      if (expanded > MAX_ARCHIVE_MEMBER) throw new Error("The expanded online snapshot exceeds the 512 MiB archive budget");
      if (/^(versions|branches)\//.test(entry.filename)) throw new Error("An online snapshot cannot contain local file history");
    }
  } finally {
    await reader.close();
  }
  const { document, issues } = await decodeFigcraft(archive);
  if (issues?.length) throw new Error("The online snapshot needs repair: " + issues[0]);
  if (Object.keys(document.nodes).length > 5_000_000) throw new Error("The file has more than 5000000 layers");
  if (Array.from(document.name).length > 256 || /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(document.name)) {
    throw new Error("Invalid online file name");
  }
  return { name: document.name };
}
