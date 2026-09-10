# Transaction Processing API

A production-minded REST API for user accounts, balances, and atomic balance transfers. It demonstrates PostgreSQL transactions, deterministic row locking, database-backed idempotency, JWT authentication, authorization, validation, structured logging, automated integration tests, Docker, graceful shutdown, and CI.

## Technology stack

| Component | Choice |
| --- | --- |
| Runtime | Node.js 22+ with TypeScript |
| HTTP framework | Fastify 5 |
| Database | PostgreSQL 17 |
| Validation | Zod 4 |
| Authentication | JWT via `@fastify/jwt` |
| Database driver | `pg` |
| Tests | Vitest 4 with a real PostgreSQL database |
| Operations | Docker Compose, health checks, graceful shutdown, GitHub Actions |

The project was type-checked and built with Node.js 24.19.0 and npm 11.9.0. The Docker image deliberately targets Node.js 22, which is the minimum supported version.

## Architecture

The application is organized into route modules, focused domain services, shared infrastructure, and SQL migrations:

```text
src/
  app.ts                    Fastify composition, auth, errors, health check
  server.ts                 Process startup and graceful shutdown
  modules/
    auth/                   Login and token issuance
    users/                  User creation, details, and balance
    transfers/              Atomic transfer and idempotency logic
    transactions/           Authorized history query and pagination
  db/                       Migration runner
  lib/                      Passwords, errors, serialization, validation
database/
  migrations/               Versioned PostgreSQL schema
  init/                     Test database initialization for Docker
test/                       Unit and PostgreSQL integration tests
docs/                       OpenAPI, request examples, and interview guide
```

Balances and transfer amounts use PostgreSQL `BIGINT` and represent the smallest currency unit. They are returned as JSON strings so values are never silently rounded by JavaScript.

## Prerequisites

Choose either the Docker path or the local-development path.

- Docker Engine with Docker Compose v2; or
- Node.js 22+, npm 10+, and PostgreSQL 17.

## Environment configuration

Copy the example file:

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Yes | `development`, `test`, or `production` |
| `HOST` | Yes | Bind address; normally `0.0.0.0` |
| `PORT` | Yes | HTTP port; default `3000` |
| `LOG_LEVEL` | Yes | Pino-compatible log level |
| `DATABASE_URL` | Yes | PostgreSQL connection URL for the API |
| `TEST_DATABASE_URL` | For tests | Separate PostgreSQL database used by integration tests |
| `JWT_SECRET` | Yes | Random secret containing at least 32 characters |
| `JWT_EXPIRES_IN` | Yes | Token lifetime such as `1h` |

Never commit `.env` or real secrets.

## Quick start with Docker

From a clean clone:

```bash
docker compose up --build -d
docker compose ps
curl http://localhost:3000/health
```

Expected health response:

```json
{"status":"ok"}
```

The API container waits for PostgreSQL, runs migrations, applies idempotent sample data, and starts the server. The API base URL is `http://localhost:3000`.

Stop the stack with:

```bash
docker compose down
```

Reset both databases and all local balances with:

```bash
docker compose down -v
docker compose up --build -d
```

The `-v` command deletes the local PostgreSQL volume; use it only when a full reset is intended.

## Local installation

Start only PostgreSQL in Docker:

```bash
docker compose up -d postgres
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Without Docker, create the `transaction_api` and `transaction_api_test` databases in PostgreSQL, update both database URLs in `.env`, and run the same npm commands.

Build and run the production JavaScript output:

```bash
npm run build
npm start
```

## Seed accounts

The seeder is safe to run repeatedly and does not reset existing balances.

| Email | Password | Role | Initial balance |
| --- | --- | --- | --- |
| `alice@example.com` | `Password123!` | user | `100000` |
| `bob@example.com` | `Password123!` | user | `25000` |
| `admin@example.com` | `Password123!` | admin | `0` |

These credentials are for local assessment use only.

## Running tests

Start the PostgreSQL service from a clean Docker volume, then run:

```bash
docker compose up -d postgres
npm ci
npm test
```

The integration suite migrates `TEST_DATABASE_URL` and truncates only that test database between tests. It covers:

- successful transfer;
- insufficient balance with unchanged balances;
- invalid amount;
- duplicate idempotency request;
- concurrent overspending attempt;
- unauthorized request.

Additional verification commands:

```bash
npm run typecheck
npm run build
```

## API endpoints

Full request and response schemas are in [docs/openapi.yaml](docs/openapi.yaml). Ready-to-run examples are in [docs/requests.http](docs/requests.http).

| Method | URL | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Database-aware health check |
| `POST` | `/users` | No | Create a zero-balance user |
| `POST` | `/auth/login` | No | Obtain a bearer token |
| `GET` | `/users/:id` | Yes | Get own user details; admin can access any user |
| `GET` | `/users/:id/balance` | Yes | Get current authorized balance |
| `POST` | `/transfers` | Yes | Atomically transfer balance |
| `GET` | `/transactions` | Yes | Paginated authorized transaction history |

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"Password123!"}'
```

