
CREATE INDEX IF NOT EXISTS idx_logs_attributes ON logs USING GIN (attributes jsonb_path_ops);
