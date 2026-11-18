-- Preserve raw observations, including previous runs without immutable case identities.
ALTER TABLE arena_runs ADD COLUMN cohort_sha256 TEXT
  CHECK (cohort_sha256 IS NULL OR (length(cohort_sha256) = 64 AND cohort_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE arena_runs ADD COLUMN case_sha256 TEXT
  CHECK (case_sha256 IS NULL OR (length(case_sha256) = 64 AND case_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX arena_evidence_by_case ON arena_runs(model, cohort_sha256, knobs_json, case_sha256)
  WHERE cohort_sha256 IS NOT NULL AND case_sha256 IS NOT NULL;

-- Match arena/score.ts scoreCohorts. Replays retain the adverse outcome for a distinct input.
CREATE VIEW arena_evidence_scores AS
WITH units AS (
  SELECT model, cohort_sha256, knobs_json, case_sha256,
    MIN(seed_class = 'clean') AS clean,
    MAX(error IS NOT NULL) OR MIN(seed_class = 'clean') <> MAX(seed_class = 'clean') AS incomplete,
    MIN(caught) AS caught, MAX(false_alarm) AS alarm
  FROM arena_runs
  WHERE cohort_sha256 IS NOT NULL AND case_sha256 IS NOT NULL
  GROUP BY model, cohort_sha256, knobs_json, case_sha256
)
SELECT model, cohort_sha256, knobs_json,
  SUM(NOT clean AND NOT incomplete) AS n_seeded,
  SUM(clean AND NOT incomplete) AS n_clean,
  SUM(incomplete) AS n_incomplete,
  AVG(CASE WHEN NOT clean AND NOT incomplete THEN caught END) AS catch_rate,
  AVG(CASE WHEN clean AND NOT incomplete THEN alarm END) AS false_alarm_rate
FROM units GROUP BY model, cohort_sha256, knobs_json;
