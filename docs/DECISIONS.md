# Decision Log

Running log of architectural decisions. Newer entries win over older ones; a reversed
decision gets a new entry referencing the old one, never an edit-in-place.

Format: **ID — decision** · rationale · rejected alternative(s).

---

**D-001 — Full-stack TypeScript: Next.js App Router + Prisma + Postgres + Auth.js**
Per project brief (decided upstream). One language end-to-end, shared Zod types across
the boundary, Prisma migrations built in. Rejected: separate Node API + SPA (two
deployables, duplicated types, no benefit at this scale).

**D-002 — Auth.js over Clerk**
Identity data stays in our Postgres (one backup/privacy story for a finance app), no
per-MAU cost, no external dependency in every session check. Clerk's advantages
(polished hosted UI, org management) don't apply to a single-household app. Cost: we
own the sign-in UI. Rejected: Clerk, Lucia (deprecated maintenance status).

**D-003 — Database sessions, not JWT**
Instant revocation for financial data; trivial lookup cost at our scale; Postgres
already present. Rejected: JWT sessions — statelessness buys nothing here and costs
revocation and token-bloat handling.

**D-004 — Rename Auth.js `Account` model to `AuthAccount`**
Auth.js's Prisma adapter model name collides with the domain concept "bank account",
which is the more important name in a finance app. The adapter accepts custom model
mapping. Rejected: naming the domain model `BankAccount` — the domain should own the
good name; OAuth plumbing is the guest here.

**D-005 — `BigInt` (Postgres `bigint`) for every money column**
`integer` cents overflow at ~$21.4M — reachable for balances/net worth. `bigint` costs
4 bytes/row and removes the overflow class entirely. DTO layer converts via a single
`moneyToNumber()` (values ≪ 2^53, safe) so JSON stays `number`. Rejected: `Int`
(overflow risk), `Decimal` (float-adjacent handling in JS, slower comparisons, and the
brief mandates integer minor units).

**D-006 — Preserve Plaid's amount sign convention (positive = outflow)**
Ingestion stores exactly what Plaid sends; no sign-flipping at the boundary.
Reconciliation and dedup logic compare like-for-like with Plaid payloads, which is where
correctness risk concentrates. Presentation semantics (expenses as positive spend,
income views) live in the aggregation/UI layer, which has exhaustive unit tests.
Rejected: normalizing to accounting convention (negative = outflow) at ingestion —
every future Plaid-facing feature would need to remember the flip; bugs there corrupt
data, whereas display bugs are cosmetic and fixable.

**D-007 — `PlaidService` interface; SDK never imported outside `services/plaid/`**
Business logic depends on our interface and our DTOs. Enables `FakePlaidService` for
fast deterministic tests, and swapping aggregators is theoretically a one-directory
change. Rejected: using the SDK directly in services — couples reconciliation tests to
network mocking and leaks SDK types everywhere.

**D-008 — System categories are rows with `userId = null`, same table as user categories**
One FK from Transaction, one query path, uniform tree logic. Users see system + own
categories merged. Rejected: separate `SystemCategory` table (duplicate tree/FK logic)
and enum-based categories (custom categories would require migrations, violating the
brief).

**D-009 — Plaid→app category mapping is a seeded table, not code**
`PlaidCategoryMapping(plaidDetailed → categorySlug)` with primary-level fallback rows.
Improving mappings is a data change; transactions store raw Plaid categories so
re-mapping is retroactive. Rejected: switch statement (code change per mapping tweak,
violates brief), mapping at display time (aggregation queries couldn't group by
category in SQL).

**D-010 — No regex in CategoryRule v1**
`CONTAINS / EQUALS / STARTS_WITH` (case-insensitive) + amount range + account scope.
Regex adds ReDoS surface and rule-authoring UX complexity before any user has asked for
it. Revisit if real rules can't be expressed. Rejected: regex matchType now.

**D-011 — Cursor (keyset) pagination on all list endpoints**
Opaque base64 cursor over `(date, id)`. Stable under concurrent inserts from sync jobs;
O(1) page cost regardless of depth. Rejected: offset pagination — pages shift when a
sync inserts rows mid-browse, and deep offsets scan.

**D-012 — One generic aggregation endpoint instead of per-chart endpoints**
`groupBy`/`metric`/filters as validated enums; every dashboard chart is a parameter
combination; new charts need no backend change (per brief). Enum-only group-by keys
mean no dynamic SQL identifiers from user input. Rejected: endpoint-per-chart (handler
sprawl, N× auth/filter surfaces), GraphQL (a second API paradigm for one screen).

**D-013 — Webhook handlers: verify → record → enqueue → 200; idempotency is layered**
No sync work in the request path (brief). Idempotency comes from three independent
layers: WebhookEvent payload-hash dedup (best effort), queue dedup key per item, and —
decisive — cursor+upsert sync semantics that make duplicate runs harmless. Rejected:
relying on a single dedup mechanism; Plaid webhook deliveries have no globally unique
id to key on.

**D-014 — Dev database = local/Homebrew Postgres or Docker, via `DATABASE_URL` only**
This machine has Postgres 17 via Homebrew and no Docker; `docker-compose.yml` ships for
contributors who prefer containers. Nothing in the code knows which one is running.
Rejected: requiring Docker (blocks development on this machine).

**D-015 — Orchestration: M0 built by the architect, delegation begins M1+**
M0 establishes the conventions (folder structure, error/env/logging patterns, CI) that
every delegated task spec references; delegating it would mean reviewing against
standards that don't exist yet. From M1 on, isolated features/UI/tests/docs are
delegated with task specs per the orchestration protocol; the Plaid token-exchange
path and security-sensitive review are never delegated (per brief).

**D-017 — Production queue driver deferred to M8**
M3 ships the `JobQueue` interface and the fully tested in-process driver. The
production driver (BullMQ vs. platform cron/queue — the brief allows either) is
a deployment decision; implementing BullMQ now would add an unexercisable,
untestable-locally code path (no Redis on the dev machine). `QUEUE_DRIVER=bullmq`
fails loudly until M8. Handlers are driver-agnostic and idempotent by
construction, so the swap is config + one driver file. Rejected: shipping an
unverified BullMQ driver in M3.

**D-016 — Vitest over Jest**
First-class TS/ESM without transform config, same assertion API, faster watch mode,
maintained momentum in the Next.js ecosystem. Rejected: Jest (ESM friction with
Next 16 / React 19 stack).

**D-018 — Reconnect completion is client-asserted, webhook-confirmed**
After update-mode Link succeeds, the client POSTs `/items/:id/reconnected`; the server
sets the item ACTIVE, clears `errorCode`, and enqueues a sync. The access token is
unchanged in update mode, so this path never touches token material. A false assertion
self-corrects: the next sync fails REAUTH and the item returns to `LOGIN_REQUIRED`.
The `LOGIN_REPAIRED` webhook does the same server-side when deliverable (production);
locally (no public webhook URL) the client assertion is the only signal. Rejected:
webhook-only (dead in local dev, laggy in prod), re-running token exchange (update
mode issues no new public_token to exchange).

**D-019 — Disconnect revokes at Plaid but retains history**
`DELETE /items/:id` calls Plaid `/item/remove`, then marks the item `DISCONNECTED`;
accounts and transactions stay readable (per §3 status comment). If Plaid reports the
item already gone (FATAL classification), disconnect proceeds — the goal state is
reached; retryable upstream failures propagate so the user can retry. Rejected: row
deletion (destroys transaction history the dashboards are built on), soft-delete
without Plaid revocation (institution keeps sharing data).
