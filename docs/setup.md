# Development setup

## Repository

```sh
git clone --recurse-submodules <repository-url>
cd figcraft-react
npm install
npm run playwright:install
npm run typecheck
npm test
npm run build
```

The `original/figcraft` submodule is reference material. Nothing in the React build may depend on it. Its `origin` is the project fork and its `upstream` remote is the original Figcraft repository.

Before analysing upstream changes:

```sh
npm run upstream:check
npm run upstream:sync
```

`upstream:check` fetches and reports whether the fork differs without changing or pushing it. `upstream:sync` permits only a fast-forward from the original repository and pushes that result to the fork. It stops if the fork diverged.

## Supabase

Copy `.env.local.example` to an ignored local environment file and provide the project URL and publishable key. Never put a secret or service-role key in a browser-exposed variable.

The repository includes `supabase/config.toml` for local Supabase development. Database design is declarative under `supabase/schemas/`; with the current pg-delta workflow, generate versioned migrations with `supabase db schema declarative sync -f <description> --no-apply`, review them and verify locally. Check `supabase --version` and command help before acting because CLI major versions differ.

The Next.js host will own Supabase Auth with cookie-based SSR clients. `auth.users` remains the identity source; application profile data belongs in an RLS-protected public table. Login and auth callback routes remain public, while application routes validate claims server-side before rendering. The host maps the validated user's identity, session status and capabilities into a provider-neutral adapter consumed by the reusable package; the core package never reads auth cookies or imports Supabase auth types.

User-level Codex MCP configuration must remain outside the repository:

```sh
codex mcp add supabase-figcraft --url "https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cfeedback"
codex mcp login supabase-figcraft --no-browser
```

The Supabase adapter uses Supabase Realtime. Core collaboration code depends only on the provider-neutral realtime contract. Do not add the upstream Rust binary collaboration protocol.

## Graphify

Graphify indexes Git repositories from their remote provider. It does not index uncommitted files, ignored files or arbitrary local directories.

```sh
codex mcp add graphify --url https://api.graphify.com/mcp
codex mcp login graphify --no-browser
```

Connect the GitHub repository in the Graphify portal, select the intended workspace and verify `list_repositories` reports it as queryable. Push a branch before expecting Graphify to know its changes, then allow its index to refresh.

The root repository index covers tracked source files in this repository. A Git submodule is recorded only as a repository pointer; Graphify will not infer the contents of `original/figcraft`. Connect `glowplug-studio/figcraft` as a second repository in the same Graphify workspace when Graphify needs indexed knowledge of the Rust source.

Graphify does not automatically link equivalent symbols across those repositories. During each port, query the Rust and React graphs separately, establish equivalence from behaviour, data contracts, commands, callers and tests, then record the evidence in the dated plan and `docs/parity/cross-repository-mapping.md`. Similar names alone are not sufficient evidence.

Generated `dist/` output is ignored and should not be indexed. Graphify should inspect the authored React source in `src/` and the preview host in `examples/nextjs/`.

## Preview host

```sh
npm run preview:dev
```

The preview application runs at `http://localhost:3000` and consumes the local package. Use `npm run preview:build` to verify that the integration builds without starting a server.

Run the automated browser check with:

```sh
npm run test:e2e
```

Playwright starts the Next.js preview on an isolated local port and retains failure evidence according to its configuration.

To test an already deployed preview or production URL without starting the local server:

```sh
PLAYWRIGHT_BASE_URL=https://example.test npm run test:e2e
```
