# Figcraft React

Figcraft React is an open-source React and TypeScript reimplementation of [Figcraft](https://github.com/storytold/figcraft), an open-source interface design and prototyping application written in Rust.

The long-term goal is feature, behaviour and visual parity with upstream Figcraft while producing an independent React package that can run on its own or be embedded in another React application, including Next.js.

The port targets the browser rather than reproducing the native desktop host shell. Essential desktop behaviour should use the closest standards-based browser or JavaScript equivalent. The React implementation does not import, link or execute Rust Figcraft code.

> **Disclaimer:** `figcraft-js` is an independent, unofficial repository. It is not affiliated with, sponsored by, or endorsed by the ArtCraft team or Figma, Inc.

## Repository layout

- `src/` — the reusable React package.
- `src/backends/` — provider-neutral backend boundaries and optional adapters.
- `src/backends/supabase/` — the first remote-service adapter.
- `examples/nextjs/` — a local Next.js preview application.
- `original/figcraft/` — the pinned reference submodule using the `glowplug-studio/figcraft` fork.
- `supabase/` — local Supabase configuration and future migrations or functions.
- `scripts/` — repository maintenance utilities, including upstream synchronisation.
- `tests/` — unit, integration and parity tests.
- `docs/planning/` — dated port plans.
- `docs/architecture/` — durable provider-neutral contracts and system boundaries.
- `docs/reports/` — verification and migration reports.
- `docs/parity/` — upstream baselines and parity records.
- `docs/prompts/` — reusable agent prompts for porting work.
- `dist/` — ignored generated ESM and TypeScript declaration output.

## Getting started

```sh
git clone --recurse-submodules <repository-url>
cd figcraft-react
npm install
npm run playwright:install
npm run typecheck
npm test
npm run build
npm run test:e2e
```

If the repository was cloned without submodules:

```sh
git submodule update --init --recursive
```

## Upstream synchronisation

The reference submodule uses:

- `origin` — `glowplug-studio/figcraft`, the project fork.
- `upstream` — `storytold/figcraft`, the original project.

Check whether the fork differs from upstream:

```sh
npm run upstream:check
```

Fast-forward and push the fork before analysing upstream updates:

```sh
npm run upstream:sync
```

The synchronisation script refuses dirty, divergent or non-fast-forward updates.

## Preview application

Run the Next.js preview host:

```sh
npm run preview:dev
```

Then open `http://localhost:3000`. The preview imports the built React package in the same way another React or Next.js application would.

Build the preview without starting it:

```sh
npm run preview:build
```

`dist/` contains the generated library JavaScript and TypeScript declarations. The Next.js preview produces its own ignored output under `examples/nextjs/.next/`.

## Supabase and Graphify

Supabase is the first interchangeable remote-service adapter. Storage and realtime transport remain behind provider-neutral contracts so another PaaS can be used later without changing domain or UI code. Authentication is owned by the embedding host; the reusable package receives provider-neutral identity, session and capability data through an adapter. Ownership, access grants, collaboration roles and presence remain separate from provider implementation.

Graphify is used by development agents to understand pushed source. The React repository and the Figcraft fork are indexed independently in the same workspace; Graphify does not automatically infer that a Rust symbol corresponds to a TypeScript symbol. Port plans must explicitly map upstream definitions, callers and tests to their React targets. A submodule pointer does not recursively index its contents, and Graphify does not read uncommitted local files or ignored build output.

See `docs/setup.md` for environment, Supabase, Graphify and preview configuration. The step-based Astra High port prompt is under `docs/prompts/`.

## Contributing

Porting work should preserve upstream behaviour and include tests demonstrating parity. Do not add machine-specific paths, private credentials or contributor-specific configuration to committed files.

See `AGENTS.md` for the agent workflow and `CHANGELOG.md` for version and upstream-baseline information.

## Licence

This project is licensed under the Apache License 2.0. Upstream Figcraft remains subject to its own licence and attribution requirements.
