CREATE OR REPLACE VIEW agentic_economy AS
WITH oracle_wallets AS (
  SELECT *
  FROM (
    VALUES
      ('seer', 'GDEIKVQUISFSJKBQJWB254MFTAKGHNQJ66OKFZ7LVWJAWYGTY74GEKUM'),
      ('painter', 'GAJMWI2UBBFHZQYCPRH5XS53OLOA7DWM7LCBATA5B2HSR64MKRPI2JXR'),
      ('composer', 'GBZPU7IKRCPTAHV26PTXMR77RTD32O6JTDHMBOJ7FAA2DLMCMVFL4HJN'),
      ('scribe', 'GCBT3WX6V7LT2MHDR6CD4HXKEG3PLW5ND5LZQ24EWFV6BENEBDWSPGV6'),
      ('scholar', 'GDJTJ4RTU64GNGAXKZIVKL3GRCKD4DEX6ILUGFADNNJQPUEOAWYKFXIC'),
      ('informant', 'GA5O3DITSUCJGXCNNX6BFWBTYNLTPPMVC7LHN7RNTJR57AT6WNDEAXQL')
  ) AS wallets(oracle_id, oracle_wallet_address)
)
SELECT
  ow.oracle_id,
  COUNT(c.id)::INTEGER AS consultations,
  COALESCE(SUM(c.payment_amount_usdc), 0)::NUMERIC(12, 6) AS gross_revenue_usdc,
  COALESCE(SUM(c.estimated_model_cost_usdc), 0)::NUMERIC(12, 6) AS estimated_model_cost_usdc,
  COALESCE(SUM(c.estimated_profit_usdc), 0)::NUMERIC(12, 6) AS estimated_profit_usdc,
  ow.oracle_wallet_address
FROM oracle_wallets ow
LEFT JOIN consultations c ON c.oracle_id = ow.oracle_id
GROUP BY ow.oracle_id, ow.oracle_wallet_address;
