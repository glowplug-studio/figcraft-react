# Figcraft React agent instructions

## Purpose

Maintain a one-for-one React and TypeScript port of the upstream Rust Figcraft project. Preserve feature, behaviour, file-format and UI parity with upstream rather than redesigning it.

The canonical upstream source is the `original/figcraft` Git submodule. It is reference material only. Product code belongs in `src/`; do not modify the submodule as part of port work.

This project must remain an independent implementation. Product code, builds and tests must not import, link, execute, bundle or otherwise depend on Rust Figcraft code or artefacts from the submodule.

This is a public open-source project. Committed files must not contain personal usernames, absolute development-machine paths, private service identifiers, tokens, credentials, private workspace names or assumptions unique to one contributor's environment. Use repository-relative paths, documented environment variables and public placeholders.

## Target platform

This is a browser-based React port of a native desktop application, not a port of its desktop host shell. Preserve editing behaviour, document compatibility, meaningful application workflows and browser-relevant UI parity.

Omit native window chrome and operating-system integration that has no useful browser equivalent, such as process lifecycle controls, native updater behaviour, tray integration or native-only window commands. Do not omit an in-application control merely because it appears in the desktop build; panel collapse controls, toolbars, menus and similar editor interactions remain part of parity when they affect the browser workflow.

When an essential feature depends on a native API, implement the closest standards-based browser or JavaScript equivalent. Record and test any unavoidable behavioural difference in that port's plan or report.

Author application and test source in strict TypeScript or TSX wherever the toolchain permits. Use JavaScript only when a required tool cannot consume TypeScript, and document the reason. Prefer explicit domain types and avoid unbounded `any`.

## Branches and commits

- Never commit directly to `main` unless the user explicitly instructs it.
- Use `dev` for normal work. For work requiring several meaningful commits, create `prompt/<short-description>` from `dev`, then return it to `dev` through review.
- Use `fix` for quick fixes. Before starting, update local `dev` from its remote branch, then create or reset `fix` from that latest `dev`; do not branch quick fixes from `main` or a stale `dev`.
- Commit each significant, verified change during long-running work.
- Start every commit title with `Authored by ChatGPT: ` followed by a simple description of the change. Record the model, effort, verification and further detail in the commit body.
- Preserve unrelated changes made by the user or other agents.

## Versioning

- Use Semantic Versioning (`MAJOR.MINOR.PATCH`) for project releases.
- Increment `MAJOR` for incompatible public API or compatibility changes, `MINOR` for backwards-compatible features, and `PATCH` for backwards-compatible fixes.
- Keep `package.json`, `CHANGELOG.md` and `docs/parity/upstream.json` aligned whenever the project version changes.

## Upstream synchronisation

When asked to “apply updates”, “sync upstream”, or similar:

1. Run `npm run upstream:sync` to fast-forward the Figcraft fork from the original upstream `main`, push the fork, and update the local submodule checkout. Stop on divergence rather than merging or rewriting history.
2. Identify upstream commits after the baseline in `docs/parity/upstream.json`.
3. Use Graphify and the local parity documentation to map affected Rust components to React components.
4. Write a dated plan in `docs/planning/` before changing implementation.
5. Implement the React and test changes on an appropriate work branch.
6. Verify locally, including relevant PaaS-adapter effects, without changing hosted resources unless the task requires it.
7. Update parity records and `CHANGELOG.md`, merge into `dev`, and open a pull request to `main` only when instructed.

Do not select a Graphify repository implicitly. A prompt that explicitly names repositories counts as the user's selection; otherwise list the repositories available to the current workspace and ask which repository to use before selection.

Graphify indexes the Rust and React repositories independently; it does not infer cross-repository equivalence. For every port, explicitly map upstream Rust modules, symbols, commands and tests to their TypeScript targets in the dated plan and update `docs/parity/cross-repository-mapping.md` once the mapping is verified. Do not infer equivalence from similar names alone.

## Local Graphify index

