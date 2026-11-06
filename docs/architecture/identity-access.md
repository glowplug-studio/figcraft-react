# Identity, ownership and access boundary

## Purpose

Figcraft React must work inside different web frameworks and with different identity and data providers. The editor therefore consumes provider-neutral identity and document-access snapshots; the embedding host owns authentication and the backend remains the authority for every protected operation.

The contracts are in `src/backends/identity.ts` and `src/backends/access.ts`. The in-memory reference implementation is in `src/backends/memory/`.

## Separate concepts

Do not collapse these concepts into one `role` field:

- **Principal:** a stable host-provided user identity.
- **Ownership:** the host identity that owns a resource.
- **Access level:** `none`, `view`, `comment` or `edit` for one document.
- **Capabilities:** specific upstream actions such as rename, delete, sharing management or library publication.
- **Grant source:** ownership, host membership or share link.
- **Session role:** host or guest in a collaboration topology; it grants no authority by itself.
- **Presence identity:** temporary client id, name, colour, cursor and selection; it is not authentication.

## Trust boundary

The host framework and provider adapter must:

1. authenticate the principal and maintain its session;
2. validate server-side claims before protecting routes or returning private data;
3. resolve ownership, memberships, share grants and capabilities;
4. enforce every read and mutation in the backend;
5. notify the editor when identity or access changes;
6. remove access immediately after sign-out, revocation or expiry.

The core editor may use capability snapshots to hide or disable controls and reject commands early. It must never treat those browser-visible snapshots as authoritative. It must not receive provider clients, cookies, access tokens, refresh tokens, service credentials, owner tokens or raw share secrets.

Provider integration must not expand the Figcraft product surface. Add a capability only when it maps to verified upstream behaviour. A provider's organisations, custom roles or sharing features may determine an existing Figcraft grant, but they do not automatically become editor features.

## Upstream compatibility

Upstream Figcraft currently has no user accounts. Its server uses file-scoped owner tokens, operator keys and revocable link tokens. The port preserves the observable semantics while allowing an adapter to bind them to real accounts:

- `Access::Edit`, `Access::Comment` and `Access::View` map to document access levels.
- An owner token maps to a file-management grant; it does not become a user identity.
- An edit, comment or view link maps to a revocable bearer grant.
- A server key maps to operator administration, outside ordinary document access.
- `Role::Host` and `Role::Guest` remain collaboration topology only.
- collaboration client ids and presence fields remain ephemeral.

Legacy bearer credentials must remain in the host or backend adapter and secret storage. They must not be serialised into `.figcraft` documents or exposed through the core identity contract.

## Provider mappings

### Supabase

- `auth.users.id` supplies the principal id.
- Application profile data belongs in an RLS-protected application table.
- Document ownership, memberships and share grants belong in application tables.
- Per-document permissions are resolved from those records and enforced with RLS and server-side checks.
- User-editable metadata is never used for authorisation. JWT application metadata is suitable only for coarse provider-managed claims and must account for token staleness.
- The Next.js, SvelteKit or Astro host owns cookie handling, token refresh and verified claim checks.

## Framework mappings

Framework integration and backend integration are independent:

- React and Next.js hosts mount the component directly.
- Astro uses its React integration; authenticated per-request behaviour requires server rendering rather than a build-time-only page.
- Svelte uses a dedicated mounting bridge or Web Component boundary because it cannot render a React component directly.
- Every wrapper supplies the same plain TypeScript identity and access contracts regardless of its backend provider.

## Revocation, offline work and attribution

- Access snapshots carry revisions so stale updates can be detected by provider adapters.
- Revocation must disable protected commands and stop or downgrade collaboration access without waiting for a reload.
- Offline edits remain pending until the backend reauthorises them; reconnect must not upload edits under an expired grant.
- Authenticated mutations should retain a stable actor id for audit and attribution, separate from the ephemeral collaboration client id.
- Deleted users and expired share links require explicit behaviour and negative tests.

## Comment authorship and undo

Upstream comments serialise an author display string and allow only that author string to edit or delete its message. An account-backed adapter must preserve the `.figcraft` author field for file compatibility, but it must not trust a caller-supplied display name as proof of identity. The host supplies the display value, while any backend authorisation uses the verified principal. The comment port must document how stable principal attribution is retained without changing the upstream file format.

Live undo remains scoped to the collaboration client and its own accepted batches, as upstream implements it. Authentication must not silently turn this into cross-device or account-wide undo. AI-agent comment attribution remains the upstream `agent` marker rather than a new product role.

## Resource coverage

Apply this boundary to comments, versions, branches, libraries, assets or plugins only where upstream Figcraft already has corresponding access behaviour. Do not assume document ownership grants unrelated administration capabilities; map and test each upstream behaviour before adding it.

## Adapter conformance

Every provider adapter must run the shared suite in `tests/contracts/`. At minimum it must prove:

- authentication and sign-out transitions;
- anonymous or share-link access where supported;
- view, comment and edit separation;
- ownership and membership grants;
- revocation and expiry while the editor is open;
- denial of unauthorised backend reads and mutations;
- reconnect behaviour after the grant changes.

The in-memory adapter is a behavioural reference, not a security boundary.
