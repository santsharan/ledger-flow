-- Each evaluation is an immutable decision record. The rules engine does not update it.

CREATE TABLE risk_evaluations (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_minor                 bigint NOT NULL,
  currency                     char(3) NOT NULL,
  merchant_age_days            integer NOT NULL,
  merchant_recent_count        integer NOT NULL,
  customer_recent_count        integer NOT NULL,
  historical_transaction_count integer NOT NULL,
  failed_attempts              integer NOT NULL,
  country                      char(2) NOT NULL,
  ip_risk                      text NOT NULL,
  device_risk                  text NOT NULL,
  decision                     text NOT NULL CHECK (decision IN ('APPROVE', 'REVIEW', 'DECLINE')),
  risk_score                   integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  reason_codes                 jsonb NOT NULL,
  engine                       text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_evaluations_decision_idx ON risk_evaluations (decision, created_at DESC);

CREATE FUNCTION risk_evaluations_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk_evaluations are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_evaluations_no_mutation
  BEFORE UPDATE OR DELETE ON risk_evaluations
  FOR EACH ROW EXECUTE FUNCTION risk_evaluations_reject_mutation();
