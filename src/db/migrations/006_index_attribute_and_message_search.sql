CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- jsonb_path_ops only supports the containment operator (@>), not ->> text
-- extraction — that's exactly what the query layer now uses for attr.* filters,
-- and it's ~3x smaller and cheaper to maintain than jsonb_ops.
CREATE INDEX IF NOT EXISTS idx_logs_attributes ON logs USING GIN (attributes jsonb_path_ops);

-- Supports the existing `message ILIKE '%...%'` predicate directly.
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);
