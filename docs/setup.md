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

The Next.js host owns Supabase Auth with cookie-based SSR clients. `auth.users` remains the identity source; application profile data belongs in an RLS-protected public table. Login and auth callback routes remain public, while application routes validate claims server-side before rendering. The host maps the validated user's identity, session status and capabilities into a provider-neutral adapter consumed by the reusable package; the core package never reads auth cookies or imports Supabase auth types.

User-level Codex MCP configuration must remain outside the repository:

```sh
codex mcp add supabase-figcraft --url "https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cfeedback"
codex mcp login supabase-figcraft --no-browser
```

The Supabase adapter uses Supabase Realtime. Core collaboration code depends only on the provider-neutral realtime contract. Do not add the upstream Rust binary collaboration protocol.

## Graphify

Install the Graphify CLI and run these commands from the React repository root. Keep the generated indexes in a user cache outside the checkout.

```sh
index_dir="${XDG_CACHE_HOME:-$HOME/.cache}/figcraft-graphify-index"
graphify extract . --code-only --no-cluster --exclude original \
  --exclude node_modules --exclude dist --exclude test-results \
  --exclude playwright-report --out "$index_dir"
graphify extract original/figcraft --code-only --no-cluster --out "$index_dir/rust"
graphify merge-graphs "$index_dir/graphify-out/graph.json" \
  "$index_dir/rust/graphify-out/graph.json" --out "$index_dir/combined.json"
```

Refresh the React graph after source or test changes and the Rust graph when the pinned submodule changes. Merge again and verify a known symbol from each checkout. The optional SQL parser adds SQL symbol coverage. Inspect documentation and unindexed files directly.

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

## Rectangle slice: local Auth and browser checks

The local stack uses ports **55321** (API), **55322** (database), **55323** (Studio) and **55324** (mail), avoiding the conventional Supabase ports used by other projects. Run from the repository root:

```sh
supabase start
supabase status
```

Copy the example environment to `examples/nextjs/.env.local`, then set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321` and the local **publishable** key reported by the CLI. Do not place a secret/service-role key in this file. Never commit real values. Create a local email/password user in Studio's Authentication panel to sign in manually.

```sh
npm run typecheck
npm test
npm run test:integration
npm run preview:build
npm run test:e2e
npm run preview:dev
```

Pure tests deliberately skip local integration unless enabled; `npm run test:integration` and `FIGCRAFT_LOCAL_INTEGRATION=1 npm test` require the intended local stack. Browser tests create and delete a temporary local Auth user. Their privileged fixture helper rejects hosted URLs. The interactive preview uses port 3000; Playwright uses 3100. Both callback addresses are allowed locally. The authenticated editor creates **unsaved local** documents; reload discards them.

`supabase/schemas/00_public.sql` declares only the existing public namespace. This slice stores no application data: `auth.users` and sessions are provider-managed; there is no profile table, document table, application RLS policy, Storage bucket or Realtime publication. Verify the empty application design with:

```sh
supabase db schema declarative sync --schema public -f rectangle_foundation --no-apply
supabase db reset --local --yes
supabase db advisors --local --type all --level warn --fail-on error
```

The sync should report no changes, so no migration is generated. Reset deletes the local project's fixture data; do not use a hosted selector. Stop only this project with `supabase stop` when finished.

Hosted verification requires a project-authorised CLI session for Auth settings, the approved Site URL and exact callback allow-list, and test credentials supplied through ignored environment variables `FIGCRAFT_E2E_EMAIL`/`FIGCRAFT_E2E_PASSWORD`. Do not paste credentials into chat or reports. `PLAYWRIGHT_BASE_URL` targets a hosted application; local fixture administration never runs against it. Deployment remains gated by the port prompt.
