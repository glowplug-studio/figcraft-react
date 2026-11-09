#!/bin/sh
# Reproduce the independent ICU4X binary and its notices. Ordinary package builds use the checked-in asset.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$root/src/engine/icu"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
docker run --rm -i --platform linux/arm64 -v "$out:/out" \
  rust@sha256:8a4e90c7946b74626488b1446f712c0fe0ed1a596cbd3d871684bc9c5433ae07 sh -es <<'BUILD'
mkdir /work
cd /work
curl -fsSL https://static.crates.io/crates/icu_capi/icu_capi-2.4.0.crate -o icu.crate
echo 'afb03872bfe480d71e6a40065eae10b085ed8e35628f068b8c5cd0abab9686b2  icu.crate' | sha256sum -c -
tar -xzf icu.crate
cd icu_capi-2.4.0
rustup target add wasm32-unknown-unknown
export RUSTFLAGS="--remap-path-prefix=/work=icu4x --remap-path-prefix=/usr/local/cargo/registry/src=crates"
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
cargo rustc --locked --release --target wasm32-unknown-unknown --no-default-features \
  --features std,compiled_data,segmenter --crate-type staticlib
host=$(rustc -vV | sed -n 's/^host: //p')
linker="$(rustc --print sysroot)/lib/rustlib/$host/bin/rust-lld"
"$linker" -flavor wasm --no-entry --gc-sections --strip-all --export-memory \
  --export=diplomat_alloc --export=diplomat_free --export=icu4x_LineSegmenter_create_lstm_mv1 \
  --export=icu4x_LineSegmenter_segment_utf16_mv1 --export=icu4x_LineSegmenter_destroy_mv1 \
  --export=icu4x_LineBreakIteratorUtf16_next_mv1 --export=icu4x_LineBreakIteratorUtf16_destroy_mv1 \
  target/wasm32-unknown-unknown/release/libicu_capi.a -o /work/line-segmenter.wasm
cargo metadata --locked --format-version 1 --filter-platform wasm32-unknown-unknown \
  --no-default-features --features std,compiled_data,segmenter > /work/packages.json
python3 - <<'PY'
from pathlib import Path
import json
meta=json.loads(Path('/work/packages.json').read_text())
seen={n['id'] for n in meta['resolve']['nodes']}
notices={}
for p in sorted(meta['packages'],key=lambda p:(p['name'],p['version'])):
    if p['id'] not in seen: continue
    crate=Path(p['manifest_path']).parent
    files=sorted(f for f in crate.iterdir() if f.is_file() and f.name.upper().startswith(('LICENSE','LICENCE','COPYRIGHT','NOTICE')))
    for f in files:
        notice=f.read_text().strip()
        notices.setdefault(notice,[]).append(p['name']+' '+p['version'])
out='ICU4X 2.4.0 word segmentation and its Cargo dependencies\n\n'
for notice,crates in notices.items():
    out+=', '.join(crates)+'\n\n'+notice+'\n\n'
Path('/work/THIRD-PARTY-NOTICES.txt').write_text('\n'.join(line.rstrip() for line in out.rstrip().splitlines())+'\n')
PY
echo 'a719bfe9a355a1626de0d32198a7f3da76356bb363748ffae864d28d273f8c35  /work/line-segmenter.wasm' | sha256sum -c -
install -m 0644 /work/line-segmenter.wasm /work/THIRD-PARTY-NOTICES.txt /out/
gzip -n -9 -c "$(rustc --print sysroot)/share/doc/rust/COPYRIGHT-library.html" > /out/RUST-LIBRARY-LICENCES.html.gz
BUILD
