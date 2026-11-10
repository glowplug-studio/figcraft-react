import { ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { measureDocumentSnapshot } from "./document-session";
import type { Document } from "../document";
import { ArchiveReader, archiveOptions, decodeFigcraft, encodeFigcraftBlob, MAX_ARCHIVE_MEMBER } from "../file-format";

export const PUBLIC_FILE_BYTES = 16 * 1024 * 1024;

// Transport uses the Supabase Storage project ceiling. Publication uses the
// independent native framed-state limit, including uncompressed image base64.
export const ONLINE_ARCHIVE_BYTES = 50 * 1024 * 1024;

function initialSessionId(file: string) {
  const hex = file.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Invalid publication identity");
  // Take 64 random bits from the UUID, excluding its version and variant.
  return BigInt("0x" + hex.slice(0, 12) + hex.slice(-4));
}

async function publicationSize(document: Document, file: string, limit = PUBLIC_FILE_BYTES) {
  const size = await measureDocumentSnapshot(document, initialSessionId(file), limit);
  if (size > limit) throw new Error("This server keeps files up to 16 MiB");
  return size;
}

export function cleanOnlineName(value: string): string {
  const trimmed = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  const visible = trimmed.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "");
  return Array.from(visible).slice(0, 256).join("");
}

/** Publish the current document. Private version and branch histories stay on the device. */
export async function prepareOnlineSnapshot(document: Document, nextId: bigint, file: string, requestedName = "") {
  const name = cleanOnlineName(requestedName) || cleanOnlineName(document.name);
  const published = { ...document, name };
  await publicationSize(published, file);
  const archive = await encodeFigcraftBlob(published, String(nextId));
  if (archive.size > ONLINE_ARCHIVE_BYTES) throw new Error("The uploaded archive exceeds the 50 MiB transfer limit");
  return archive;
}

/** Apply server limits before the general-purpose native reader inflates any member. */
export async function validateOnlineSnapshot(archive: Blob, file: string, limit = PUBLIC_FILE_BYTES) {
  if (!archive.size || archive.size > ONLINE_ARCHIVE_BYTES) throw new Error("The upload must be a non-empty archive of at most 50 MiB");
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
  return { name: document.name, snapshotBytes: await publicationSize(document, file, limit) };
}
