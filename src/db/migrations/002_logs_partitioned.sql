DROP TABLE IF EXISTS logs;

CREATE TABLE logs (
  id          BIGINT       GENERATED ALWAYS AS IDENTITY,
  timestamp   TIMESTAMPTZ  NOT NULL,
  level       VARCHAR(10)  NOT NULL,
  service     VARCHAR(255) NOT NULL,
  message     TEXT         NOT NULL,
  attributes  JSONB        DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  DEFAULT now(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp
  ON logs (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_service_level_timestamp
  ON logs (service, level, timestamp DESC);

