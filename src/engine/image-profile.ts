const srgbChromaticities = [.3127,.3290,.64,.33,.30,.60,.15,.06];

// Validate ancillary colour metadata before using it.
export function validPngChunk(bytes: Uint8Array, at: number, size: number, view: DataView) {
  let crc = 0xffffffff;
  for (let i=at+4; i<at+8+size; i++) {
    crc ^= bytes[i];
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0) === view.getUint32(at+8+size);
}

/** A PNG with no usable ICC profile may describe its colour space before the first IDAT. */
export function pngProfileName(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let gamma: number | undefined, nearSrgb = true, srgb = false;
  for (let at=8; at+12<=bytes.length;) {
    const size = view.getUint32(at), tag = view.getUint32(at+4), data = at+8;
    if (size > bytes.length-at-12) return;
    if (tag === 0x49444154 || tag === 0x49454e44) break; // IDAT, IEND
    if (tag === 0x69434350) return; // iCCP takes precedence over suggested PNG primaries.
    if (tag === 0x73524742 && size === 1 && bytes[data] <= 3 && validPngChunk(bytes,at,size,view)) srgb = true;
    if (tag === 0x67414d41 && size === 4 && validPngChunk(bytes,at,size,view)) gamma = view.getUint32(data)/100000;
    if (tag === 0x6348524d && size === 32 && validPngChunk(bytes,at,size,view)) {
      let valid = true, near = true;
      for (let i=0; i<8; i+=2) {
        const x=view.getUint32(data+4*i)/100000, y=view.getUint32(data+4*i+4)/100000;
        valid &&= y > .001 && x+y <= 1;
        near &&= Math.abs(x-srgbChromaticities[i]) < .01 && Math.abs(y-srgbChromaticities[i+1]) < .01;
      }
      nearSrgb = !valid || near;
    }
    at += size+12;
  }
  if (srgb) return "sRGB";
  if (gamma === undefined || gamma < .1 || gamma > 10) return;
  return nearSrgb && Math.abs(gamma*2.2-1) < .01 ? "sRGB" : "Gamma "+(1/gamma).toFixed(2);
}

/** Clean the v2 text description or the v4 localised description used by the picker. */
export function iccDescription(profile:Uint8Array) {
  const view=new DataView(profile.buffer,profile.byteOffset,profile.byteLength);
  if(profile.length<132 || view.getUint32(36)!==0x61637370) return;
  const length=view.getUint32(0), count=view.getUint32(128);
  if(length<132 || length>profile.length || count>(length-132)/12) return;
  const space=view.getUint32(16);
  if(space!==0x52474220 && space!==0x47524159) return;
  let name="";
  const text=(at:number,size:number,wide:boolean)=>{
    const data=profile.subarray(at,at+size);
    return wide ? new TextDecoder("utf-16be").decode(data) : new TextDecoder("utf-8").decode(data);
  };
  for(let i=0;i<count;i++) {
    const tag=132+12*i, at=view.getUint32(tag+4), size=view.getUint32(tag+8);
    if(at>length || size>length-at) return;
    if(view.getUint32(tag)!==0x64657363 || size<8) continue;
    const type=view.getUint32(at);
    if(type===0x74657874) name=text(at+8,size-8,false);
    if(type===0x64657363 && size>=12) {
      const n=view.getUint32(at+8);
      if(n>size-12) continue;
      name=text(at+12,n,false);
      if(!name.replace(/\0/g,"") && size-12-n>=8) {
        const units=view.getUint32(at+16+n);
        if(units<=(size-20-n)/2) name=text(at+20+n,units*2,true);
      }
    }
    if(type===0x6d6c7563 && size>=16) {
      const records=view.getUint32(at+8), stride=view.getUint32(at+12);
      if(stride<12 || records>(size-16)/stride) continue;
      let chosen=false;
      for(let j=0;j<records;j++){
        const record=at+16+j*stride, n=view.getUint32(record+4), offset=view.getUint32(record+8);
        if(offset>size || n>size-offset || n%2) continue;
        const english=view.getUint16(record)===0x656e;
        if(!chosen || english){name=text(at+offset,n,true);chosen=true;}
        if(english) break;
      }
    }
    break;
  }
  let cleaned="", chars=0;
  for(const c of name) {
    const code=c.codePointAt(0)!;
    if(code<32 || (code>=127 && code<=159)) continue;
    cleaned+=c;
    if(++chars===64) break;
  }
  return {name:cleaned.trim(),grey:space===0x47524159};
}
