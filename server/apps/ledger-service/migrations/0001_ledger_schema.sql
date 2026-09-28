-- Ledger context: accounts, journals and immutable double-entry postings.
-- See docs/architecture/ledger-architecture.md and ADR-002 / ADR-003.
--
-- Posted entries are immutable at the database, not only in the application:
-- triggers reject UPDATE and DELETE. The single permitted journal mutation is
-- POSTED -> REVERSED, and only after a reversal journal exists.

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid,
  account_code  text NOT NULL,
  account_type  text NOT NULL
                  CHECK (account_type IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY')),
  currency      char(3) NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- NULL merchant_id means a platform account. Unique indexes are split because
-- PostgreSQL treats NULLs as distinct in a regular UNIQUE constraint.
CREATE UNIQUE INDEX accounts_merchant_code_currency_unique
  ON accounts (merchant_id, account_code, currency)
  WHERE merchant_id IS NOT NULL;

CREATE UNIQUE INDEX accounts_platform_code_currency_unique
  ON accounts (account_code, currency)
  WHERE merchant_id IS NULL;

CREATE INDEX accounts_merchant_idx ON accounts (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE TABLE journals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      text NOT NULL,
  reference_type      text NOT NULL,
  reference_id        text NOT NULL,
  currency            char(3) NOT NULL,
  description         text NOT NULL,
  status              text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  reverses_journal_id uuid REFERENCES journals (id),
  lines_digest        text NOT NULL,
  posted_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journals_reference_unique UNIQUE (reference_type, reference_id),
  CONSTRAINT journals_reversal_once UNIQUE (reverses_journal_id)
);

CREATE INDEX journals_transaction_idx ON journals (transaction_id);
CREATE INDEX journals_posted_at_idx ON journals (posted_at DESC);

CREATE TABLE ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id   uuid NOT NULL REFERENCES journals (id),
  account_id   uuid NOT NULL REFERENCES accounts (id),
  direction    text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     char(3) NOT NULL,
  sequence     integer NOT NULL CHECK (sequence > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_journal_sequence_unique UNIQUE (journal_id, sequence)
);

CREATE INDEX ledger_entries_account_created_idx ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ledger_entries_journal_idx ON ledger_entries (journal_id, sequence);

CREATE TABLE account_balances (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id),
  debit_minor  bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  balance_minor bigint NOT NULL DEFAULT 0,
  version      bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Entry currency must match both the journal and the account. A mixed-currency
-- journal is rejected here even if application validation is bypassed.
CREATE FUNCTION ledger_entries_validate_currency() RETURNS trigger AS $$
DECLARE
  journal_currency char(3);
  account_currency char(3);
BEGIN
  SELECT currency INTO journal_currency FROM journals WHERE id = NEW.journal_id;
  SELECT currency INTO account_currency FROM accounts WHERE id = NEW.account_id;

  IF journal_currency IS NULL OR account_currency IS NULL
     OR NEW.currency <> journal_currency
     OR NEW.currency <> account_currency THEN
    RAISE EXCEPTION 'ledger entry currency does not match the journal and account';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_currency
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_validate_currency();

-- Checked at commit, so a journal is only durable when it balances and has
-- at least two entries (invariants L1 and L3).
CREATE FUNCTION journal_must_balance() RETURNS trigger AS $$
DECLARE
  debit_total bigint;
  credit_total bigint;
  entry_count integer;
BEGIN
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0),
    COUNT(*)
  INTO debit_total, credit_total, entry_count
  FROM ledger_entries
  WHERE journal_id = NEW.journal_id;

  IF entry_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal % is not balanced (debits % credits % entries %)',
      NEW.journal_id, debit_total, credit_total, entry_count;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_journal_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_must_balance();

CREATE FUNCTION ledger_entries_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'posted ledger entries are immutable (ADR-003)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_reject_mutation();

-- The only legal journal update is POSTED -> REVERSED, and only once a reversal
-- journal referencing this one has been inserted in the same transaction.
CREATE FUNCTION journals_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journals cannot be deleted (ADR-003)';
  END IF;

  IF OLD.status = 'POSTED'
     AND NEW.status = 'REVERSED'
     AND NEW.transaction_id = OLD.transaction_id
     AND NEW.reference_type = OLD.reference_type
     AND NEW.reference_id = OLD.reference_id
     AND NEW.currency = OLD.currency
     AND NEW.description = OLD.description
     AND NEW.reverses_journal_id IS NOT DISTINCT FROM OLD.reverses_journal_id
     AND NEW.lines_digest = OLD.lines_digest
     AND NEW.posted_at = OLD.posted_at
     AND NEW.created_at = OLD.created_at
     AND EXISTS (SELECT 1 FROM journals WHERE reverses_journal_id = OLD.id)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'posted journals are immutable (ADR-003)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journals_no_mutation
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION journals_reject_mutation();
