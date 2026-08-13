CREATE TABLE IF NOT EXISTS logs_agg_1m (
  bucket_start TIMESTAMPTZ  NOT NULL,
  service      VARCHAR(255) NOT NULL,
  level        VARCHAR(10)  NOT NULL,
  count        BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, service, level)
);
