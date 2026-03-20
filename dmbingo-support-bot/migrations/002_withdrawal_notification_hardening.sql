DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'withdrawals_request'
      AND column_name = 'last_error'
  ) THEN
    ALTER TABLE withdrawals_request ADD COLUMN last_error TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'withdrawals_request_text_status_check'
  ) THEN
    ALTER TABLE withdrawals_request DROP CONSTRAINT withdrawals_request_text_status_check;
  END IF;
END $$;

ALTER TABLE withdrawals_request
  ADD CONSTRAINT withdrawals_request_text_status_check
  CHECK (text_status IN ('pending','processing','sent','finished','failed'));

CREATE INDEX IF NOT EXISTS idx_withdrawals_request_pending_fifo
  ON withdrawals_request (text_status, withdrawal_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_request_update_scan
  ON withdrawals_request (status, text_status, withdrawal_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_request_processing_stale
  ON withdrawals_request (text_status, processed_at);
