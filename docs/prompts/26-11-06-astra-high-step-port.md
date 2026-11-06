# Astra High step-based Figcraft port prompt

Use this prompt for a substantial port or upstream-sync task. Replace the scope placeholder before starting.

---

You are ChatGPT Astra High acting as the coordinating engineer and final reviewer for Figcraft React.

## Objective

Analyse, design, plan, implement and verify this porting scope:

`{PORT_SCOPE}`

Before implementation, confirm that the scope is one bounded, independently testable vertical slice. If it spans multiple separately shippable behaviours or the whole application, create an ordered roadmap but implement only the first explicit slice in this run. Do not generate stubs for later slices merely to claim broad coverage.

Port the observable behaviour from the Rust Figcraft reference into the independent browser-based React implementation. Preserve meaningful feature and UI parity while omitting native desktop host-shell behaviour that has no browser purpose. When an essential native feature has no direct browser API, use the closest standards-based JavaScript equivalent and document the difference.

Complete the work end to end: evidence gathering, mapping, plan, implementation, evaluation, correction, provider-neutral backend setup with the Supabase adapter, Next.js preview integration and local verification.

## Mandatory project rules

1. Read `AGENTS.md`, `README.md`, `docs/setup.md`, `docs/architecture/identity-access.md`, `docs/parity/access-mapping.md`, `docs/parity/upstream.json` and `CHANGELOG.md` completely before acting.
2. Treat `original/figcraft` only as reference material. React code, builds and tests must never import, link, execute or bundle Rust Figcraft code or artefacts.
3. Keep core, domain and UI code independent of any PaaS provider. Put provider behaviour behind contracts; Supabase is the first adapter, not the architecture.
4. Preserve open-source hygiene: no personal paths, private identifiers, credentials or machine-specific assumptions in committed files.
5. Obey all branch, commit-message and publication rules in `AGENTS.md`. Work only from the canonical checkout and preserve unrelated changes.
6. Do not use Vercel before Phase 8. This prompt explicitly authorises Phase 8 only after every preceding release gate passes; local launch and verification remain required.

## Phase 1 — synchronise and establish evidence

1. Run `npm run upstream:sync` before analysing changes. If the fork diverged or cannot be pushed, stop and report the exact condition; never force-push.
2. Record the React HEAD, fork HEAD, original upstream HEAD and current parity baseline.
3. Both `glowplug-studio/figcraft-react` and the Rust reference repository `glowplug-studio/figcraft` are already connected to Graphify. Call `list_repositories` and verify both are queryable before analysis. Query the Rust repository for upstream definitions and behaviour, and the React repository for existing targets, dependencies and impact. If an index is stale, use current local files as authority and report the limitation.
4. Verify the global `supabase-figcraft` MCP connection is authenticated by making a real read-only project call. If authorisation is missing, start login with `--no-browser`, give the user the link and resume only after a successful MCP call. Do not create a project-local MCP definition.
5. Locate the complete upstream implementation, tests, documentation, assets, commands and UI states relevant to `{PORT_SCOPE}`. Use Graphify for definitions, callers, dependencies, impact and tests; use text search for literals, configuration and unindexed files.
6. Run or inspect the upstream feature where practical. Capture observable behaviour, state transitions, error cases, keyboard/pointer behaviour and browser-relevant visual states.
7. Identify only the porting hazards that affect `{PORT_SCOPE}`. Check Rust-to-TypeScript semantic differences such as ownership and shared mutation, exhaustive enums, numeric precision and overflow, deterministic ordering, concurrency, error handling and serialisation. Check native-to-browser differences such as threads and workers, filesystem access, fonts and text shaping, clipboard and drag-and-drop, pointer and keyboard input, window APIs and rendering. Do not perform broad generic research.
8. Resolve hazards from upstream code, tests and project documentation first. When evidence remains insufficient, consult current authoritative documentation for the specific browser API, TypeScript runtime or dependency involved. Record the evidence and avoid adopting generic porting advice that changes observable Figcraft behaviour.

Graphify does not create semantic links across repositories. Build the mapping explicitly:

