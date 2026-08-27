CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  email VARCHAR(320) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  idempotency_key VARCHAR(255) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  failure_code VARCHAR(80),
  failure_message VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  CHECK (from_user_id <> to_user_id),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (status = 'failed' AND failed_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'pending' AND completed_at IS NULL AND failed_at IS NULL)
  ),
  UNIQUE (from_user_id, idempotency_key)
);

CREATE INDEX idx_transactions_from_created
  ON transactions (from_user_id, created_at DESC);

CREATE INDEX idx_transactions_to_created
  ON transactions (to_user_id, created_at DESC);

CREATE INDEX idx_transactions_status_created
  ON transactions (status, created_at DESC);
