#!/bin/sh
# Optional reproduction of the HarfBuzz library. Normal builds use the shipped JS and Wasm.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$root/src/engine/harfbuzz"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
docker run --rm -i --platform linux/amd64 -v "$out:/out" \
  emscripten/emsdk@sha256:520088b81877b610389dfd4cf7fb8c69f3ae41a611b0f80e222f57dafd930973 sh -es <<'BUILD'
mkdir -p /work/bindings/harfbuzz
cd /work
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzzjs/tar.gz/af42e4d6e3f54fb9b85cc9692d4e1bd6e4e91ed3 -o bindings.tgz
curl -fsSL https://codeload.github.com/harfbuzz/harfbuzz/tar.gz/ab5ecbb83985034a76214ac0b2b833dcd590d774 -o lib.tgz
curl -fsSL https://registry.npmjs.org/harfbuzzjs/-/harfbuzzjs-1.6.0.tgz -o npm.tgz
sha256sum -c <<'CHECK'
f9b4df35c24e02a5dce35b8a5c5357f4f9379dbdfb448065462a29f6817a8385  bindings.tgz
748b498a1df03a16c956068da976cb29361eeb75d8faabaaac546b43d635db2e  lib.tgz
c1e2c37480396d8d8721f909f2a7fce42153bbbc26cdd712c611d498311a2088  npm.tgz
CHECK
tar -xzf bindings.tgz --strip-components=1 -C bindings
tar -xzf lib.tgz --strip-components=1 -C bindings/harfbuzz
tar -xzf npm.tgz package/dist/index.mjs package/dist/index.d.mts
cd bindings
cat >>config-override.h <<'CONFIG'
#undef HB_NO_UCD_UNASSIGNED
#undef HB_NO_LEGACY
#undef HB_NO_BITMAP
#undef HB_NO_AAT
CONFIG
make harfbuzz
sha256sum -c <<'CHECK'
ba43463df44851fd58211ef8c19aa7956965390857727ae867b70dc7b3682de1  dist/harfbuzz.js
5d0120835225b894d9932cce9c6509a65b9f9915fdfd23f01df313de3d9f728a  dist/harfbuzz.wasm
CHECK
install -m 0644 dist/harfbuzz.js dist/harfbuzz.wasm ../package/dist/index.mjs ../package/dist/index.d.mts /out/
BUILD