1. Query the Rust graph for definitions, callers, callees, dependencies and linked tests.
2. Query the React graph separately for existing concepts, candidate targets, dependencies and tests.
3. Establish equivalence from observable behaviour, command identifiers, file-format fields, state transitions and tests; never from naming similarity alone.
4. Record each verified Rust-to-TypeScript relationship, its evidence and confidence in the dated plan.
5. After implementation and verification, update `docs/parity/cross-repository-mapping.md` with stable mappings.

Do not modify implementation during this phase.

## Port architecture invariants

Apply these constraints when analysing and implementing every scope:

1. Keep the editor engine independent of React. React owns application chrome such as panels, menus, toolbars and dialogs; it must not be the per-frame rendering or interaction engine.
2. Do not represent the editable canvas as a large React DOM tree. Use a dedicated browser rendering layer with an explicit render loop. Select Canvas 2D, WebGL, WebGPU or a suitable TypeScript rendering library only after a focused parity and performance evaluation; do not choose a library by default.
3. Keep pointer movement, dragging, pan, zoom and other frame-frequency state out of root React state. Use an engine/controller with mutable transient state, targeted subscriptions and `requestAnimationFrame`; React should receive only the snapshots needed to update chrome.
4. Separate document, commands, layout, geometry, rendering, interaction, collaboration and React UI concerns. Preserve a framework-independent domain and engine boundary so host applications and backend adapters remain replaceable.
5. Keep authentication and authorisation ownership in the embedding host. The core React package receives a provider-neutral identity snapshot, session status and capabilities through a host adapter; it must not import Supabase auth types, read auth cookies or refresh tokens. Treat client-visible roles as presentation data only and enforce permissions through validated server claims and backend policies.
6. Keep principal identity, resource ownership, access level, capabilities, grant source, collaboration host/guest role and ephemeral presence separate. Never infer authority from a host/guest role, presence client id or display name.
7. Do not introduce roles, capabilities, ownership operations or sharing modes solely because the wrapper or provider offers them. Every core capability must map to verified upstream Figcraft behaviour in `docs/parity/access-mapping.md`.
8. Derive the TypeScript document model from the actual upstream `Document`, `Node`, `NodeKind` and related contracts. Prefer stable identifiers and normalised entity storage, but do not invent a `SceneGraph` type or assume equivalence from names alone.
9. Preserve applicable upstream command identifiers, parameter contracts, labels, undo flags and observable results. The command registry is implemented under `crates/engine/src/cmd/*` with `spec!`; `catalog.rs` is the menu catalogue, not the registry. UI actions must dispatch commands rather than mutate the document through separate ad-hoc paths.
10. Keep deterministic layout and vector-network mathematics in dedicated TypeScript engine modules. Do not delegate editable-canvas geometry to CSS Flexbox or Grid; CSS layout is for application chrome and generated output where appropriate.
11. Preserve the collaboration semantics relevant to the scope: state/property changes, server ordering, optimistic application, reconciliation and presence separation. Do not describe upstream as a full CRDT, copy its binary transport, or couple the domain model to Supabase; expose the semantics through the provider-neutral realtime contract.
12. Do not use the Rust engine through WebAssembly or any other bridge. This is an independent TypeScript port, and Rust code may be used only as behavioural and structural evidence.
13. Treat `figcraft_engine::codegen` as upstream Dev Mode/export behaviour, not as the React editor implementation. Map and port it separately when its own scope is selected.
14. Do not mandate Zustand, Redux or another state library before the evidence and architecture analysis. Any chosen store must support command transactions, cheap snapshots, selective observation, undo/redo and testable operation outside React.
15. Define representative performance fixtures for large documents and continuous pointer interaction. Record render and input measurements and reject architectures that cause React-wide rerenders or visibly miss the browser frame budget.

For geometry, layout, commands, document serialisation and collaboration changes, prefer paired parity fixtures: establish an upstream Rust result from existing tests or reproducible examples, then assert the independent TypeScript implementation produces the same observable result. Tests must not execute Rust during the React build or test run.

## Phase 2 — analysis and port plan

Create `docs/planning/YY-MM-DD-<scope>.md` containing only evidence-backed decisions needed for this port:

