DROP INDEX IF EXISTS consultations_smol_job_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS consultations_smol_job_id_key
  ON consultations (smol_job_id);
