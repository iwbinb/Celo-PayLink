interface Env {
  DB: D1Database;
  CELO_NETWORK?: string;
  CELO_CHAIN_ID?: string;
  CELO_RPC_URL?: string;
  CELO_EXPLORER_URL?: string;
  USDC_ADDRESS?: string;
  DEFAULT_RECEIVER_ADDRESS?: string;
}

type PagesContext = EventContext<Env, string, Record<string, string | string[]>>;

const config = {
  network: "celo-sepolia",
  chainId: 11142220,
  rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
  explorerUrl: "https://celo-sepolia.blockscout.com",
  usdcAddress: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  defaultReceiver: "0x0000000000000000000000000000000000000001"
};

const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let schemaReady: Promise<void> | undefined;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS paylinks (
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
  )`,
  `CREATE TABLE IF NOT EXISTS payment_attempts (
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
  )`,
  `CREATE TABLE IF NOT EXISTS agent_decision_logs (
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
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
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
  )`,
  "CREATE INDEX IF NOT EXISTS idx_paylinks_status ON paylinks(status)",
  "CREATE INDEX IF NOT EXISTS idx_paylinks_created ON paylinks(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_attempts_paylink ON payment_attempts(paylink_id)",
  "CREATE INDEX IF NOT EXISTS idx_decisions_paylink ON agent_decision_logs(paylink_id)"
];

async function ensureSchema(env: Env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(
      schemaStatements.map((statement) => env.DB.prepare(statement))
    ).then(() => undefined);
  }
  await schemaReady;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

function text(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeAddress(value: string) {
  return value.trim();
}

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function parseAmount(amount: string, decimals: number) {
  const trimmed = String(amount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error("Amount must be a positive number with up to 6 decimals");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  const raw = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded);
  if (raw <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  return raw.toString();
}

function rawToAmount(raw: string, decimals: number) {
  const value = BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

function txUrl(txHash: string, env: Env) {
  const base = env.CELO_EXPLORER_URL || config.explorerUrl;
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function str(value: unknown) {
  return String(value ?? "");
}

function maybeStr(value: unknown) {
  return value === null || value === undefined ? undefined : String(value);
}

function num(value: unknown) {
  return Number(value ?? 0);
}

async function readBody<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

async function rpc<T>(env: Env, method: string, params: unknown[]) {
  const response = await fetch(env.CELO_RPC_URL || config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params
    })
  });
  const payload = (await response.json()) as { result?: T; error?: unknown };
  if (payload.error) {
    throw new Error(`Celo RPC error: ${JSON.stringify(payload.error)}`);
  }
  return payload.result as T;
}

function mapPayLink(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    publicId: str(row.public_id),
    title: str(row.title),
    purpose: str(row.purpose),
    receiverAddress: str(row.receiver_address),
    receiverName: maybeStr(row.receiver_name),
    tokenSymbol: str(row.token_symbol),
    tokenAddress: str(row.token_address),
    tokenDecimals: num(row.token_decimals),
    amount: str(row.amount),
    amountRaw: str(row.amount_raw),
    status: str(row.status),
    network: str(row.network),
    chainId: num(row.chain_id),
    publicUrl: maybeStr(row.public_url),
    expiresAt: str(row.expires_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    paidAt: maybeStr(row.paid_at),
    receiptId: maybeStr(row.receipt_id)
  };
}

function mapAttempt(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    paylinkId: str(row.paylink_id),
    txHash: str(row.tx_hash),
    payerAddress: maybeStr(row.payer_address),
    receiverAddress: maybeStr(row.receiver_address),
    tokenAddress: maybeStr(row.token_address),
    amountRaw: maybeStr(row.amount_raw),
    amountFormatted: maybeStr(row.amount_formatted),
    status: str(row.status),
    failureReason: maybeStr(row.failure_reason),
    blockNumber: row.block_number === null || row.block_number === undefined ? undefined : num(row.block_number),
    confirmedAt: maybeStr(row.confirmed_at),
    createdAt: str(row.created_at)
  };
}

function mapDecision(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    paylinkId: maybeStr(row.paylink_id),
    attemptId: maybeStr(row.attempt_id),
    action: str(row.action),
    inputSummary: str(row.input_summary),
    checks: JSON.parse(String(row.checks_json || "[]")),
    result: str(row.result),
    explanation: str(row.explanation),
    createdAt: str(row.created_at)
  };
}

function mapReceipt(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    paylinkId: str(row.paylink_id),
    attemptId: str(row.attempt_id),
    receiptNumber: str(row.receipt_number),
    receiverAddress: str(row.receiver_address),
    payerAddress: str(row.payer_address),
    tokenSymbol: str(row.token_symbol),
    amount: str(row.amount),
    txHash: str(row.tx_hash),
    network: str(row.network),
    explorerUrl: str(row.explorer_url),
    agentSummary: str(row.agent_summary),
    issuedAt: str(row.issued_at)
  };
}

async function getDetail(env: Env, publicId: string) {
  const paylinkRow = await env.DB.prepare(
    "SELECT * FROM paylinks WHERE public_id = ?"
  )
    .bind(publicId)
    .first<Record<string, unknown>>();
  if (!paylinkRow) return undefined;

  const paylink = mapPayLink(paylinkRow);
  const attempts = await env.DB.prepare(
    "SELECT * FROM payment_attempts WHERE paylink_id = ? ORDER BY created_at DESC"
  )
    .bind(paylink.id)
    .all<Record<string, unknown>>();
  const decisions = await env.DB.prepare(
    "SELECT * FROM agent_decision_logs WHERE paylink_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(paylink.id)
    .all<Record<string, unknown>>();
  const receiptRow = paylink.receiptId
    ? await env.DB.prepare("SELECT * FROM receipts WHERE id = ?")
        .bind(paylink.receiptId)
        .first<Record<string, unknown>>()
    : undefined;

  return {
    ...paylink,
    attempts: attempts.results.map(mapAttempt),
    decisions: decisions.results.map(mapDecision),
    receipt: receiptRow ? mapReceipt(receiptRow) : undefined
  };
}

async function createDecision(
  env: Env,
  args: {
    paylinkId?: string;
    attemptId?: string;
    action: string;
    inputSummary: string;
    checks: unknown[];
    result: "success" | "warning" | "failure" | "info";
    explanation: string;
  }
) {
  const id = makeId("dec");
  await env.DB.prepare(
    `INSERT INTO agent_decision_logs
      (id, paylink_id, attempt_id, action, input_summary, checks_json, result, explanation, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      args.paylinkId || null,
      args.attemptId || null,
      args.action,
      args.inputSummary,
      JSON.stringify(args.checks),
      args.result,
      args.explanation,
      now()
    )
    .run();
  return id;
}

