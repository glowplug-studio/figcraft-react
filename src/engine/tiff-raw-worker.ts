import { decodeRawJpeg } from "./tiff-raw-jpeg";

interface Request { data: ArrayBuffer; width: number; height: number; channels: number }
self.addEventListener("message", async ({data}: MessageEvent<Request>) => {
  try {
    const pixels = await decodeRawJpeg(data.data, data.width, data.height, data.channels);
    self.postMessage(pixels, {transfer: [pixels.buffer]});
  } catch (error) {
    self.postMessage(error instanceof Error ? error.message : "Invalid raw TIFF JPEG");
  }
});
