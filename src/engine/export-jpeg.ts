import JpegWorker from "./export-jpeg-worker?worker&inline";

/** The native file encoder uses baseline JPEG and full-resolution chroma at every quality. */
export async function encodeExportJpeg(pixels: ImageData, quality: number) {
  const worker = new JpegWorker();
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => {
        if (data.bytes) resolve(data.bytes);
        else reject(new Error(data.error ?? "JPEG encoding failed"));
      };
      worker.onerror = event => reject(new Error(event.message || "JPEG worker failed"));
      worker.onmessageerror = () => reject(new Error("Unreadable JPEG worker response"));
      worker.postMessage({ pixels: pixels.data, width: pixels.width, height: pixels.height, quality }, [pixels.data.buffer]);
    });
    return new Blob([bytes], { type: "image/jpeg" });
  } finally { worker.terminate(); }
}
