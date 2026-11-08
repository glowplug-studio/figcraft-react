/// <reference types="vite/client" />
import RawWorker from "./tiff-raw-worker?worker&inline";

export function decodeInWorker(data: ArrayBuffer, width: number, height: number, channels: number) {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const worker = new RawWorker();
    worker.onmessage = ({data}: MessageEvent<Uint8Array<ArrayBuffer> | string>) => {
      worker.terminate();
      if (typeof data === "string") reject(Error(data));
      else resolve(data);
    };
    worker.onerror = event => {
      event.preventDefault();
      worker.terminate();
      reject(Error(event.message || "TIFF JPEG worker failed"));
    };
    try {
      worker.postMessage({data, width, height, channels}, [data]);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
}
