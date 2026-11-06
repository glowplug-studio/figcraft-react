# Tests

- `unit/`: isolated domain and UI behaviour.
- `contracts/`: reusable provider-adapter conformance suites and reference-adapter checks.
- `integration/`: package, adapter and host-framework boundaries.
- `parity/`: assertions run against equivalent upstream-derived fixtures or recorded results.
- `fixtures/`: versioned `.figcraft` and protocol fixtures with their upstream source commit recorded.

Every parity test must identify the upstream behaviour and commit it proves.
Every provider adapter must pass the relevant shared contract suite, including identity transitions, access revocation and negative authorisation paths.
