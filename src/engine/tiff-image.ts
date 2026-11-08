import { decodeTiffJpeg } from "./tiff-jpeg";
import { decodeFax4 } from "./tiff-fax";
import { tiffDirectory } from "./tiff-directory";
import { decodeTiffSegment } from "./tiff-segment";

const MAX_WORKING_BYTES = 512 * 1024 * 1024;
/** Expand only validated strips or tiles. The output and largest scratch segment share one budget. */
export async function decodeTiff(bytes: Uint8Array<ArrayBuffer>) {
  const { value, byteField, fields, little } = tiffDirectory(bytes);
  const width = value(256), height = value(257), bits = value(258, 0, 1), photo = value(262);
  const channels = value(277, 0, 1), compression = value(259, 0, 1), planar = value(284, 0, 1);
  const predictor = value(317, 0, 1), format = value(339, 0, 1);
  const gray = photo === 0 || photo === 1, cmyk = photo === 5;
  const baseChannels = gray ? 1 : photo === 2 ? 3 : cmyk ? 4 : 0;
  if (!width || !height || !baseChannels || channels < baseChannels || channels > Math.min(baseChannels+1,4)) throw new Error("Unsupported TIFF colour model");
  if (!(bits === 8 || bits === 16 || bits === 1 && gray && channels === 1 || bits === 32 && format === 3 && photo === 2)) throw new Error("Unsupported TIFF sample depth");
  for (const [tag, expected] of [[258,bits],[339,format]]) {
    const count = fields.get(tag)?.count ?? 0;
    if (count > channels) throw new Error("Invalid TIFF channel count");
    for (let i=0; i<count; i++) if (value(tag,i) !== expected) throw new Error("Mixed TIFF sample types");
  }
  if (format !== 1 && !(format === 3 && bits === 32) || bits === 32 && format !== 3) throw new Error("Unsupported TIFF sample format");
  if (planar !== 1 && planar !== 2 || predictor !== 1 && !(predictor === 2 && (bits === 8 || bits === 16))) throw new Error("Unsupported TIFF sample layout");
  const tiled = fields.has(322), tileWidth = tiled ? value(322) : width;
  const tileHeight = tiled ? value(323) : Math.min(height, value(278,0,height));
  if (!tileWidth || !tileHeight) throw new Error("Invalid TIFF strip or tile dimensions");
  const across = Math.ceil(width/tileWidth), down = Math.ceil(height/tileHeight), perPlane = across*down;
  const components = planar === 2 ? 1 : channels, blocks = perPlane * (planar === 2 ? channels : 1);
  const offsets = tiled ? 324 : 273, counts = tiled ? 325 : 279;
  if (blocks !== fields.get(offsets)?.count || blocks !== fields.get(counts)?.count) throw new Error("Invalid TIFF segment count");
  const rowBytes = Math.ceil(tileWidth*components*bits/8);
  const outputBytes = width*height*4;
  const expanded = rowBytes * (tiled ? tileHeight*blocks : height*(planar === 2 ? channels : 1));
  if (expanded > MAX_WORKING_BYTES || outputBytes + rowBytes*tileHeight > MAX_WORKING_BYTES) throw new Error("TIFF pixels exceed the browser working limit");
  const jpegTables = compression === 7 ? byteField(347) : undefined;
  if (compression === 7) {
    if (bits !== 8 || predictor !== 1) throw new Error("Unsupported JPEG TIFF sample layout");
    const pixels = tileWidth * tileHeight;
    // Bitmap, drawing surface, packed samples and a bounded RGBA readback strip.
    if (outputBytes + pixels * (8 + components) + Math.min(pixels,262144) * 4 > MAX_WORKING_BYTES) {
      throw new Error("JPEG TIFF exceeds the browser working limit");
    }
  }
  const rgba = new Uint8ClampedArray(outputBytes);
  const reverseBits = value(266,0,1) === 2;
  let processed = 0;
  for (let block = 0; block < blocks; block++) {
    const x0 = block%across*tileWidth, y0 = Math.floor(block%perPlane/across)*tileHeight;
    const rows = tiled ? tileHeight : Math.min(tileHeight,height-y0);
    const offset = value(offsets,block), count = value(counts,block);
    if (offset > bytes.length || count > bytes.length-offset) throw new Error("TIFF segment exceeds the file");
    const segment = bytes.subarray(offset, offset+count);
    if (compression === 4 && (bits !== 1 || channels !== 1)) throw new Error("Invalid Group 4 TIFF sample format");
    let raw: Uint8Array<ArrayBuffer>;
    if (compression === 4) raw = await decodeFax4(segment, tileWidth, rows, reverseBits);
    else if (compression === 7) raw = await decodeTiffJpeg(segment, jpegTables, tileWidth, rows, components);
    else raw = await decodeTiffSegment(segment, compression, rowBytes*rows);
    const data = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), plane = Math.floor(block/perPlane);
    const max = bits === 16 ? 65535 : bits === 8 ? 255 : 1;
    for (let y = 0; y < Math.min(rows,height-y0); y++) {
      const prior = [0,0,0,0];
      for (let x = 0; x < Math.min(tileWidth,width-x0); x++) {
        const pixel = ((y+y0)*width+x+x0)*4;
        for (let c = 0; c < components; c++) {
          const sample = x*components+c, byte = y*rowBytes + Math.floor(sample*bits/8);
          let n = bits === 8 ? raw[byte] : bits === 16 ? data.getUint16(byte,little) : bits === 32 ? data.getFloat32(byte,little)
            : (raw[byte] >>> (reverseBits && compression !== 4 ? sample%8 : 7-sample%8)) & 1;
          if (predictor === 2) { n = (n+prior[c]) & max; prior[c] = n; }
          const channel = planar === 2 ? plane : c;
          rgba[pixel+channel] = Math.round(255 * n / max);
        }
      }
      processed += Math.min(tileWidth,width-x0);
      if (processed >= 262144) { processed = 0; await new Promise<void>(resolve => setTimeout(resolve,0)); }
    }
  }
  for (let i=0; i<rgba.length; i+=4) {
    if (i && i % 1048576 === 0) await new Promise<void>(resolve => setTimeout(resolve,0));
    if (gray) {
      const intensity = photo === 0 ? 255-rgba[i] : rgba[i];
      rgba[i+3] = channels === 2 ? rgba[i+1] : 255;
      rgba[i] = rgba[i+1] = rgba[i+2] = intensity;
    } else if (cmyk) {
      const k = 1 - rgba[i+3]/255;
      for (let c=0; c<3; c++) rgba[i+c] = Math.floor((255-rgba[i+c])*k);
      rgba[i+3] = 255;
    } else if (channels === 3) rgba[i+3] = 255;
  }
  return { width, height, rgba };
}