- upstream behaviour and acceptance criteria;
- Rust source-to-React target mapping;
- a symbol-level cross-repository mapping table with upstream evidence, proposed TypeScript target and verification method;
- browser-specific omissions and JavaScript equivalents;
- scope-specific Rust-to-TypeScript and native-to-browser porting hazards, their evidence, mitigation and parity test;
- state, rendering, file-format and command implications;
- engine/React ownership boundaries, render-loop and transient-interaction state implications;
- representative performance fixtures and measurable acceptance criteria where the scope affects canvas interaction or rendering;
- provider-neutral backend contract, Supabase adapter setup and any feature-specific data or Realtime requirements;
- database design covering entities, relationships, ownership, lifecycle, indexes, RLS policies, Realtime publication and retention;
- authentication flow covering users, public profile data, login, logout, callback/session refresh and protected Next.js routes;
- host-to-core identity contract covering identity, session status, capabilities, changes and signed-out behaviour without provider-specific types;
- ownership, membership, anonymous share grants, expiry, revocation and reconnect behaviour;
- when comments are in scope, compatibility of the author display string with backend-verified principal attribution and protection against author-name spoofing;
- when live undo is in scope, preservation of per-collaboration-client undo rather than account-wide undo;
- unit, integration, parity and browser test plan;
- files expected to change;
- implementation order, risks and rollback points.

Do not create speculative platform architecture or unrelated ADRs.

At the top of the plan, maintain an `Execution checkpoint` table containing: overall status, active phase, upstream baseline, branch and last verified commit, completed work, tests last passed, files currently in progress, blockers, exact next action and last-updated time. Update it after every phase, after each significant integration commit and immediately before stopping. On resumption, verify the recorded repository state and continue from the next action instead of repeating completed work.

## Phase 3 — decomposition and delegation

Remain the single coordinator, architecture owner and final reviewer. Use real tool-backed subagents for bounded independent implementation work when this reduces cost or latency; do not role-play subagents or simulate their dialogue.

- Give each subagent one bounded task with exact files, inputs, acceptance criteria and tests.
- Prefer cheaper capable coding models for routine components, fixtures, tests and mechanical conversions.
- Keep complex state modelling, cross-cutting architecture, conflict resolution and final integration under Astra High.
- Do not assign overlapping files concurrently.
- Require subagents to inspect current files before editing and to preserve unrelated work.
- Review every returned change yourself; subagent completion is not evidence of correctness.

Within each agent, work in sequential micro-steps. Do not generate full-file replacements when a focused patch is sufficient.

## Phase 4 — implementation

1. Create the branch required by `AGENTS.md` for the size of the work.
2. Implement the smallest complete vertical slice matching the plan: one user-visible behaviour carried through every required layer, including UI, state/domain logic, provider boundary, persistence or realtime behaviour where applicable, error handling and tests. Do not leave a layer mocked when that layer is required for the feature to work locally.
3. Write authored application and test code in strict TypeScript or TSX wherever supported. Use JavaScript only when a required tool cannot consume TypeScript, document why, preserve compatibility identifiers where required, and avoid unbounded `any`.
4. Keep canvas rendering and frame-frequency interaction outside React reconciliation. Verify that continuous pointer interaction does not cause application-wide React rerenders.
5. Verify the provider-neutral backend foundation and complete only what is missing; do not recreate it for every slice. At minimum, verify project access through MCP, obtain the project URL and active publishable key without exposing secrets, configure ignored local environment values, initialise the browser-safe client, and add a tested connectivity path. Create only the schema and Realtime behaviour required by the selected port scope.
6. Maintain provider-neutral boundaries. UI and domain code must depend on contracts rather than Supabase directly.
7. For Supabase changes:
   - design the database declaratively in `supabase/schemas/`; organise files for review and let pg-delta resolve supported dependencies;
   - check `supabase --version` and the relevant command `--help` before acting because CLI targeting and declarative-schema commands vary by major version;
   - with the current pg-delta workflow, generate versioned migrations with `supabase db schema declarative sync -f <description> --no-apply`, review the SQL, then apply and verify it locally;
   - treat `auth.users` as the canonical identity source and create a public profile table only for application-owned user data;
   - enable RLS on exposed tables and write ownership-aware policies;
   - never expose secret or service-role keys to browser code;
   - use a publishable key in clients;
   - use Supabase Realtime through the adapter rather than coupling it to UI or domain code;
   - add local integration tests and run database/security advisers before finalising.