Use the returned access token as `Authorization: Bearer <token>`.

### Transfer

```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -H 'Idempotency-Key: transfer-demo-0001' \
  -d '{
    "fromUserId":"11111111-1111-4111-8111-111111111111",
    "toUserId":"22222222-2222-4222-8222-222222222222",
    "amount":10000
  }'
```

The first completed request returns `201`. Repeating the same body and key returns the same transaction with `200` and `meta.idempotentReplayed: true`. Reusing that key with different transfer data returns `409 IDEMPOTENCY_KEY_REUSED`.

### Transaction history

```bash
curl 'http://localhost:3000/transactions?page=1&pageSize=20&status=completed' \
  -H 'Authorization: Bearer <token>'
```

Normal users are always restricted to transactions they sent or received. Admins may query all transactions or add a `userId` filter.

## Consistent error format

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "User has insufficient balance.",
    "details": {
      "transactionId": "832a10c5-1aa8-4f18-b528-e4ce4abc6974",
      "idempotentReplayed": false
    }
  }
}
```

Internal stack traces, SQL details, passwords, bearer tokens, and secrets are never returned.

## Technical decisions

### Database integrity

- `users.balance >= 0` is enforced by a database check constraint.
- Transaction amounts must be greater than zero.
- Sender and receiver must differ.
- Foreign keys prevent orphaned transactions.
- Status/timestamp combinations are constrained.
- `(from_user_id, idempotency_key)` is unique.
- History filters have sender, receiver, and status indexes.

Application validation improves messages, but correctness does not depend on it alone.

### Atomicity and concurrency

Each transfer uses one PostgreSQL transaction. Both user rows are selected `FOR UPDATE` in UUID order. The sender debit also includes `WHERE balance >= amount`, and the database forbids negative balances. Therefore two simultaneous debits cannot both spend the same balance. Deterministic lock ordering also avoids deadlocks between opposing transfers.

An insufficient transfer is stored as `failed` and committed without changing either balance. A completed transfer commits both balance updates and its transaction status together. Unexpected errors roll back the whole database transaction.

### Idempotency

Idempotency is scoped to the authenticated sender. A transaction-scoped PostgreSQL advisory lock serializes simultaneous requests using the same sender/key pair. The database unique constraint is the final protection against duplicates.

A SHA-256 fingerprint binds the key to `fromUserId`, `toUserId`, and `amount`. A matching retry replays the existing transaction; a different payload using the same key is rejected.

### Authentication and authorization

Passwords are hashed with Node.js `scrypt`, a random salt, and timing-safe comparison. JWTs identify the user and role. Protected routes reject invalid tokens. Normal users may only debit their own account and inspect their own profile, balance, and transaction history.

### Logging and operations

Fastify/Pino emits structured JSON logs for created, completed, failed, and unexpected transfer events. Authorization headers, cookies, passwords, tokens, and access tokens are redacted. The process handles `SIGINT` and `SIGTERM` for graceful shutdown. Docker and CI both use PostgreSQL health checks.

## Known limitations and production improvements

- This assessment models one generic currency in its smallest unit; production should add currency codes and prevent cross-currency transfers without conversion.
- New users start with zero balance. Real funding should come from a separate, audited ledger/deposit workflow.
- JWT revocation and refresh tokens are not implemented.
- Rate limiting, account lockout, MFA, and email verification are outside the assessment scope.
- Very large installations should use a double-entry ledger, an outbox for downstream events, key rotation, tracing, metrics, backup/restore drills, and read models for history queries.
- Pending transaction recovery is minimal because transfers complete in one database transaction; a multi-service workflow would need a durable state machine and reconciliation job.

## CI

`.github/workflows/ci.yml` starts PostgreSQL 17 and runs installation, type checking, the full test suite, and the production build on pushes and pull requests.

## AI assistance

See [AI-USAGE.md](AI-USAGE.md) for the required disclosure and review process.
