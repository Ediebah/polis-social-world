-- Polis schema for Amazon Aurora DSQL.
-- Notes for DSQL: no SERIAL/sequences (UUIDs generated in app code),
-- no foreign key constraints (relationships enforced in app code),
-- each DDL in its own transaction, indexes created with CREATE INDEX ASYNC.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  handle VARCHAR(40),
  created_at TIMESTAMPTZ
);
COMMIT;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY,
  owner_user_id UUID,
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

CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_created_at ON world_events (created_at);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_agent_id ON world_events (agent_id);
COMMIT;

CREATE INDEX ASYNC IF NOT EXISTS idx_agents_owner ON agents (owner_user_id);
COMMIT;
