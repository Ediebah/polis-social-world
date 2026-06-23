-- Verify the relationships fix on Amazon Aurora DSQL.
-- Run this in the DSQL Query Editor AFTER you have:
--   1. DROP TABLE relationships;
--   2. hit /api/setup  (recreates it with PRIMARY KEY (agent_id, other_id))
--
-- What it proves, with no LLM and no app code:
--   * the composite primary key exists  -> the ON CONFLICT below succeeds at all.
--     (If the table still had the old `id` PK, this errors with
--      "no unique or exclusion constraint matching the ON CONFLICT specification".)
--   * the upsert accumulates into ONE row instead of creating duplicates
--     -> the bug that double-counted sentiment is gone.
--
-- Uses two real seed citizens (Bex Tully, Ivo Lark). Cleans up after itself.

-- --- bond, first time (creates the row) --------------------------------------
INSERT INTO relationships (agent_id, other_id, sentiment, last_reason, updated_at)
VALUES (
  (SELECT id FROM agents WHERE name = 'Bex Tully' LIMIT 1),
  (SELECT id FROM agents WHERE name = 'Ivo Lark'  LIMIT 1),
  8, 'verify', now()
)
ON CONFLICT (agent_id, other_id) DO UPDATE
  SET sentiment  = LEAST(100, GREATEST(-100, relationships.sentiment + EXCLUDED.sentiment)),
      last_reason = EXCLUDED.last_reason,
      updated_at  = EXCLUDED.updated_at;
COMMIT;

-- --- bond, second time (must UPDATE the same row, not insert a new one) -------
INSERT INTO relationships (agent_id, other_id, sentiment, last_reason, updated_at)
VALUES (
  (SELECT id FROM agents WHERE name = 'Bex Tully' LIMIT 1),
  (SELECT id FROM agents WHERE name = 'Ivo Lark'  LIMIT 1),
  8, 'verify', now()
)
ON CONFLICT (agent_id, other_id) DO UPDATE
  SET sentiment  = LEAST(100, GREATEST(-100, relationships.sentiment + EXCLUDED.sentiment)),
      last_reason = EXCLUDED.last_reason,
      updated_at  = EXCLUDED.updated_at;
COMMIT;

-- --- proof: expect rows = 1 and sentiment = 16 -------------------------------
SELECT count(*) AS rows, max(sentiment) AS sentiment
FROM   relationships
WHERE  agent_id = (SELECT id FROM agents WHERE name = 'Bex Tully' LIMIT 1)
  AND  other_id = (SELECT id FROM agents WHERE name = 'Ivo Lark'  LIMIT 1);

-- --- cleanup ----------------------------------------------------------------
DELETE FROM relationships
WHERE  last_reason = 'verify'
  AND  agent_id = (SELECT id FROM agents WHERE name = 'Bex Tully' LIMIT 1)
  AND  other_id = (SELECT id FROM agents WHERE name = 'Ivo Lark'  LIMIT 1);
COMMIT;