async function ensureExpired(env: Env) {
  const timestamp = now();
  const expired = await env.DB.prepare(
    "SELECT id, public_id, purpose FROM paylinks WHERE status IN ('pending', 'verifying') AND expires_at < ?"
  )
    .bind(timestamp)
    .all<Record<string, unknown>>();
  for (const row of expired.results) {
    await env.DB.prepare(
      "UPDATE paylinks SET status = 'expired', updated_at = ? WHERE id = ?"
    )
      .bind(timestamp, row.id)
      .run();
    await createDecision(env, {
      paylinkId: String(row.id),
      action: "mark_expired",
      inputSummary: `PayLink ${row.public_id} expired`,
      checks: [
        {
          label: "Expiration checked",
          status: "passed",
          evidence: "Current time is later than the PayLink expiration."
        }
      ],
      result: "warning",
      explanation: `PayLink "${row.purpose}" expired before payment was verified.`
    });
  }
}

async function listPayLinks(env: Env, request: Request) {
  await ensureExpired(env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const query = url.searchParams.get("q")?.trim();
  let sql = "SELECT * FROM paylinks";
  const binds: string[] = [];
  const conditions: string[] = [];
  if (status && status !== "all") {
    conditions.push("status = ?");
    binds.push(status);
  }
  if (query) {
    conditions.push(
      "(purpose LIKE ? OR public_id LIKE ? OR receiver_address LIKE ?)"
    );
    binds.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += " ORDER BY created_at DESC LIMIT 100";

  const paylinksRows = await env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();
  const decisionsRows = await env.DB.prepare(
    "SELECT * FROM agent_decision_logs ORDER BY created_at DESC LIMIT 8"
  ).all<Record<string, unknown>>();

  const paylinks = paylinksRows.results.map(mapPayLink);
  const paid = paylinks.filter((item) => item.status === "paid");
  const totalReceivedRaw = paid.reduce(
    (sum, item) => sum + BigInt(String(item.amountRaw)),
    0n
  );
  const totalReceived = rawToAmount(totalReceivedRaw.toString(), config.tokenDecimals);
  const conversionRate = paylinks.length
    ? Math.round((paid.length / paylinks.length) * 1000) / 10
    : 0;

  return json({
    paylinks,
    decisions: decisionsRows.results.map(mapDecision),
    metrics: {
      totalReceived,
      totalPayLinks: paylinks.length,
      successfulPayments: paid.length,
      conversionRate,
      activePayLinks: paylinks.filter((item) =>
        ["pending", "verifying"].includes(String(item.status))
      ).length
    }
  });
}

async function createPayLink(context: PagesContext) {
  const body = await readBody<{
    title?: string;
    purpose?: string;
    amount?: string;
    receiverAddress?: string;
    receiverName?: string;
    expiresAt?: string;
  }>(context.request);
  const purpose = body.purpose?.trim();
  const title = body.title?.trim() || purpose;
  const receiver = normalizeAddress(
    body.receiverAddress || context.env.DEFAULT_RECEIVER_ADDRESS || config.defaultReceiver
  );
  if (!purpose || !title) return text("Purpose is required");
  if (!body.amount) return text("Amount is required");
  if (!isAddress(receiver)) return text("Receiver address is invalid");
  if (!body.expiresAt || Number.isNaN(new Date(body.expiresAt).getTime())) {
    return text("Expiration is required");
  }
  const amountRaw = parseAmount(body.amount, config.tokenDecimals);
  const createdAt = now();
  const id = makeId("paylink");
  const publicId = makeId("pl");
  const url = new URL(context.request.url);
  const publicUrl = `${url.origin}/p/${publicId}`;
  await context.env.DB.prepare(
    `INSERT INTO paylinks
      (id, public_id, title, purpose, receiver_address, receiver_name, token_symbol,
       token_address, token_decimals, amount, amount_raw, status, network, chain_id,
       public_url, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      publicId,
      title,
      purpose,
      receiver,
      body.receiverName?.trim() || null,
      config.tokenSymbol,
      context.env.USDC_ADDRESS || config.usdcAddress,
      config.tokenDecimals,
      body.amount,
      amountRaw,
      "pending",
      context.env.CELO_NETWORK || config.network,
      Number(context.env.CELO_CHAIN_ID || config.chainId),
      publicUrl,
      new Date(body.expiresAt).toISOString(),
      createdAt,
      createdAt
    )
    .run();

  await createDecision(context.env, {
    paylinkId: id,
    action: "create_paylink",
    inputSummary: `${body.amount} ${config.tokenSymbol} for ${purpose}`,
    checks: [
      {
        label: "Receiver address valid",
        status: "passed",
        evidence: receiver
      },
      {
        label: "Token allowlist",
        status: "passed",
        evidence: `${config.tokenSymbol} on ${config.network}`
      },
      {
        label: "Expiration set",
        status: "passed",
        evidence: new Date(body.expiresAt).toISOString()
      }
    ],
    result: "success",
    explanation: "Celo PayLink Agent created a stablecoin payment request."
  });

  const detail = await getDetail(context.env, publicId);
  return json(detail, { status: 201 });
}

async function createAttempt(context: PagesContext, publicId: string) {
  const body = await readBody<{ txHash?: string }>(context.request);
  const txHash = body.txHash?.trim();
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return text("A valid transaction hash is required");
  }
  const detail = await getDetail(context.env, publicId);
  if (!detail) return text("PayLink not found", 404);

  const attempt = await insertAttempt(context.env, detail.id, txHash);
  return json(attempt, { status: attempt.created ? 201 : 200 });
}

async function insertAttempt(env: Env, paylinkId: string, txHash: string) {
  const existing = await env.DB.prepare(
    "SELECT * FROM payment_attempts WHERE tx_hash = ?"
  )
    .bind(txHash)
    .first<Record<string, unknown>>();
  if (existing) {
    return { ...mapAttempt(existing), created: false };
  }

  const id = makeId("attempt");
  await env.DB.prepare(
    `INSERT INTO payment_attempts
      (id, paylink_id, tx_hash, status, created_at)
      VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, paylinkId, txHash, "submitted", now())
    .run();
  await createDecision(env, {
    paylinkId,
    attemptId: id,
    action: "submit_transaction",
    inputSummary: txHash,
    checks: [
      {
        label: "Transaction hash format",
        status: "passed",
        evidence: txHash
      }
    ],
    result: "info",
    explanation: "Transaction hash captured and queued for agent verification."
  });
  const attempt = await env.DB.prepare(
    "SELECT * FROM payment_attempts WHERE id = ?"
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!attempt) {
    throw new Error("Unable to create payment attempt");
  }
  return { ...mapAttempt(attempt), created: true };
}

interface ReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

interface ReceiptRpc {
  status?: string;
  blockNumber?: string;
  logs?: ReceiptLog[];
}

function topicToAddress(topic: string) {
  return `0x${topic.slice(-40)}`;
}

async function verifyPayLink(context: PagesContext, publicId: string) {
  const body = await readBody<{ txHash?: string }>(context.request);
  const txHash = body.txHash?.trim();
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return text("A valid transaction hash is required");
  }
  const detail = await getDetail(context.env, publicId);
  if (!detail) return text("PayLink not found", 404);

  let attempt = await context.env.DB.prepare(
    "SELECT * FROM payment_attempts WHERE tx_hash = ?"
  )
    .bind(txHash)
    .first<Record<string, unknown>>();
  if (attempt && attempt.paylink_id !== detail.id) {
    await createDecision(context.env, {
      paylinkId: detail.id,
      attemptId: String(attempt.id),
      action: "reject_duplicate_transaction",
      inputSummary: txHash,
      checks: [
        {
          label: "Duplicate check",
          status: "failed",
          evidence: "Transaction hash is already attached to another PayLink."
        }
      ],
      result: "failure",
      explanation: "The same transaction cannot be reused for multiple PayLinks."
    });
    return text("Duplicate transaction hash", 409);
  }
  if (!attempt) {
    await insertAttempt(context.env, detail.id, txHash);
    attempt = await context.env.DB.prepare(
      "SELECT * FROM payment_attempts WHERE tx_hash = ?"
    )
      .bind(txHash)
      .first<Record<string, unknown>>();
  }
  if (!attempt) return text("Unable to create payment attempt", 500);

  await context.env.DB.prepare(
    "UPDATE payment_attempts SET status = 'verifying' WHERE id = ?"
  )
    .bind(attempt.id)
    .run();
  await context.env.DB.prepare(
    "UPDATE paylinks SET status = 'verifying', updated_at = ? WHERE id = ? AND status != 'paid'"
  )
    .bind(now(), detail.id)
    .run();

  const checks: Array<{ label: string; status: string; evidence: string }> = [];
  let receipt: ReceiptRpc | null = null;
  try {
    receipt = await rpc<ReceiptRpc>(context.env, "eth_getTransactionReceipt", [
      txHash
    ]);
  } catch (error) {
    checks.push({
      label: "RPC receipt lookup",
      status: "failed",
      evidence: (error as Error).message
    });
  }

  if (!receipt) {
    if (!checks.length) {
      checks.push({
        label: "Transaction receipt lookup",
        status: "pending",
        evidence: "No receipt returned by the Celo Sepolia RPC yet."
      });
    }
    await createDecision(context.env, {
      paylinkId: detail.id,
      attemptId: String(attempt.id),
      action: "verify_transaction",
      inputSummary: txHash,
      checks,
      result: "warning",
      explanation:
        "The transaction is not available yet. The agent will need another verification attempt."
    });
    return json(await getDetail(context.env, publicId));
  }

  const receiptOk = receipt.status === "0x1";
  checks.push({
    label: "Transaction receipt found",
    status: receiptOk ? "passed" : "failed",
    evidence: `Receipt status ${receipt.status || "unknown"}`
  });
  const tokenAddress = context.env.USDC_ADDRESS || config.usdcAddress;
  const matchingLogs = (receipt.logs || []).filter(
    (log) =>
      sameAddress(log.address, tokenAddress) &&
      log.topics?.[0]?.toLowerCase() === transferTopic &&
      log.topics.length >= 3
  );
  const transfer = matchingLogs.find((log) =>
    sameAddress(topicToAddress(log.topics[2]), detail.receiverAddress)
  );
  checks.push({
    label: "Token verified",
    status: matchingLogs.length > 0 ? "passed" : "failed",
    evidence:
      matchingLogs.length > 0
        ? `${config.tokenSymbol} transfer log found`
        : "No USDC transfer log found"
  });
  checks.push({
    label: "Receiver matched",
    status: transfer ? "passed" : "failed",
    evidence: transfer
      ? `Transfer to ${topicToAddress(transfer.topics[2])}`
      : `Expected ${detail.receiverAddress}`
  });

  const paidRaw = transfer ? BigInt(transfer.data || "0x0") : 0n;
  const requiredRaw = BigInt(String(detail.amountRaw));
  const amountOk = paidRaw >= requiredRaw;
  checks.push({
    label: "Amount checked",
    status: amountOk ? "passed" : "failed",
    evidence: `${rawToAmount(paidRaw.toString(), config.tokenDecimals)} ${config.tokenSymbol} paid; ${detail.amount} required`
  });

  const duplicate = await context.env.DB.prepare(
    "SELECT id, paylink_id FROM payment_attempts WHERE tx_hash = ? AND id != ?"
  )
    .bind(txHash, attempt.id)
    .first<Record<string, unknown>>();
  checks.push({
    label: "Duplicate check",
    status: duplicate ? "failed" : "passed",
    evidence: duplicate ? "Transaction hash already exists" : "No duplicate found"
  });

  let blockTime: string | undefined;
  if (receipt.blockNumber) {
    const block = await rpc<{ timestamp?: string }>(context.env, "eth_getBlockByNumber", [
      receipt.blockNumber,
      false
    ]);
    if (block?.timestamp) {
      blockTime = new Date(Number.parseInt(block.timestamp, 16) * 1000).toISOString();
    }
  }
  const comparisonTime = blockTime || now();
  const notExpired = new Date(comparisonTime) <= new Date(detail.expiresAt);
  checks.push({
    label: "Expiration checked",
    status: notExpired ? "passed" : "failed",
    evidence: `Transaction time ${comparisonTime}; expires ${detail.expiresAt}`
  });

  const from = transfer ? topicToAddress(transfer.topics[1]) : undefined;
  const to = transfer ? topicToAddress(transfer.topics[2]) : undefined;
  const amountFormatted = rawToAmount(paidRaw.toString(), config.tokenDecimals);
  const blockNumber = receipt.blockNumber
    ? Number.parseInt(receipt.blockNumber, 16)
    : null;

  let status: "verified" | "underpaid" | "invalid" | "failed" = "invalid";
  let paylinkStatus = "invalid";
  let failureReason = "";
  let explanation = "";
  let result: "success" | "warning" | "failure" = "failure";

  if (!receiptOk) {
    status = "failed";
    paylinkStatus = "invalid";
    failureReason = "Transaction failed onchain";
    explanation = "The transaction receipt exists but failed onchain.";
  } else if (!transfer) {
    status = "invalid";
    paylinkStatus = "invalid";
    failureReason = "No matching USDC transfer to receiver";
    explanation =
      "The transaction does not contain a matching USDC transfer to the PayLink receiver.";
  } else if (duplicate) {
    status = "invalid";
    paylinkStatus = "invalid";
    failureReason = "Duplicate transaction";
    explanation = "The transaction hash has already been used.";
  } else if (!notExpired) {
    status = "invalid";
    paylinkStatus = "expired";
    failureReason = "PayLink expired before transaction verification";
    explanation = "The transaction happened after the PayLink expiration.";
  } else if (!amountOk) {
    status = "underpaid";
    paylinkStatus = "underpaid";
    failureReason = "Payment amount is below the requested amount";
    explanation = "The token and receiver matched, but the amount is below the request.";
    result = "warning";
  } else {
    status = "verified";
    paylinkStatus = "paid";
    explanation =
      "Celo PayLink Agent verified token, receiver, amount, duplicate status, and expiration.";
    result = "success";
  }

  await context.env.DB.prepare(
    `UPDATE payment_attempts
      SET payer_address = ?, receiver_address = ?, token_address = ?, amount_raw = ?,
          amount_formatted = ?, status = ?, failure_reason = ?, block_number = ?,
          confirmed_at = ?
      WHERE id = ?`
  )
    .bind(
      from || null,
      to || null,
      tokenAddress,
      paidRaw.toString(),
      amountFormatted,
      status,
      failureReason || null,
      blockNumber,
      comparisonTime,
      attempt.id
    )
    .run();
  await context.env.DB.prepare(
    "UPDATE paylinks SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, updated_at = ? WHERE id = ?"
  )
    .bind(paylinkStatus, paylinkStatus, comparisonTime, now(), detail.id)
    .run();

  await createDecision(context.env, {
    paylinkId: detail.id,
    attemptId: String(attempt.id),
    action:
      paylinkStatus === "paid"
        ? "mark_paid"
        : paylinkStatus === "underpaid"
          ? "mark_underpaid"
          : "reject_invalid_transaction",
    inputSummary: txHash,
    checks,
    result,
    explanation
  });

  if (paylinkStatus === "paid" && from) {
    const receiptId = makeId("receipt");
    const receiptNumber = `CPL-${new Date().getUTCFullYear()}-${receiptId.slice(-8).toUpperCase()}`;
    await context.env.DB.prepare(
      `INSERT OR IGNORE INTO receipts
        (id, paylink_id, attempt_id, receipt_number, receiver_address, payer_address,
         token_symbol, amount, tx_hash, network, explorer_url, agent_summary, issued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        receiptId,
        detail.id,
        attempt.id,
        receiptNumber,
        detail.receiverAddress,
        from,
        config.tokenSymbol,
        detail.amount,
        txHash,
        config.network,
        txUrl(txHash, context.env),
        explanation,
        now()
      )
      .run();
    const row = await context.env.DB.prepare(
      "SELECT id FROM receipts WHERE paylink_id = ?"
    )
      .bind(detail.id)
      .first<{ id: string }>();
    await context.env.DB.prepare(
      "UPDATE paylinks SET receipt_id = ? WHERE id = ?"
    )
      .bind(row?.id || receiptId, detail.id)
      .run();
    await createDecision(context.env, {
      paylinkId: detail.id,
      attemptId: String(attempt.id),
      action: "issue_receipt",
      inputSummary: receiptNumber,
      checks: [
        {
          label: "Receipt issued",
          status: "passed",
          evidence: receiptNumber
        }
      ],
      result: "success",
      explanation: "A receipt was issued after successful onchain verification."
    });
  }

  return json(await getDetail(context.env, publicId));
}

async function parseAgent(context: PagesContext) {
  const body = await readBody<{ input?: string }>(context.request);
  const input = body.input || "";
  const amountMatch = input.match(/(\d+(?:\.\d+)?)/);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const inDays = input.match(/(\d+)\s*(day|days)/i);
  const expires = inDays
    ? new Date(Date.now() + Number(inDays[1]) * 24 * 60 * 60 * 1000)
    : tomorrow;
  const purpose = input
    .replace(/collect|request|charge|usdc|usd|celo|expires?|tomorrow|in\s+\d+\s+days/gi, "")
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/[,\s]+/g, " ")
    .trim();
  return json({
    title: purpose || "Stablecoin payment",
    purpose: purpose || input || "Stablecoin payment",
    amount: amountMatch?.[1] || "10.00",
    receiverAddress: context.env.DEFAULT_RECEIVER_ADDRESS || config.defaultReceiver,
    expiresAt: expires.toISOString()
  });
}

function agentProfile(context: PagesContext) {
  const url = new URL(context.request.url);
  return json({
    name: "Celo PayLink Agent",
    description:
      "Creates stablecoin PayLinks, verifies Celo Sepolia USDC transfers, detects underpayments and duplicate transactions, and issues receipts.",
    network: config.network,
    chainId: config.chainId,
    token: {
      symbol: config.tokenSymbol,
      address: context.env.USDC_ADDRESS || config.usdcAddress,
      decimals: config.tokenDecimals
    },
    receiverAddress: context.env.DEFAULT_RECEIVER_ADDRESS || config.defaultReceiver,
    capabilities: [
      "create_paylink",
      "verify_transaction",
      "detect_underpayment",
      "reject_duplicate_transaction",
      "issue_receipt"
    ],
    endpoints: {
      app: url.origin,
      metadata: `${url.origin}/api/agent/metadata.json`,
      activity: `${url.origin}/api/agent/activity`
    }
  });
}

async function agentActivity(context: PagesContext) {
  const rows = await context.env.DB.prepare(
    "SELECT * FROM agent_decision_logs ORDER BY created_at DESC LIMIT 25"
  ).all<Record<string, unknown>>();
  return json(rows.results.map(mapDecision));
}

export async function onRequest(context: PagesContext) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const method = context.request.method;

  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (parts[0] === "health") {
    return json({ ok: true, network: config.network, token: config.tokenSymbol });
  }
  if (parts[0] === "config") {
    return json({
      network: config.network,
      chainId: config.chainId,
      rpcUrl: context.env.CELO_RPC_URL || config.rpcUrl,
      explorerUrl: context.env.CELO_EXPLORER_URL || config.explorerUrl,
      token: {
        symbol: config.tokenSymbol,
        address: context.env.USDC_ADDRESS || config.usdcAddress,
        decimals: config.tokenDecimals
      },
      defaultReceiver:
        context.env.DEFAULT_RECEIVER_ADDRESS || config.defaultReceiver
    });
  }

  await ensureSchema(context.env);

  if (parts[0] === "paylinks" && method === "GET" && parts.length === 1) {
    return listPayLinks(context.env, context.request);
  }
  if (parts[0] === "paylinks" && method === "POST" && parts.length === 1) {
    return createPayLink(context);
  }
  if (parts[0] === "paylinks" && method === "GET" && parts[1]) {
    const detail = await getDetail(context.env, parts[1]);
    if (!detail) return text("PayLink not found", 404);
    return json(detail);
  }
  if (
    parts[0] === "paylinks" &&
    parts[1] &&
    parts[2] === "attempts" &&
    method === "POST"
  ) {
    return createAttempt(context, parts[1]);
  }
  if (
    parts[0] === "paylinks" &&
    parts[1] &&
    parts[2] === "verify" &&
    method === "POST"
  ) {
    return verifyPayLink(context, parts[1]);
  }
  if (parts[0] === "receipts" && parts[1] && method === "GET") {
    const row = await context.env.DB.prepare("SELECT * FROM receipts WHERE id = ?")
      .bind(parts[1])
      .first<Record<string, unknown>>();
    if (!row) return text("Receipt not found", 404);
    return json(mapReceipt(row));
  }
  if (parts[0] === "agent" && parts[1] === "parse" && method === "POST") {
    return parseAgent(context);
  }
  if (parts[0] === "agent" && parts[1] === "profile" && method === "GET") {
    return agentProfile(context);
  }
  if (
    parts[0] === "agent" &&
    parts[1] === "metadata.json" &&
    method === "GET"
  ) {
    return agentProfile(context);
  }
  if (parts[0] === "agent" && parts[1] === "activity" && method === "GET") {
    return agentActivity(context);
  }

  return text("Not found", 404);
}
