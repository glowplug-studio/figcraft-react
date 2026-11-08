import { identity, inverse, multiply, type Affine } from "./affine";

export type ImageScaleMode = "fill" | "fit" | "crop" | "tile";
export interface ImagePlacement {
  readonly scale_mode: ImageScaleMode;
  readonly rotation: number;
  readonly scale: number;
  readonly crop: Affine | null;
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

/** Only an isotropic PNG pHYs chunk before IDAT can set native screen density. */
export function imagePixelDensity(bytes: Uint8Array): number {
  if (!pngSignature.every((v,i) => bytes[i] === v)) return 1;
  const data = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = data.getUint32(offset), type = data.getUint32(offset+4);
    if (offset + 8 + length > bytes.length) return 1;
    if (type === 0x70485973 && length === 9) { // pHYs
      const x = data.getUint32(offset+8), y = data.getUint32(offset+12);
      if (x !== y || bytes[offset+16] !== 1) return 1;
      const density = x * .0254 / 72, whole = Math.round(density);
      return whole >= 2 && whole <= 4 && Math.abs(density-whole) < .005 ? whole : 1;
    }
    if (type === 0x49444154 || type === 0x49454e44) return 1; // IDAT or IEND
    offset += 12 + length;
  }
  return 1;
}

export function placedImageSize(iw:number, ih:number, density:number, width?:number, height?:number) {
  const scale = Math.min(1,4096 / Math.max(iw / density,ih / density));
  return {width:width ?? iw / density * scale, height:height ?? (width === undefined ? ih / density * scale : width * ih / Math.max(1,iw))};
}

const oddTurn = (rotation:number) => rotation % 2 !== 0;

/** A crop maps the layer's unit box into UV coordinates of the rotated image. */
export function placementCrop(image:ImagePlacement, iw:number, ih:number, width:number, height:number):Affine {
  if (image.scale_mode === "crop" && image.crop?.every(Number.isFinite) && Math.abs(image.crop[0]) > 1e-9 && Math.abs(image.crop[3]) > 1e-9) return image.crop;
  const rw = Math.max(1,oddTurn(image.rotation) ? ih : iw), rh = Math.max(1,oddTurn(image.rotation) ? iw : ih);
  const w = Math.max(1e-6,width), h = Math.max(1e-6,height);
  const scale = image.scale_mode === "fit" ? Math.min(w/rw,h/rh) : Math.max(w/rw,h/rh);
  const a = w/(rw*scale), d = h/(rh*scale);
  return [a,0,0,d,(1-a)/2,(1-d)/2];
}

export function cropRect([a,, ,d,e,f]:Affine): readonly [number,number,number,number] {
  return [-e/a,-f/d,(1-e)/a,(1-f)/d];
}
export function cropFromRect(x0:number,y0:number,x1:number,y1:number):Affine {
  const a = 1/Math.max(1e-6,Math.abs(x1-x0)), d = 1/Math.max(1e-6,Math.abs(y1-y0));
  return [a,0,0,d,-Math.min(x0,x1)*a,-Math.min(y0,y1)*d];
}

/** Encoded-image pixel coordinates to local layer coordinates, clockwise in Canvas 2D. */
export function imageTransform(image:ImagePlacement, iw:number, ih:number, w:number, h:number):Affine {
  iw = Math.max(1,iw); ih = Math.max(1,ih);
  const turn = (image.rotation % 4 + 4) % 4;
  const rotations:readonly Affine[] = [identity,[0,1,-1,0,ih,0],[-1,0,0,-1,iw,ih],[0,-1,1,0,0,iw]];
  const rw = oddTurn(turn) ? ih : iw, rh = oddTurn(turn) ? iw : ih;
  let fitted:Affine;
  if (image.scale_mode === "crop") {
    const uv = placementCrop(image,iw,ih,w,h);
    const inverted = uv[0]*uv[3] === uv[1]*uv[2] ? identity : inverse(uv);
    fitted = multiply([w,0,0,h,0,0],multiply(inverted,[1/rw,0,0,1/rh,0,0]));
  } else if (image.scale_mode === "tile") {
    const scale = Number.isFinite(image.scale) && image.scale > 0 ? image.scale : 1;
    fitted = [scale,0,0,scale,0,0];
  } else {
    const scale = image.scale_mode === "fit" ? Math.min(w/rw,h/rh) : Math.max(w/rw,h/rh);
    fitted = [scale,0,0,scale,(w-rw*scale)/2,(h-rh*scale)/2];
  }
  return multiply(fitted,rotations[turn]);
}
