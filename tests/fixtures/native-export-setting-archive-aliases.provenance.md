# Native archive export-setting aliases

Data: [native-export-setting-archive-aliases.json](native-export-setting-archive-aliases.json).

- Observed on 24 November 2026 at native revision `bad07e4433240cad046589129c084bd2fc36f097`.
- The independent native `replay` executable used the harness described in [ellipse provenance](native-ellipse-four-anchor.provenance.md). Harness source SHA-256: `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`; executable SHA-256: `9bbffd3f5e53d425051c20e87870c94b660429064098e95569c4571b84564e9e`.
- The executable ran in the existing Rust Docker image with one CPU and the pinned native source mounted read-only. It is an evidence-gathering tool only; React tests read the immutable JSON and do not execute or depend on Rust.

## Reproduction

1. Create a native rectangle with width and height 10 and save through `file.saveAs` with `data: true`. The fixture stores its decoded document as `baseDocument`.
2. For each case, replace only `baseDocument.nodes["2"].exports` with `settings`. Serialise this document as UTF-8 JSON, then base64-encode it.
3. Dispatch native `file.open` with that data, followed by `node.get` for node 2. Record the returned export settings, or the file-open refusal.
4. Compare the independent React file-open result and canonical save/reopen result against the recorded fields. On refusal the React document must remain unchanged.

The 21 observations contain seven individual top-level aliases, two nested print aliases, their combined form, a canonical control, an unknown-key control, and nine conflicting alias/canonical pairs. Twelve are accepted and nine are refused. Serde accepts snake_case aliases for archive deserialisation but rejects duplicate spellings of one field. This differs from `node.set`, whose prior key transformation resolves duplicates before deserialisation. Archive aliases do not acquire the command's general snake-casing behaviour.

Before the correction, these fixtures produced 19 failures and two passes. The correction also preserves the specific duplicate-field reason through the existing file-format error wrapper rather than replacing it with a generic invalid JSON/ZIP message. Exact native line/column positions are not part of the browser error contract.
