#!/bin/sh
# Optional reproduction of the HarfBuzz library. Normal builds use the shipped JS and Wasm.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$root/src/engine/harfbuzz"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
docker run --rm -i --platform linux/amd64 -v "$out:/out" -v "$root/scripts/font-outline.cc:/work-outline.cc:ro" \
  emscripten/emsdk@sha256:520088b81877b610389dfd4cf7fb8c69f3ae41a611b0f80e222f57dafd930973 sh -es <<'BUILD'
mkdir -p /work/bindings/harfbuzz
cd /work
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzzjs/tar.gz/af42e4d6e3f54fb9b85cc9692d4e1bd6e4e91ed3 -o bindings.tgz
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzz/tar.gz/ab5ecbb83985034a76214ac0b2b833dcd590d774 -o lib.tgz
curl -fsSL https://registry.npmjs.org/harfbuzzjs/-/harfbuzzjs-1.6.0.tgz -o npm.tgz
curl -fsSL https://codeload.github.com/freetype/freetype/tar.gz/refs/tags/VER-2-15-0 -o freetype.tgz
sha256sum -c <<'CHECK'
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
cd bindings
cat >>config-override.h <<'CONFIG'
#undef HB_NO_UCD_UNASSIGNED
#undef HB_NO_LEGACY
#undef HB_NO_BITMAP
#undef HB_NO_AAT
CONFIG
echo _figcraft_unhinted_outline >> harfbuzz.symbols
make harfbuzz CXX="em++ -Iharfbuzz/src -I$ft/include" \
  HARFBUZZ_SRCS="harfbuzz/src/harfbuzz.cc /work-outline.cc /work/ft-build/libfreetype.a"
cat >> ../package/dist/index.mjs <<'BINDING'

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
BINDING
echo 'export declare function unhintedOutline(font: Font, glyph: number): SvgPathCommand[];' >> ../package/dist/index.d.mts
sha256sum -c <<'CHECK'
822dd8cc84a85ad527c03a0bb201dc7fad8f8134a2923576b5fb2ecbbb3afa54  dist/harfbuzz.js
8d71a81409a002b39adbe3566d5d6b88fd145648f8ddb8e3ae8cf2cdb9fd36f1  dist/harfbuzz.wasm
CHECK
install -m 0644 dist/harfbuzz.js dist/harfbuzz.wasm ../package/dist/index.mjs ../package/dist/index.d.mts /out/
install -m 0644 "$ft/docs/FTL.TXT" /out/FREETYPE-LICENCE.txt
BUILD
