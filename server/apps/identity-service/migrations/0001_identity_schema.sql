-- Identity context: users, roles, permissions and refresh tokens.
-- Owns nothing about merchants, payments or balances (bounded-contexts.md).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'LOCKED')),
  -- Set for merchant-scoped users; NULL for platform staff.
  merchant_id   uuid,
  failed_logins integer NOT NULL DEFAULT 0,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without the citext extension, which is unavailable on some
-- managed PostgreSQL configurations.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_merchant_idx ON users (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE TABLE roles (
  name        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE permissions (
  name        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_name       text NOT NULL REFERENCES roles (name) ON DELETE CASCADE,
  permission_name text NOT NULL REFERENCES permissions (name) ON DELETE CASCADE,
  PRIMARY KEY (role_name, permission_name)
);

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_name   text NOT NULL REFERENCES roles (name) ON DELETE RESTRICT,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  text NOT NULL,
  PRIMARY KEY (user_id, role_name)
);

-- Refresh tokens are stored hashed: a database leak must not yield usable tokens.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens (id),
  user_agent  text,
  ip_address  inet
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, expires_at DESC);

-- Access tokens are stateless; revocation is an explicit deny-list consulted on every request.
CREATE TABLE revoked_access_tokens (
  token_id   uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason     text
);

CREATE INDEX revoked_access_tokens_expiry_idx ON revoked_access_tokens (expires_at);