- Use a combined local graph for day-to-day port work. Index the active React checkout and the pinned `original/figcraft` submodule separately with `graphify extract <source> --code-only --no-cluster --out <cache-dir>`. Give each repository its own cache directory outside both working trees and preserve the submodule’s Git metadata.
- On resumption, check the indexed revisions against both checkouts and check for unindexed source edits. Refresh any missing or stale graph. During implementation, refresh the React graph at each slice checkpoint that changes source or tests, and the Rust graph whenever the submodule revision changes.
- After either refresh, run `graphify merge-graphs <react-graph.json> <rust-graph.json> --out <combined.json>`. Verify the combined graph contains symbols from both repositories. Record the indexed revisions and material coverage gaps in the checkpoint. Hosted indexing is optional for this local workflow; honour any separate hosted checks explicitly required by the task.

## Architecture boundaries

- Keep reusable React code in `src/` and expose it as a library that can be embedded by React hosts, including Next.js.
- Keep domain and UI code independent of any backend provider.
- Put backend contracts in `src/backends/` and the first provider adapter in `src/backends/supabase/`.
- Keep Supabase migrations, functions and local configuration in `supabase/`. Never expose secret or service-role keys to browser code.
- Manage Supabase database design declaratively in `supabase/schemas/`. Generate and review versioned migrations from schema diffs; do not make uncaptured schema changes directly on the hosted database.
- Use Supabase Auth through the Next.js host adapter. Treat `auth.users` as the identity source, add an RLS-protected public profile table only for application data, keep login and auth callback routes public, and protect private routes server-side with validated claims.
- The embedding host owns authentication UI, cookies, token refresh, route protection and authoritative claim validation. The reusable React package receives identity, session state and capabilities through a provider-neutral host adapter without importing Supabase types. Client-provided roles are presentation inputs only; backend authorisation remains enforced by validated server claims and RLS.
- Keep principal identity, resource ownership, access level, capabilities, grant source, collaboration host/guest role and ephemeral presence as separate concepts. Follow `docs/architecture/identity-access.md` and preserve the upstream mapping in `docs/parity/access-mapping.md`.
- Provider adapters must notify the core of sign-out, revocation and expiry, and must pass the shared adapter contract tests. Never serialise provider tokens, cookies, owner tokens or raw share secrets into the document model.
- Do not add product roles, capabilities, ownership operations or sharing modes merely because a wrapper or provider supports them. Every core capability must map to verified upstream Figcraft behaviour and be recorded in `docs/parity/access-mapping.md`.
- Keep realtime transport behind a provider-agnostic contract so different PaaS adapters can be used without changing domain or UI code.
- Treat observable upstream behaviour and the `.figcraft` file format as compatibility targets, not runtime dependencies.

## Agent coordination

- Use real tool-backed subagents for bounded, independent work when this reduces cost or latency. Never role-play subagents or generate fictional subagent dialogue.
- The coordinating agent owns architecture, file allocation, integration and final verification. Do not give multiple agents overlapping files concurrently.
- Delegate routine fixtures, isolated components, mechanical conversions and focused tests. Keep cross-cutting state, concurrency, security and final parity decisions with the coordinating agent.
- Integrate and verify each returned change before depending on it in another task.

## Documentation and verification

- Name planning files `YY-MM-DD-<description>.md` and store them in `docs/planning/`.
- Keep a resumable execution checkpoint in every active port plan. Update it after each phase and before stopping with the active phase, last verified commit, completed work and tests, files in progress, blockers and exact next action.
- Store investigation and verification reports in `docs/reports/`.
- Store feature mappings, upstream baselines and parity matrices in `docs/parity/`.
- Store durable provider-neutral contracts and boundaries in `docs/architecture/`; keep provider-specific implementation details in their adapter documentation.
- Add automated parity tests for every ported or synchronised behaviour. Prefer fixtures derived from upstream examples where licensing permits.
- Use Playwright for browser workflows and fixed-environment visual parity checks. A manual browser check does not replace an automated browser test when the behaviour can be automated.
- Update `CHANGELOG.md` with the React version and supported upstream commit whenever the parity baseline changes.

## Credentials and tooling

- Keep real local values in ignored `.env`/`.env.local` files and public placeholders in `.env.local.example`.
- Do not open OAuth links automatically; print them for the user to open.
