#!/bin/sh
# Optional reproduction of the HarfBuzz library. Normal builds use the shipped JS and Wasm.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$root/src/engine/harfbuzz"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
docker run --rm -i --platform linux/amd64 -v "$out:/out" -v "$root/scripts/font-outline.cc:/work-outline.cc:ro" -v "$root/scripts/font-png.c:/work-font-png.c:ro" \
  emscripten/emsdk@sha256:520088b81877b610389dfd4cf7fb8c69f3ae41a611b0f80e222f57dafd930973 sh -es <<'BUILD'
mkdir -p /work/bindings/harfbuzz
cd /work
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzzjs/tar.gz/af42e4d6e3f54fb9b85cc9692d4e1bd6e4e91ed3 -o bindings.tgz
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzz/tar.gz/ab5ecbb83985034a76214ac0b2b833dcd590d774 -o lib.tgz
curl -fsSL https://registry.npmjs.org/harfbuzzjs/-/harfbuzzjs-1.6.0.tgz -o npm.tgz
curl -fsSL https://codeload.github.com/freetype/freetype/tar.gz/refs/tags/VER-2-15-0 -o freetype.tgz
wuffs=https://raw.githubusercontent.com/google/wuffs/7f70dda95c77b10c087c0908790837b5e9c15713
curl -fsSL "$wuffs/release/c/wuffs-v0.4.c" -o wuffs.c
curl -fsSL "$wuffs/LICENSE-MIT" -o WUFFS-LICENCE.txt
sha256sum -c <<'CHECK'
458066457347bd6d9bc3c906aa8292bea4488577727569ddd9436fdd89d5f04d  wuffs.c
bb811a4b485eac3caeb8bdc58bbafb355fbcb6116010a7ea9179e5c70b0bc878  WUFFS-LICENCE.txt
87c7f1f8699b91e89f773f7dcfa505b044e1dae67f62a55d4e29c3afdcac4fb8  freetype.tgz
f9b4df35c24e02a5dce35b8a5c5357f4f9379dbdfb448065462a29f6817a8385  bindings.tgz
748b498a1df03a16c956068da976cb29361eeb75d8faabaaac546b43d635db2e  lib.tgz
c1e2c37480396d8d8721f909f2a7fce42153bbbc26cdd712c611d498311a2088  npm.tgz
CHECK
tar -xzf bindings.tgz --strip-components=1 -C bindings
tar -xzf lib.tgz --strip-components=1 -C bindings/harfbuzz
tar -xzf npm.tgz package/dist/index.mjs package/dist/index.d.mts
tar -xzf freetype.tgz
ft=/work/freetype-VER-2-15-0
# Keep the sfnt, TrueType and CFF outline drivers and their PostScript dependencies.
sed -i '/^FT_USE_MODULE/ { /tt_driver_class/b; /sfnt_module_class/b; /cff_driver_class/b; /psaux_module_class/b; /psnames_module_class/b; /pshinter_module_class/b; d; }' "$ft/include/freetype/config/ftmodule.h"
emcmake cmake -S "$ft" -B ft-build -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_C_FLAGS="-flto" \
  -DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON -DFT_DISABLE_HVF=ON -DFT_DISABLE_STREAM_SUPPORT=ON
cmake --build ft-build -j4
emcc -std=c99 -Oz -flto -I/work -c /work-font-png.c -o /work/font-png.o
cd bindings
# Static decoder tables and the Emscripten stack occupy five 64 KiB pages.
sed -i s/INITIAL_MEMORY=256KB/INITIAL_MEMORY=320KB/ Makefile
cat >>config-override.h <<'CONFIG'
#undef HB_NO_UCD_UNASSIGNED
#undef HB_NO_LEGACY
#undef HB_NO_BITMAP
#undef HB_NO_AAT
CONFIG
echo _figcraft_decode_font_png >> harfbuzz.symbols
echo _figcraft_unhinted_outline >> harfbuzz.symbols
make harfbuzz CXX="em++ -Iharfbuzz/src -I$ft/include" \
  HARFBUZZ_SRCS="harfbuzz/src/harfbuzz.cc /work-outline.cc /work/font-png.o /work/ft-build/libfreetype.a"
# Defer Wasm initialisation until a font is requested; canvas consumers also build IIFEs.
sed -i '/^init(await createHarfBuzz());$/d' ../package/dist/index.mjs
cat >> ../package/dist/index.mjs <<'BINDING'

let initialising;
export function initialiseShaper() {
  return initialising ??= createHarfBuzz().then(init).catch(error => {
    initialising = undefined;
    throw error;
  });
}

export function unhintedOutline(font, glyph) {
  const commands = [];
  const data = register_callback_data_pointer(commands);
  try {
    exports.figcraft_unhinted_outline(font.ptr, glyph, getJsonDrawFuncs().ptr, data);
  } finally {
    remove_callback_data_pointer(data);
  }
  return commands;
}
// Read the original font bytes in the current Wasm memory. A later Wasm allocation can
// replace this view, so callers consume the table synchronously and retain only offsets.
export function fontTableView(blob, offset, length) {
  const size = exports.hb_blob_get_length(blob.ptr);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) return;
  return new DataView(Module.HEAPU8.buffer, exports.hb_blob_get_data(blob.ptr, 0) + offset, length);
}
export function decodeFontPng(data, width, height) {
  if (data.buffer !== Module.HEAPU8.buffer || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 1024 || height > 1024) return;
  const input = data.byteOffset, length = data.byteLength, size = width * height * 4;
  const output = exports.malloc(size);
  if (!output) return;
  try {
    if (exports.figcraft_decode_font_png(input, length, width, height, output)) {
      return Module.HEAPU8.slice(output, output + size);
    }
  } finally {
    exports.free(output);
  }
}
BINDING
echo 'export declare function unhintedOutline(font: Font, glyph: number): SvgPathCommand[];' >> ../package/dist/index.d.mts
echo 'export declare function fontTableView(blob: Blob, offset: number, length: number): DataView | undefined;' >> ../package/dist/index.d.mts
echo 'export declare function decodeFontPng(data: DataView, width: number, height: number): Uint8Array | undefined;' >> ../package/dist/index.d.mts
sha256sum -c <<'CHECK'
0a9eab77fd1f2c3678291ee51124f780ae258dd5336df4a83fef66e11d9f7180  dist/harfbuzz.js
ce1ae9b15e52d8fec5b30f775521e8a8e49009b5600d40b448ed323483068b59  dist/harfbuzz.wasm
CHECK
echo 'export declare function initialiseShaper(): Promise<void>;' >> ../package/dist/index.d.mts
install -m 0644 dist/harfbuzz.js dist/harfbuzz.wasm ../package/dist/index.mjs ../package/dist/index.d.mts /out/
install -m 0644 /work/WUFFS-LICENCE.txt /out/WUFFS-LICENCE.txt
install -m 0644 "$ft/docs/FTL.TXT" /out/FREETYPE-LICENCE.txt
BUILD
