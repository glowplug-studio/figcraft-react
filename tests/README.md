# Tests

- `unit/`: isolated domain and UI behaviour.
- `contracts/`: reusable provider-adapter conformance suites and reference-adapter checks.
- `integration/`: package, adapter and host-framework boundaries.
- `parity/`: assertions run against equivalent upstream-derived fixtures or recorded results.
- `fixtures/`: versioned `.figcraft` and protocol fixtures with their upstream source commit recorded.

Every parity test must identify the upstream behaviour and commit it proves.
Every provider adapter must pass the relevant shared contract suite, including identity transitions, access revocation and negative authorisation paths.

## Browser test prerequisites

- `e2e/`: Playwright workflows against the local Next.js preview and local Supabase stack. See the [resume handover](../docs/planning/26-11-07-full-port-resume.md#continue-from-here) for the cumulative-run setup.
- Three PDF cases rasterise pages with Poppler's `pdftoppm`, which must be on `PATH`. Without it they fail with `spawnSync pdftoppm ENOENT`, and because `preview.spec.ts` runs serially every later case in that file is skipped. Install Poppler with the platform package manager, or prepend a directory that already contains the binary for the test command. Each case compares the export with a baseline rendered by the same binary, so its version does not need to match earlier runs.
