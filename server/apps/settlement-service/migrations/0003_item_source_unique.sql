-- A capture, refund or chargeback can belong to only one settlement.
-- Recalculating a later batch must not pick the same source up again (ADR-010).

CREATE UNIQUE INDEX settlement_items_source_global_unique
  ON settlement_items (item_type, source_id);
