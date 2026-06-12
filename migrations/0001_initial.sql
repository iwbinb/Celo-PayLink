CREATE TABLE IF NOT EXISTS paylinks (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  receiver_address TEXT NOT NULL,
  receiver_name TEXT,
  token_symbol TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_decimals INTEGER NOT NULL,
  amount TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  status TEXT NOT NULL,
  network TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  public_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  receipt_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  paylink_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  payer_address TEXT,
  receiver_address TEXT,
  token_address TEXT,
  amount_raw TEXT,
  amount_formatted TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  block_number INTEGER,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (paylink_id) REFERENCES paylinks(id)
);

CREATE TABLE IF NOT EXISTS agent_decision_logs (
  id TEXT PRIMARY KEY,
  paylink_id TEXT,
  attempt_id TEXT,
  action TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  result TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (paylink_id) REFERENCES paylinks(id),
  FOREIGN KEY (attempt_id) REFERENCES payment_attempts(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  paylink_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE,
  receipt_number TEXT NOT NULL UNIQUE,
  receiver_address TEXT NOT NULL,
  payer_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  network TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  agent_summary TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  FOREIGN KEY (paylink_id) REFERENCES paylinks(id),
  FOREIGN KEY (attempt_id) REFERENCES payment_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_paylinks_status ON paylinks(status);
CREATE INDEX IF NOT EXISTS idx_paylinks_created ON paylinks(created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_paylink ON payment_attempts(paylink_id);
CREATE INDEX IF NOT EXISTS idx_decisions_paylink ON agent_decision_logs(paylink_id);
