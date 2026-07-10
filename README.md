# Finance Dashboard

A personal finance dashboard for tracking bank accounts, transactions, and spending via Plaid integration.

## Stack

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript
- **Backend**: Node.js + Next.js API routes + TypeScript
- **Database**: PostgreSQL 17 + Prisma ORM
- **Authentication**: Auth.js (database sessions)
- **Integrations**: Plaid API (bank data aggregation)
- **Background Jobs**: Configurable queue (in-process for dev, BullMQ+Redis for production)
- **Testing**: Vitest + Node fetch
- **Linting & Type Checking**: ESLint + TypeScript

## Local Development

### Prerequisites

- Node.js 24+
- PostgreSQL 17 (via Homebrew or Docker)
- npm 10+

### Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone <repo>
   cd finance-dashboard
   npm install
   ```

2. Create a `.env` file from `.env.example` and fill in required values:
   ```bash
   cp .env.example .env
   ```
   At minimum:
   - `DATABASE_URL`: Your local Postgres connection
   - `AUTH_SECRET`: Generate with `openssl rand -base64 32`
   - An authentication provider: either `GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET` or `EMAIL_SERVER`+`EMAIL_FROM`

3. Set up the database:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

### Testing

Tests use a separate `finance_dashboard_test` database:

```bash
npx vitest run
```

By default, tests skip BullMQ tests (which require Redis). To run full tests with Redis:

```bash
REDIS_URL=redis://localhost:6379 npx vitest run
```

See `.github/workflows/ci.yml` for how CI runs tests with both Postgres and Redis services.

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)**: System design, data flow, and component overview.
- **[Decisions](docs/DECISIONS.md)**: Architectural decision log (why certain choices were made).
- **[Deployment](docs/DEPLOYMENT.md)**: Production configuration, environment variables, scaling, and webhook setup.

## Project Structure

```
src/
  app/                 # Next.js App Router pages + /api route handlers
  components/          # React components
  server/
    auth/             # Auth.js configuration + requireUser()
    db/               # Prisma client
    lib/              # Utilities (env, errors, crypto, money, logging)
    services/         # Business logic (plaid, items, sync, categorization, ...)
    jobs/             # Job queue (drivers, handlers, boot)
  shared/schemas/      # Zod schemas shared by client and server
prisma/
  schema.prisma       # Database schema
  migrations/         # Prisma migrations
tests/                # Test files
docs/                 # Documentation
.github/workflows/    # CI/CD
```

## Development Commands

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run start`: Run production build
- `npm run lint`: Run ESLint
- `npm run typecheck`: Run TypeScript type checker
- `npm test`: Run tests (alias for `npx vitest run`)
- `npm run db:migrate`: Run pending Prisma migrations
- `npm run db:seed`: Seed database with initial data
