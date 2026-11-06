Warning: truncated output (original token count: 13923)
Total output lines: 1053

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const databasePath = process.env.DATABASE_PATH || path.join(DATA_DIR, "commonthread.sqlite");
const absoluteDatabasePath = path.resolve(databasePath);
fs.mkdirSync(path.dirname(absoluteDatabasePath), { recursive: true });
const db = new DatabaseSync(absoluteDatabasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_auth_enabled INTEGER NOT NULL DEFAULT 1 CHECK (password_auth_enabled IN (0, 1)),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'US',
    currency_code TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'paypal')),
    provider_subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (provider, provider_subject),
    UNIQUE (provider, user_id)
  );

  CREATE TABLE IF NOT EXISTS oauth_flows (
    state_hash TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'paypal')),
    nonce TEXT NOT NULL,
    code_verifier TEXT,
    redirect_uri TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT NOT NULL,
    attempted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS community_needs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    summary TEXT NOT NULL,
    suggested_prompt TEXT NOT NULL,
    default_budget_cents INTEGER NOT NULL CHECK (default_budget_cents > 0),
    workflow_status TEXT NOT NULL DEFAULT 'review' CHECK (workflow_status IN ('review', 'ready', 'closed')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS community_request_events (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL REFERENCES community_needs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_label TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_label TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
    stock_on_hand INTEGER NOT NULL CHECK (stock_on_hand >= 0),
    stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
    icon_key TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    allergens_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_at TEXT NOT NULL,
    CHECK (stock_reserved <= stock_on_hand)
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL REFERENCES community_needs(id),
    source TEXT NOT NULL CHECK (source IN ('gemini', 'local-rules', 'local-fallback')),
    intent TEXT NOT NULL,
    budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
    constraints_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL REFERENCES community_needs(id),
    need_title_snapshot TEXT NOT NULL,
    need_location_snapshot TEXT NOT NULL,
    agent_run_id TEXT REFERENCES agent_runs(id),
    intent TEXT NOT NULL,
    budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0),
    constraints_json TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    status TEXT NOT NULL CHECK (status IN ('creating-paypal', 'awaiting-approval', 'captured-sandbox', 'local-demo', 'cancelled', 'failed')),
    idempotency_key TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    paypal_order_id TEXT UNIQUE,
    paypal_capture_id TEXT UNIQUE,
    paypal_create_request_id TEXT NOT NULL UNIQUE,
    paypal_capture_request_id TEXT NOT NULL UNIQUE,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    captured_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
    sku_snapshot TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    unit_label_snapshot TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total_cents INTEGER NOT NULL CHECK (line_total_cents = unit_price_cents * quantity),
    reason TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stock_reservations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL CHECK (status IN ('held', 'consumed', 'released')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (order_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON stock_reservations(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_events(order_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_auth_attempts_key ON auth_attempts(key_hash, attempted_at);
  CREATE INDEX IF NOT EXISTS idx_support_workspace ON support_tickets(workspace_id, created_at DESC);
`);

function ensureColumn(table, column, declaration) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

ensureColumn("community_needs", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
ensureColumn("users", "is_demo", "INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))");
ensureColumn("users", "password_auth_enabled", "INTEGER NOT NULL DEFAULT 1 CHECK (password_auth_enabled IN (0, 1))");
ensureColumn("agent_runs", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
ensureColumn("orders", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
ensureColumn("orders", "pay_currency_code", "TEXT NOT NULL DEFAULT 'USD'");
ensureColumn("orders", "base_budget_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "base_subtotal_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "fx_rate", "REAL NOT NULL DEFAULT 1");
ensureColumn("orders", "fx_rate_date", "TEXT NOT NULL DEFAULT ''");

function migrateAgentRunSources() {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'").get()?.sql || "";
  if (tableSql.includes("'local-fallback'")) return;

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`CREATE TABLE agent_runs_new (
      id TEXT PRIMARY KEY,
      need_id TEXT NOT NULL REFERENCES community_needs(id),
      source TEXT NOT NULL CHECK (source IN ('gemini', 'local-rules', 'local-fallback')),
      intent TEXT NOT NULL,
      budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
      constraints_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE
    )`);
    db.exec(`INSERT INTO agent_runs_new (id, need_id, source, intent, budget_cents, constraints_json, plan_json, created_at, workspace_id)
      SELECT id, need_id, source, intent, budget_cents, constraints_json, plan_json, created_at, workspace_id FROM agent_runs`);
    db.exec("DROP TABLE agent_runs");
    db.exec("ALTER TABLE agent_runs_new RENAME TO agent_runs");
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

migrateAgentRunSources();

db.exec(`CREATE INDEX IF NOT EXISTS idx_needs_workspace ON community_needs(workspace_id, workflow_status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_flows_expiry ON oauth_flows(expires_at);
  UPDATE orders SET base_budget_cents = budget_cents WHERE base_budget_cents = 0;
  UPDATE orders SET base_subtotal_cents = subtotal_cents WHERE base_subtotal_cents = 0;`);

const needColumns = new Set(db.prepare("PRAGMA table_info(community_needs)").all().map((column) => column.name));
if (!needColumns.has("workflow_status")) {
  db.exec("ALTER TABLE community_needs ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'review' CHECK (workflow_status IN ('review', 'ready', 'closed'))");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_request_events_need ON community_request_events(need_id, created_at DESC)");
db.exec(`
  CREATE TRIGGER IF NOT EXISTS request_events_no_update BEFORE UPDATE ON community_request_events
    BEGIN SELECT RAISE(ABORT, 'request activity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS request_events_no_delete BEFORE DELETE ON community_request_events
    BEGIN SELECT RAISE(ABORT, 'request activity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'payment activity is immutable'); EN…7923 tokens truncated…ssign(new Error("This checkout key was already used for a different kit. Rebuild the kit to start a new checkout."), { statusCode: 409 });
    return existing;
  };
  const orderIdempotencyKey = idempotencyKey ? `${workspaceId}:${idempotencyKey}` : `${workspaceId}:${cryptoRandomId()}`;
  if (idempotencyKey) {
    const existing = getOrderByIdempotencyKey(orderIdempotencyKey, workspaceId);
    if (existing) {
      ensureSameRequest(existing);
      return {
        order: existing,
        created: false,
        createRequestId: existing.status === "creating-paypal" ? existing.paypalCreateRequestId : null
      };
    }
  }
  const { snapshots: usdSnapshots, subtotalCents: baseSubtotalCents } = validateAndSnapshotItems(items, budgetCents, constraints);
  const snapshots = usdSnapshots.map((item) => {
    const unitPriceCents = Math.round((item.unitPriceCents / 100) * fxRate * (10 ** minorDigits));
    return { ...item, unitPriceCents, lineTotalCents: unitPriceCents * item.quantity };
  });
  const subtotalCents = snapshots.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const localizedBudgetCents = Math.round((budgetCents / 100) * fxRate * (10 ** minorDigits));
  if (!Number.isSafeInteger(localizedBudgetCents) || subtotalCents <= 0 || subtotalCents > localizedBudgetCents) {
    throw Object.assign(new Error("The rounded checkout amount exceeds the approved budget in this currency. Reduce the kit or choose another currency."), { statusCode: 400 });
  }
  const isPayPalOrder = status === "creating-paypal";
  const timestamp = now();
  const holdUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const createRequestId = cryptoRandomId();
  const captureRequestId = cryptoRandomId();

  return withTransaction(() => {
    const existing = getOrderByIdempotencyKey(orderIdempotencyKey, workspaceId);
    if (existing) {
      ensureSameRequest(existing);
      return { order: existing, created: false, createRequestId: existing.status === "creating-paypal" ? existing.paypalCreateRequestId : null };
    }

    for (const item of snapshots) {
      if (isPayPalOrder) {
        const reserve = db.prepare(`UPDATE catalog_products SET stock_reserved = stock_reserved + ?, updated_at = ?
          WHERE id = ? AND active = 1 AND stock_on_hand - stock_reserved >= ?`).run(item.quantity, timestamp, item.id, item.quantity);
        if (reserve.changes !== 1) throw Object.assign(new Error(`${item.name} just sold out. Rebuild your kit with available stock.`), { statusCode: 409 });
      }
    }

    db.prepare(`INSERT INTO orders
      (id, workspace_id, need_id, need_title_snapshot, need_location_snapshot, agent_run_id, intent, budget_cents, subtotal_cents,
       constraints_json, status, idempotency_key, request_fingerprint, paypal_create_request_id, paypal_capture_request_id,
       pay_currency_code, base_budget_cents, base_subtotal_cents, fx_rate, fx_rate_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, need.id, need.title, need.location, agentRunId || null, intent.slice(0, 600), localizedBudgetCents,
        subtotalCents, JSON.stringify(constraints), status, orderIdempotencyKey, requestFingerprint, createRequestId,
        captureRequestId, currency, budgetCents, baseSubtotalCents, fxRate, fxRateDate, timestamp, timestamp);

    const insertItem = db.prepare(`INSERT INTO order_items
      (id, order_id, product_id, sku_snapshot, name_snapshot, unit_label_snapshot, unit_price_cents, quantity, line_total_cents, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertReservation = db.prepare(`INSERT INTO stock_reservations
      (id, order_id, product_id, quantity, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'held', ?, ?)`);
    for (const item of snapshots) {
      insertItem.run(cryptoRandomId(), id, item.id, item.sku, item.name, item.unitLabel, item.unitPriceCents, item.quantity, item.lineTotalCents, item.reason);
      if (isPayPalOrder) insertReservation.run(cryptoRandomId(), id, item.id, item.quantity, holdUntil, timestamp);
    }
    recordAudit(id, isPayPalOrder ? "order.reserved" : "order.local-demo", {
      subtotalMinor: subtotalCents, currency, baseSubtotalCents, fxRate, fxRateDate, itemCount: snapshots.length
    });
    return { order: getOrderById(id, workspaceId), created: true, createRequestId };
  });
}

function setPayPalOrder(orderId, paypalOrderId) {
  const timestamp = now();
  withTransaction(() => {
    const updated = db.prepare("UPDATE orders SET paypal_order_id = ?, status = 'awaiting-approval', updated_at = ? WHERE id = ? AND status = 'creating-paypal'")
      .run(paypalOrderId, timestamp, orderId);
    if (updated.changes) recordAudit(orderId, "paypal.order-created", { paypalOrderId });
  });
  return getOrderById(orderId);
}

function markOrderFailed(orderId, message) {
  const timestamp = now();
  withTransaction(() => {
    const current = db.prepare("SELECT status, paypal_order_id FROM orders WHERE id = ?").get(orderId);
    if (!current || current.status !== "creating-paypal" || current.paypal_order_id) return;
    const reservations = db.prepare("SELECT product_id, quantity FROM stock_reservations WHERE order_id = ? AND status = 'held'").all(orderId);
    for (const reservation of reservations) {
      db.prepare("UPDATE catalog_products SET stock_reserved = MAX(0, stock_reserved - ?), updated_at = ? WHERE id = ?")
        .run(reservation.quantity, timestamp, reservation.product_id);
    }
    db.prepare("UPDATE stock_reservations SET status = 'released' WHERE order_id = ? AND status = 'held'").run(orderId);
    db.prepare("UPDATE orders SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
      .run(String(message || "PayPal order creation failed.").slice(0, 240), timestamp, orderId);
    recordAudit(orderId, "paypal.order-failed", { message: String(message || "").slice(0, 180) });
  });
}

function markOrderCancelled(orderId) {
  const timestamp = now();
  withTransaction(() => {
    const current = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId);
    if (!current || current.status !== "awaiting-approval") return;
    const reservations = db.prepare("SELECT product_id, quantity FROM stock_reservations WHERE order_id = ? AND status = 'held'").all(orderId);
    for (const reservation of reservations) {
      db.prepare("UPDATE catalog_products SET stock_reserved = MAX(0, stock_reserved - ?), updated_at = ? WHERE id = ?")
        .run(reservation.quantity, timestamp, reservation.product_id);
    }
    db.prepare("UPDATE stock_reservations SET status = 'released' WHERE order_id = ? AND status = 'held'").run(orderId);
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'awaiting-approval'").run(timestamp, orderId);
    recordAudit(orderId, "order.cancelled");
  });
  return getOrderById(orderId);
}

function expireReservations() {
  const expired = db.prepare(`SELECT DISTINCT o.id FROM orders o
    JOIN stock_reservations r ON r.order_id = o.id
    WHERE o.status = 'awaiting-approval' AND r.status = 'held' AND r.expires_at < ?`).all(now());
  for (const row of expired) markOrderCancelled(row.id);
}

function markOrderCaptured(orderId, captureId, capturedAmountCents) {
  const timestamp = now();
  return withTransaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) throw Object.assign(new Error("That order could not be found."), { statusCode: 404 });
    if (order.status === "captured-sandbox") return getOrderById(orderId);
    if (order.status !== "awaiting-approval") throw Object.assign(new Error("This order is no longer waiting for payment."), { statusCode: 409 });
    if (order.subtotal_cents !== capturedAmountCents) throw Object.assign(new Error("PayPal's captured amount did not match the saved order."), { statusCode: 409 });

    const reservations = db.prepare("SELECT product_id, quantity FROM stock_reservations WHERE order_id = ? AND status = 'held'").all(orderId);
    if (!reservations.length) throw Object.assign(new Error("This order's inventory hold expired. Rebuild the kit before checking out."), { statusCode: 409 });
    for (const reservation of reservations) {
      const updated = db.prepare(`UPDATE catalog_products SET stock_on_hand = stock_on_hand - ?, stock_reserved = stock_reserved - ?, updated_at = ?
        WHERE id = ? AND stock_on_hand >= ? AND stock_reserved >= ?`)
        .run(reservation.quantity, reservation.quantity, timestamp, reservation.product_id, reservation.quantity, reservation.quantity);
      if (updated.changes !== 1) throw Object.assign(new Error("A reserved catalog item changed before capture. Ask the workspace operator to reconcile this order."), { statusCode: 409 });
    }
    db.prepare("UPDATE stock_reservations SET status = 'consumed' WHERE order_id = ? AND status = 'held'").run(orderId);
    db.prepare(`UPDATE orders SET status = 'captured-sandbox', paypal_capture_id = ?, captured_at = ?, updated_at = ? WHERE id = ?`)
      .run(captureId, timestamp, timestamp, orderId);
    recordAudit(orderId, "paypal.capture-completed", { captureId, capturedAmountCents });
    return getOrderById(orderId);
  });
}

function listOrders(workspaceId, limit = 25) {
  return db.prepare("SELECT * FROM orders WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit).map(formatOrder);
}

function listAuditEvents(orderId, limit = 30) {
  return db.prepare(`SELECT event_type AS type, details_json AS details, created_at AS createdAt
    FROM audit_events WHERE order_id = ? ORDER BY created_at DESC LIMIT ?`).all(orderId, limit).map((row) => ({ ...row, details: JSON.parse(row.details) }));
}

function getMetrics(workspaceId) {
  const summary = db.prepare(`SELECT COUNT(*) AS orderCount,
      SUM(CASE WHEN status = 'captured-sandbox' THEN 1 ELSE 0 END) AS capturedOrders
    FROM orders WHERE workspace_id = ?`).get(workspaceId);
  const capturedByCurrency = Object.fromEntries(db.prepare(`SELECT pay_currency_code AS currency, SUM(subtotal_cents) AS amountMinor
    FROM orders WHERE workspace_id = ? AND status = 'captured-sandbox' GROUP BY pay_currency_code`).all(workspaceId)
    .map((row) => [row.currency, row.amountMinor]));
  return {
    needCount: db.prepare("SELECT COUNT(*) AS count FROM community_needs WHERE workspace_id = ?").get(workspaceId).count,
    reviewRequestCount: db.prepare("SELECT COUNT(*) AS count FROM community_needs WHERE workspace_id = ? AND workflow_status = 'review'").get(workspaceId).count,
    readyRequestCount: db.prepare("SELECT COUNT(*) AS count FROM community_needs WHERE workspace_id = ? AND workflow_status = 'ready'").get(workspaceId).count,
    closedRequestCount: db.prepare("SELECT COUNT(*) AS count FROM community_needs WHERE workspace_id = ? AND workflow_status = 'closed'").get(workspaceId).count,
    productCount: db.prepare("SELECT COUNT(*) AS count FROM catalog_products WHERE active = 1").get().count,
    orderCount: summary.orderCount,
    capturedByCurrency,
    capturedOrders: summary.capturedOrders || 0
  };
}

function closeDatabase() {
  db.close();
}

seed();

module.exports = {
  authAttemptCount,
  closeDatabase,
  createAccount,
  createNeed,
  createOrder,
  createSession,
  createSupportTicket,
  deleteOtherSessions,
  deleteSession,
  expireReservations,
  ensureDemoAccount,
  consumeOAuthFlow,
  findOAuthIdentity,
  getAccount,
  getMetrics,
  getNeed,
  getOrderById,
  getOrderByIdempotencyKey,
  getSession,
  getUserByEmail,
  insertAgentRun,
  listAuditEvents,
  listNeedEvents,
  listNeeds,
  listOrders,
  listProducts,
  listSessions,
  listSupportTickets,
  markOrderCancelled,
  markOrderCaptured,
  markOrderFailed,
  linkOAuthIdentity,
  recordAuthAttempt,
  resolveOAuthAccount,
  rotateSessionCsrf,
  setNeedStatus,
  setPayPalOrder,
  storeOAuthFlow,
  updateAccount,
  updatePassword
};
