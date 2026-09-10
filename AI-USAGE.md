# AI Usage Disclosure

## Tool used

ChatGPT/Codex was used as an AI-assisted development tool for this assessment.

## What AI assisted with

- Converting the assessment brief into an implementation checklist.
- Drafting the initial folder structure and TypeScript scaffolding.
- Suggesting SQL constraints, indexes, API validation, and error codes.
- Drafting test cases, Docker configuration, OpenAPI documentation, and README sections.
- Reviewing the implementation for race conditions, duplicate requests, unsafe logging, and missing operational instructions.

## Human-reviewed and modified areas

Every generated section was reviewed against the assessment requirements. In particular:

- Transfer correctness was moved into one PostgreSQL transaction.
- User rows are locked in deterministic UUID order with `FOR UPDATE`.
- The debit contains a second atomic `balance >= amount` guard.
- Database constraints protect non-negative balances, positive amounts, different users, status timestamps, foreign keys, and idempotency uniqueness.
- Authorization limits ordinary users to their own account and transaction history.
- Logs and API errors were checked to avoid tokens, passwords, secrets, SQL details, and stack traces.
- Tests use a real PostgreSQL database because an in-memory mock would not accurately validate row locks and transaction behavior.

## Example of incorrect or incomplete AI output

An early suggestion represented money as a JavaScript floating-point number in storage. That was rejected because floating-point arithmetic can introduce rounding errors. The final schema stores balances and amounts as PostgreSQL `BIGINT` in the smallest currency unit, validates request amounts as safe integers, and serializes stored amounts as strings.

## How the output was verified

- TypeScript strict type checking: `npm run typecheck`.
- Production compilation: `npm run build`.
- Automated unit and PostgreSQL integration tests are included and run with `npm test` when the documented PostgreSQL test database is available.
- The concurrency test sends two 80,000 transfers at nearly the same time from a 100,000 balance and verifies that only one completes, one fails, and the sender ends with 20,000.
- The idempotency test verifies one stored transaction and one balance deduction across repeated requests.
- SQL migrations, constraints, indexes, authorization branches, and error responses were manually reviewed.

I understand the submitted code and can explain or modify the architecture, transaction flow, idempotency strategy, database design, security controls, and tests during a follow-up interview.
