CREATE TABLE IF NOT EXISTS logs (
  id          BIGSERIAL    PRIMARY KEY,
  timestamp   TIMESTAMPTZ  NOT NULL,
  level       VARCHAR(10)  NOT NULL,
  service     VARCHAR(255) NOT NULL,
  message     TEXT         NOT NULL,
  attributes  JSONB        DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp
  ON logs (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_service_level_timestamp
  ON logs (service, level, timestamp DESC);


