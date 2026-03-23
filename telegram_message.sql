-- Create the table with a single-row constraint (id must always be 1)
CREATE TABLE IF NOT EXISTS telegram_message (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT telegram_message_single_row CHECK (id = 1)
);

-- Insert the default row if it doesn't exist
INSERT INTO telegram_message (id, enabled)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;