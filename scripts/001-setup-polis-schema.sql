-- Polis schema for Amazon Aurora DSQL.
-- Notes for DSQL: no SERIAL/sequences (UUIDs generated in app code),
-- no foreign key constraints (relationships enforced in app code),
-- each DDL in its own transaction, indexes created with CREATE INDEX ASYNC.
-- This mirrors lib/setup.ts (ensureSchema), which is what actually runs at setup.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  handle VARCHAR(40),
  created_at TIMESTAMPTZ
);
COMMIT;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY,
  owner_user_id UUID,
  owner_token UUID,
  name VARCHAR(60),
  persona JSONB,
  goal TEXT,
  location VARCHAR(60) DEFAULT 'plaza',
  balance BIGINT DEFAULT 1000,
  reputation INT DEFAULT 0,
  next_tick_seq BIGINT DEFAULT 0,
  status VARCHAR(16) DEFAULT 'alive',
  last_tick_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
COMMIT;

-- For databases created before ownership existed.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_token UUID;
COMMIT;

CREATE TABLE IF NOT EXISTS world_events (
  id UUID PRIMARY KEY,
  agent_id UUID,
  kind VARCHAR(24),
  payload JSONB,
  location VARCHAR(60),
  created_at TIMESTAMPTZ
);
COMMIT;

CREATE TABLE IF NOT EXISTS world_counters (
  counter_name VARCHAR(40),
  shard INT,
  value BIGINT DEFAULT 0,
  PRIMARY KEY (counter_name, shard)
);
COMMIT;

CREATE TABLE IF NOT EXISTS ledger (
  id UUID PRIMARY KEY,
  agent_id UUID,
  delta BIGINT,
  balance_after BIGINT,
  reason VARCHAR(40),
  ref_id UUID,
  created_at TIMESTAMPTZ
);
COMMIT;

-- Composite PK keeps each directed bond (agent_id -> other_id) unique, so the
-- upsert in bumpRelationship can't create duplicate, double-counted rows.
CREATE TABLE IF NOT EXISTS relationships (
  agent_id UUID,
  other_id UUID,
  sentiment INT DEFAULT 0,
  last_reason VARCHAR(40),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (agent_id, other_id)
);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_created_at ON world_events (created_at);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_agent_id ON world_events (agent_id);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_agents_owner ON agents (owner_user_id);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_ledger_agent ON ledger (agent_id, created_at);
COMMIT;