8. Set up Supabase Auth in the Next.js host with pinned `@supabase/ssr` and `@supabase/supabase-js` versions:
   - email-and-password authentication by default unless the selected scope specifies another provider;
   - request-scoped server client and browser client utilities;
   - cookie refresh through the current Next.js `proxy.ts` convention;
   - public login and auth callback routes;
   - logout behaviour;
   - protected application routes that validate with `supabase.auth.getClaims()` rather than trusting `getSession()` on the server;
   - redirects that preserve the intended destination where safe;
   - local and hosted Site URL and callback allow-list configuration for the Next.js host;
   - tests proving unauthenticated users are redirected and authenticated users can reach protected routes.
9. Define a provider-neutral identity adapter consumed by the reusable package. Map the Next.js/Supabase user's stable id, session status and authorised capabilities into it. Never use user-editable metadata for authorisation, and keep backend enforcement in validated claims and RLS.
10. Keep legacy owner tokens, link tokens and reconnect secrets inside the appropriate backend or transport adapter. Do not expose them through identity snapshots or serialise them into the document.
11. Run the shared host-adapter contract suite for the in-memory reference and every provider adapter. Add provider-specific negative tests proving unauthorised reads and mutations fail at the backend.
12. Add or update exports so the feature remains embeddable in React and Next.js hosts.
13. Make significant verified commits as required by `AGENTS.md`; never commit unrelated changes.

## Phase 5 — evaluate and correct

After the first implementation pass:

1. Review the complete diff against the plan and upstream evidence.
2. Check for missing states, desktop-only leakage, unsupported assumptions, provider coupling, accessibility regressions, unintended public API changes and unresolved porting hazards identified in the plan.
3. Run focused tests, the full test suite, typecheck and package build.
4. Exercise the feature in `examples/nextjs` with Playwright. Test primary behaviour, important error paths, resize behaviour and relevant keyboard/pointer interaction. Add stable screenshots at fixed viewport, device scale and font conditions when visual parity is relevant.
5. Compare the result with upstream behaviour and visual evidence. Record concrete gaps, then fix them.
6. Repeat verification until failures are resolved or a genuine external blocker remains.

Do not call a build successful merely because it compiles.

## Phase 6 — local Supabase and Next.js verification

1. Start or connect the intended local Supabase environment using the repository configuration.
2. Verify MCP project access, the project URL, the active publishable key and client connectivity. Never print or commit credentials.
3. Review the declarative database design, generate its migration, reset the local database and confirm the resulting schema matches the declarations.
4. Verify Auth user creation or fixture setup, profile ownership and every RLS policy with positive and negative tests.
5. Verify that the Next.js host maps validated identity and capabilities into the core adapter, that signed-out transitions clear core identity, and that client-visible roles cannot bypass backend policies.
6. Verify relevant database, Storage and Realtime behaviour through the adapter, including at least one successful path and one denied or failed path when those services are used.
7. Run database, security and performance advisers after schema changes and resolve relevant findings.
8. Keep real values in ignored environment files and placeholders in examples.

Then:

1. Run `npm run preview:build`.
2. Run `npm run test:e2e` so Playwright starts and verifies the local Next.js preview.
3. Run `npm run preview:dev` for any additional manual checks.
4. Verify login, session refresh, protected-route redirection, authenticated access and logout in the running browser application.
5. Test the ported feature end to end as an authenticated user.
6. Inspect browser errors and failed network requests; correct them and retest.
7. Stop local processes cleanly when verification is complete.

## Phase 7 — final evidence and hand-off

Update the upstream baseline and changelog only when the port genuinely supports the new commit. Write a concise report in `docs/reports/` containing:

- implemented scope;
- upstream commit supported;
- browser-specific substitutions or omissions;
- Supabase MCP verification, adapter setup and any schema or Realtime changes;
- tests and browser flows run with results;
- remaining verified gaps;
- commits and branch state;
- anything requiring user action.

Also create a self-contained `docs/reports/YY-MM-DD-<scope>-parity.html` report that a maintainer can open locally without a server or external assets. Include the upstream and React commits, test environment and coverage totals, followed by an accessible HTML table with one row per independently testable feature property. Each row must contain:

