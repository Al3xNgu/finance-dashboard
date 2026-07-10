# Production Deployment

## Environment Variables

Configure these in your production environment. Validation is strict; the app fails fast with readable errors if any required variable is missing or malformed.

### Core

- **NODE_ENV** (string, default: `development`): Set to `production`
- **DATABASE_URL** (string, required): PostgreSQL connection string, format `postgresql://user:pass@host:port/dbname`

### Authentication (required)

One of these sign-in providers must be configured:

- **AUTH_SECRET** (string, required, minimum 32 chars): Session encryption key. Generate: `openssl rand -base64 32`
- **GOOGLE_CLIENT_ID** / **GOOGLE_CLIENT_SECRET** (pair, optional): Google OAuth 2.0 credentials. Set both to enable Google sign-in.
- **EMAIL_SERVER** / **EMAIL_FROM** (pair, optional): SMTP server and sender address for magic-link emails. Format: `smtp://user:pass@host:port` or `sendmail://...`. Production requires either this pair or a Google OAuth pair.

### Plaid Integration

Enable by setting both PLAID_CLIENT_ID and PLAID_SECRET together. All three are required if any is set.

- **PLAID_ENV** (enum: `sandbox` or `production`, default: `sandbox`): Plaid environment. Production deployments should use `production`.
- **PLAID_CLIENT_ID** / **PLAID_SECRET** (pair, required if Plaid is used): Plaid API credentials.
- **PLAID_WEBHOOK_URL** (string, required if Plaid is used): Public HTTPS URL where Plaid sends webhooks. Must be reachable from the internet. Example: `https://yourdomain.com/api/v1/plaid/webhook`. See _Webhook Configuration_ below.
- **ENCRYPTION_KEY** (string, required if Plaid is used, 32 bytes base64): Encrypts Plaid access tokens at rest. Generate: `openssl rand -base64 32`. See _Token Rotation_ below.

### Background Jobs

- **QUEUE_DRIVER** (enum: `inprocess` or `bullmq`, default: `inprocess`)
  - `inprocess`: All jobs run synchronously in the same process. Requires a single long-running instance.
  - `bullmq`: Jobs are queued in Redis for reliable, distributed processing.
- **REDIS_URL** (string, required if `QUEUE_DRIVER=bullmq`): Redis connection string, format `redis://[:password@]host:port/[db]`.

## Deployment Models

### Single Instance

A single long-running Node process handles both the web server and all background jobs.

- Set `QUEUE_DRIVER=inprocess` (no Redis required).
- Magic-link rate limiting is in-memory per D-021; rate state resets on restart (acceptable for a single-instance app).
- No scaling beyond one process.

### Multi-Instance (Horizontal Scaling)

Multiple replicas of the app run behind a load balancer. Only feasible with Redis-backed infrastructure:

- Set `QUEUE_DRIVER=bullmq` and `REDIS_URL=redis://...` on every instance.
- Set `QUEUE_ROLE=producer` on all web replicas (they enqueue but never execute jobs) and run exactly one instance with `QUEUE_ROLE=worker` (or `all`) that consumes the queue. Running workers on every replica causes duplicate work and cross-replica sync races.
- Magic-link rate limiting is in-memory per instance (D-021); multi-instance setups should move the sliding window to Redis to share limits across replicas — not implemented in v1.

## Webhook Configuration

Plaid webhooks notify the app of events (new transactions, connection updates, authentication failures). To receive webhooks:

1. **Public HTTPS endpoint**: Your `PLAID_WEBHOOK_URL` must be publicly accessible over HTTPS.
   - Example production URL: `https://yourdomain.com/api/v1/plaid/webhook`
   - Local development (no public URL): webhooks are simply never delivered — verification is never skipped (any unverifiable request is rejected with 401). The 12-hour stale-item poller provides the fallback sync trigger (D-013/§6.6).
   
2. **Set PLAID_WEBHOOK_URL**: The app verifies webhook signatures using this URL. If not set, webhook endpoints are inactive.

3. **Webhook events**: See `src/app/api/v1/plaid/webhook/route.ts` for the event types and handlers.

## Initial Setup

After deployment, bootstrap the database:

```bash
npm run db:migrate
npm run db:seed
```

- `npm run db:migrate`: Applies any pending Prisma migrations (runs during deployment before the web server starts).
- `npm run db:seed`: Seeds the database with system categories and Plaid category mappings. Safe to run multiple times.

## Token Rotation

The **ENCRYPTION_KEY** encrypts stored Plaid access tokens. If you rotate the key:

1. All existing encrypted tokens become unreadable.
2. Users must reconnect their bank accounts (via the "Reconnect" link).
3. New tokens are encrypted with the new key.

Plan key rotations during maintenance windows and communicate with users in advance.

## References

- Environment schema: `src/server/lib/env.ts`
- Architecture: `docs/ARCHITECTURE.md`
- Decisions: `docs/DECISIONS.md` (esp. D-017, D-020, D-021)

## Reverse Proxy Requirements

The magic-link rate limiter keys on the first `X-Forwarded-For` hop. In production the app MUST sit behind a proxy/load balancer that **overwrites** (not appends to) `X-Forwarded-For` with the real client IP; if clients can reach the Node process directly, the header is client-controlled and the per-IP limit can be bypassed. The per-address limit does not canonicalize provider aliases (`user+tag@`), which is an accepted v1 limitation.
