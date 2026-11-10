import encode, { init } from "@jsquash/jpeg/encode.js";
import encoderUrl from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url";

interface EncodeRequest { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; quality: number }

self.onmessage = async ({ data }: MessageEvent<EncodeRequest>) => {
  try {
    await init({ locateFile: () => encoderUrl });
    const image = new ImageData(data.pixels, data.width, data.height);
    const bytes = await encode(image, { quality: data.quality, baseline: true, progressive: false, optimize_coding: false,
      auto_subsample: false, chroma_subsample: 1, quant_table: 0, trellis_loops: 1 });
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "JPEG encoding failed" });
  }
};
