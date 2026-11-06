# Changelog

All notable changes to the React port and its upstream compatibility baseline are recorded here.

## [0.2.0] - 2026-11-06

Reference upstream remains Figcraft `8eb0b87646c5aef712326d6c431ccde5408630de`.
Support is limited to the documented local rectangle slice, not the complete upstream application.

- Added an independent TypeScript document/command engine and Canvas 2D rectangle workflow, selection, undo/redo, constrained drawing and cancellation.
- Added an embeddable React editor receiving host identity and capabilities; pointer previews remain outside React reconciliation.
- Added a Supabase-backed Next.js password-login host, validated protected routes, session refresh, callback handling and logout.
- Added paired upstream fixtures, real local Auth denial checks, browser screenshots and measured rendering/interaction checks.
- Recorded the dependency-ordered port roadmap and remaining gaps; save/load, advanced tools and collaboration remain separate slices.

## [0.1.0] - 2026-11-06

Supported upstream: Figcraft `8eb0b87646c5aef712326d6c431ccde5408630de` (2026-11-05).

- Established the provider-neutral React library foundation and Next.js preview host.
- Added the upstream Figcraft repository as a pinned Git submodule.
- Added Supabase client-adapter scaffolding, local configuration and environment templates; Realtime and Auth remain planned adapter work.
- Added Playwright browser verification for the Next.js preview host.
- Added a gated Vercel deployment and GitHub demo-publication phase to the porting prompt.
- Added provider-neutral identity, ownership and document-access contracts, in-memory reference adapters and shared conformance tests.
- Added setup, planning, reporting and parity documentation structure.