- feature and sub-feature;
- expected upstream behaviour;
- React implementation or target;
- automated test method and test identifier;
- expected result and actual result;
- status: `Passed`, `Failed`, `Partial`, `Blocked` or `Not tested`;
- evidence links to repository-relative tests, fixtures, screenshots or logs;
- concise manual human-test prerequisites and numbered actions;
- the result the human should observe;
- confidence: `High`, `Medium` or `Low`;
- remaining gap or limitation.

Use `High` confidence only when relevant automated parity tests and browser verification both pass, `Medium` when one independent verification method passes, and `Low` for inspection or inference only. Confidence never overrides a failed, partial or untested status. Do not hide failed or unavailable checks in aggregate coverage. Keep the HTML readable, printable and free of credentials, machine-specific paths, embedded third-party scripts and remote dependencies.

Do not merge to `main` or open a pull request unless the user has separately authorised that action. Deployment and the branch push needed to publish its verified demo-link changes are authorised only under Phase 8.

Before hand-off, update the plan's execution checkpoint to `Complete` only when every required acceptance criterion has evidence. Otherwise record the precise resumable next action and leave the status truthful.

## Phase 8 — gated Vercel demo publication

Run this phase only when Phases 1–7 are complete, the execution checkpoint is `Complete`, all required automated parity and Playwright checks pass, and no required report row is `Failed`, `Partial`, `Blocked` or `Not tested`.

1. Confirm the deployment source is the exact reviewed, committed revision. Do not deploy a dirty working tree or uncommitted source.
2. Use the authenticated Vercel MCP connection to identify the exact account, team and project. Verify that the project is connected to `glowplug-studio/figcraft-react`, uses `examples/nextjs` as its root directory, and will deploy the intended branch and commit. If the project is absent, ambiguous or mismatched, stop and request the user's selection; do not create, link or retarget one by assumption.
3. Through Vercel MCP, verify that every required production environment variable exists without printing its value. Never copy credentials into reports, commits, logs or chat.
4. Create a staged production deployment without assigning the stable production domain, when supported. Otherwise create a preview deployment. Follow its build through Vercel MCP and inspect failed build logs precisely.
5. Test the exact staged deployment. Run `PLAYWRIGHT_BASE_URL=<deployment-url> npm run test:e2e`, verify login, protected routes, the ported feature and important failure paths, and inspect browser and network errors. Use authenticated Vercel access for protected deployments; do not weaken deployment protection.
6. Promote that same tested deployment to production and its stable alias without rebuilding it. Record the previous production deployment first so it remains an explicit rollback target.
7. Verify the stable production URL through Vercel MCP and Playwright. If verification fails after promotion, roll back to the recorded prior production deployment and verify the rollback.
8. Only after successful production verification, edit `README.md` locally in the canonical checkout to add or update a `Demo` section using the stable production URL, never a unique deployment URL.
9. Commit the README and final report changes using the `AGENTS.md` convention and push the current authorised branch. Never push or merge to `main` without separate explicit authorisation. If the public/default-branch README cannot change until a merge, report that fact rather than bypassing review.
10. Use the authenticated GitHub MCP connection to verify the repository is `glowplug-studio/figcraft-react`, then update its homepage/website field to the same stable demo URL. Do not use GitHub MCP or the GitHub API to edit repository files.
11. Add the Vercel account/team, project, deployment identifier, stable URL, tested commit, hosted test results, GitHub metadata result and rollback target to the final report. Record identifiers, not secrets.

On any pre-promotion failure, retain the existing production deployment and do not update the README or GitHub demo link. Report the exact failing gate and leave a resumable checkpoint.

## Token-efficient execution

- Use one evidence pass and one explicit decomposition before implementation.
- Batch independent read-only checks.
- Keep progress updates factual and short.
- For simple reads, searches and linters, act immediately with minimal narration.
- For routine implementation, state at most two bullets of intent before editing.
- Reserve Astra High reasoning for architecture, state convergence, difficult debugging and final review.
- Reuse existing context and project documentation; do not restate it.
- Output focused patches rather than rewriting complete files.
- Use concise final reporting with exact files, commands and unresolved blockers.

Continue until the planned scope is implemented and locally verified, or until progress requires a material product decision, unavailable credential or external system change that the user must provide.

---
