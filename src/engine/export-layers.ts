import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { renderRasterExport } from "./canvas";
import type { Document } from "./document";
import { layerExportJobs } from "./export-jobs";
import { batchExportOptions } from "./export-settings";
import { inspectedId, parseBoolean } from "./parameters";
import { base64Bytes } from "./recovery";

export interface ExportedFile { id: number | string; name: string; bytes: number; data?: string; warnings?:string[] }
export async function renderLayerExports(doc: Document, selection: readonly string[], params: Record<string, unknown>,
  download: boolean, assertAccess: () => void) {
  const { jobs, skipped } = layerExportJobs(doc, selection, params);
  if (!jobs.length) throw new Error("no export settings (add one with export.add)");
  if (params.dir != null) throw new Error("Use a browser download to choose the export destination");
  const overrides = batchExportOptions(params);
  const zip = download ? jobs.length > 1 : parseBoolean(params.zip) === true;
  const files: ExportedFile[] = [];
  let total = 0;
  const writer = zip ? new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers:false, extendedTimestamp:false }) : undefined;
  let output: Blob | undefined;
  for (const {setting,id,name} of jobs) {
    assertAccess();
    const {format} = setting;
    let blob: Blob, warnings:string[] | undefined;
    if (format === "vectorDrawable") {
      const {renderDrawable}=await import("./vector-drawable/export");
      ({blob,warnings}=await renderDrawable(doc,[id],{...setting,...overrides}));
    } else if (format === "svg") {
      const {renderSvgExport} = await import("./export-svg");
      blob = await renderSvgExport(doc,[id],{...setting,...overrides},setting);
    } else {
      if (format !== "png" && format !== "jpg" && format !== "webp") throw new Error("The " + format + " file encoder is unavailable");
      blob = await renderRasterExport(doc,[id],{...setting, ...overrides, quality:Math.max(1,Math.min(100,setting.quality ?? 90))},format,setting.size);
    }
    assertAccess();
    const file: ExportedFile = {id:inspectedId(id),name,bytes:blob.size,...(warnings && {warnings})};
    if (writer) {
      total += blob.size;
      if (total > 256 * 1024 * 1024) throw new Error("the files would pass 256 MB as one zip: export fewer layers at a time, or to a folder");
      await writer.add(name,new BlobReader(blob),{ level:0 });
    } else if (download) output = blob;
    else file.data = base64Bytes(new Uint8Array(await blob.arrayBuffer()));
    files.push(file);
  }
  if (writer) output = await writer.close();
  assertAccess();
  const name = zip ? doc.name + ".zip" : jobs[0].name.split("/").at(-1)!;
  return {output,name,files,skipped};
}
