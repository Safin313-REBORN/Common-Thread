"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const databasePath = process.env.DATABASE_PATH || path.join(DATA_DIR, "commonthread.sqlite");
const db = new DatabaseSync(databasePath);
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
    BEGIN SELECT RAISE(ABORT, 'payment activity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'payment activity is immutable'); END;
`);

const needs = [
  {
    id: "pantry-quezon-city",
    title: "Pantry basics for a family",
    category: "Food",
    location: "Quezon City, Philippines",
    summary: "A neighborhood organizer is assembling shelf-stable basics for a family after reduced work hours.",
    suggestedPrompt: "Build a balanced pantry starter kit for a family of four with shelf-stable essentials.",
    defaultBudgetCents: 4000
  },
  {
    id: "school-la-paz",
    title: "School-day supplies",
    category: "Learning",
    location: "La Paz, Bolivia",
    summary: "A parent group is putting together practical supplies for students returning to a shared learning center.",
    suggestedPrompt: "Create a useful school kit for one student. Include writing supplies and a reusable bottle, under $35.",
    defaultBudgetCents: 3500
  },
  {
    id: "study-kumasi",
    title: "Keep the study room lit",
    category: "Community space",
    location: "Kumasi, Ghana",
    summary: "A volunteer-run study room needs durable lighting and basic electrical supplies for evening sessions.",
    suggestedPrompt: "Put together a safe, low-energy lighting kit for the study room. Stay under $45.",
    defaultBudgetCents: 4500
  }
];

const products = [
  { id: "rice-five-kg", sku: "CT-PAN-101", name: "Rice, 5 kg", description: "A staple bag for shared household meals.", category: "Pantry", unitLabel: "bag", unitPriceCents: 845, stockOnHand: 32, iconKey: "grain", tags: ["pantry", "staple", "family", "vegetarian", "gluten-free"], allergens: [] },
  { id: "lentils-two-kg", sku: "CT-PAN-102", name: "Lentils, 2 kg", description: "A shelf-stable source of plant protein.", category: "Pantry", unitLabel: "bag", unitPriceCents: 520, stockOnHand: 24, iconKey: "grain", tags: ["pantry", "protein", "vegetarian", "gluten-free"], allergens: [] },
  { id: "cooking-oil-one-l", sku: "CT-PAN-103", name: "Cooking oil, 1 L", description: "Everyday cooking oil in a sealed bottle.", category: "Pantry", unitLabel: "bottle", unitPriceCents: 610, stockOnHand: 19, iconKey: "bottle", tags: ["pantry", "cooking", "vegetarian"], allergens: [] },
  { id: "tomatoes-four-pack", sku: "CT-PAN-104", name: "Tomatoes, 4 pack", description: "Canned tomatoes for sauces and soups.", category: "Pantry", unitLabel: "pack", unitPriceCents: 445, stockOnHand: 22, iconKey: "can", tags: ["pantry", "vegetarian", "gluten-free"], allergens: [] },
  { id: "oats-one-kg", sku: "CT-PAN-105", name: "Rolled oats, 1 kg", description: "A breakfast staple. Contains gluten.", category: "Pantry", unitLabel: "bag", unitPriceCents: 685, stockOnHand: 14, iconKey: "grain", tags: ["pantry", "breakfast", "vegetarian"], allergens: ["gluten"] },
  { id: "peanut-butter", sku: "CT-PAN-106", name: "Peanut butter, 500 g", description: "A protein-rich spread. Contains peanuts.", category: "Pantry", unitLabel: "jar", unitPriceCents: 410, stockOnHand: 12, iconKey: "jar", tags: ["pantry", "protein", "vegetarian"], allergens: ["peanuts"] },
  { id: "soap-three-pack", sku: "CT-HYG-201", name: "Soap bars, 3 pack", description: "Basic unscented hygiene soap.", category: "Hygiene", unitLabel: "pack", unitPriceCents: 340, stockOnHand: 28, iconKey: "soap", tags: ["hygiene", "family"], allergens: [] },
  { id: "exercise-books-three", sku: "CT-SCH-301", name: "Exercise books, 3 pack", description: "Ruled notebooks for daily classwork.", category: "School", unitLabel: "pack", unitPriceCents: 420, stockOnHand: 50, iconKey: "book", tags: ["school", "writing"], allergens: [] },
  { id: "pencils-ten-pack", sku: "CT-SCH-302", name: "Pencils, 10 pack", description: "Sharpened graphite pencils for class.", category: "School", unitLabel: "pack", unitPriceCents: 215, stockOnHand: 45, iconKey: "pencil", tags: ["school", "writing"], allergens: [] },
  { id: "school-bag", sku: "CT-SCH-303", name: "Everyday school bag", description: "A light, durable backpack with two compartments.", category: "School", unitLabel: "each", unitPriceCents: 1875, stockOnHand: 12, iconKey: "bag", tags: ["school", "carry"], allergens: [] },
  { id: "water-bottle", sku: "CT-SCH-304", name: "Reusable water bottle, 750 ml", description: "A leak-resistant bottle for school days.", category: "School", unitLabel: "each", unitPriceCents: 720, stockOnHand: 16, iconKey: "bottle", tags: ["school", "hydration"], allergens: [] },
  { id: "geometry-set", sku: "CT-SCH-305", name: "Geometry set", description: "Ruler, compass, protractor, and set square.", category: "School", unitLabel: "set", unitPriceCents: 525, stockOnHand: 20, iconKey: "tools", tags: ["school", "math"], allergens: [] },
  { id: "solar-study-lamp", sku: "CT-LGT-401", name: "Rechargeable study lamp", description: "A compact LED lamp with USB charging.", category: "Lighting", unitLabel: "each", unitPriceCents: 1680, stockOnHand: 11, iconKey: "lamp", tags: ["study", "energy", "lighting"], allergens: [] },
  { id: "led-bulbs-two-pack", sku: "CT-LGT-402", name: "LED bulbs, 2 pack", description: "Low-energy bulbs for shared indoor spaces.", category: "Lighting", unitLabel: "pack", unitPriceCents: 560, stockOnHand: 20, iconKey: "bulb", tags: ["study", "energy", "lighting"], allergens: [] },
  { id: "extension-cord", sku: "CT-LGT-403", name: "Extension cord, 3 m", description: "A grounded cord for approved indoor use.", category: "Lighting", unitLabel: "each", unitPriceCents: 930, stockOnHand: 7, iconKey: "cord", tags: ["study", "electrical", "safety"], allergens: [] }
];

const now = () => new Date().toISOString();

function withTransaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
}

function getAccount(userId) {
  return db.prepare(`SELECT u.id AS userId, u.email, u.display_name AS displayName, u.is_demo AS isDemo,
      u.password_auth_enabled AS hasPassword,
      w.id AS workspaceId, w.name AS workspaceName, w.country_code AS countryCode,
      w.currency_code AS currencyCode, wm.role
    FROM users u JOIN workspace_members wm ON wm.user_id = u.id
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE u.id = ? ORDER BY wm.created_at LIMIT 1`).get(userId) || null;
}

function createAccount({ id, email, displayName, passwordHash, workspaceId, workspaceName, countryCode, currencyCode }) {
  const timestamp = now();
  withTransaction(() => {
    const isFirstWorkspace = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_demo = 0").get().count === 0;
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, email, displayName, passwordHash, timestamp, timestamp);
    db.prepare(`INSERT INTO workspaces (id, name, country_code, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(workspaceId, workspaceName, countryCode, currencyCode, timestamp, timestamp);
    db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', ?)`).run(workspaceId, id, timestamp);
    if (isFirstWorkspace) {
      db.prepare("UPDATE community_needs SET workspace_id = ? WHERE workspace_id IS NULL").run(workspaceId);
      db.prepare(`UPDATE agent_runs SET workspace_id = COALESCE(
        (SELECT workspace_id FROM community_needs WHERE community_needs.id = agent_runs.need_id), ?)
        WHERE workspace_id IS NULL`).run(workspaceId);
      db.prepare("UPDATE orders SET workspace_id = ? WHERE workspace_id IS NULL").run(workspaceId);
    }
  });
  return getAccount(id);
}

function ensureDemoAccount({ id, email, displayName, passwordHash, workspaceId, workspaceName, countryCode, currencyCode }) {
  const timestamp = now();
  withTransaction(() => {
    const existing = db.prepare("SELECT id, is_demo AS isDemo FROM users WHERE email = ? COLLATE NOCASE").get(email);
    if (existing && !existing.isDemo) throw new Error("DEMO_EMAIL is already used by a normal account. Choose a different demo address.");
    db.prepare("DELETE FROM users WHERE is_demo = 1 AND email <> ? COLLATE NOCASE").run(email);
    if (existing) {
      db.prepare("UPDATE users SET display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?")
        .run(displayName, passwordHash, timestamp, existing.id);
      id = existing.id;
    } else {
      db.prepare(`INSERT INTO users (id, email, display_name, password_hash, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`).run(id, email, displayName, passwordHash, timestamp, timestamp);
    }
    db.prepare(`INSERT INTO workspaces (id, name, country_code, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, country_code = excluded.country_code, currency_code = excluded.currency_code, updated_at = excluded.updated_at`)
      .run(workspaceId, workspaceName, countryCode, currencyCode, timestamp, timestamp);
    db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
      VALUES (?, ?, 'viewer', ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'viewer'`)
      .run(workspaceId, id, timestamp);

    for (const [index, need] of needs.entries()) {
      const demoNeedId = `demo-${need.id}`;
      db.prepare(`INSERT OR IGNORE INTO community_needs
        (id, workspace_id, title, category, location, summary, suggested_prompt, default_budget_cents, workflow_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(demoNeedId, workspaceId, need.title, need.category, need.location, need.summary, need.suggestedPrompt,
          need.defaultBudgetCents, index === 0 ? "ready" : "review", timestamp);
      const eventExists = db.prepare("SELECT 1 FROM community_request_events WHERE need_id = ? LIMIT 1").get(demoNeedId);
      if (!eventExists) {
        recordNeedEvent(demoNeedId, "request.created", { status: "review", starter: true, demo: true });
        if (index === 0) recordNeedEvent(demoNeedId, "request.status-changed", { from: "review", to: "ready", demo: true });
      }
    }
  });
  return getAccount(id);
}

function updateAccount({ userId, displayName, workspaceName, countryCode, currencyCode }) {
  const timestamp = now();
  withTransaction(() => {
    db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(displayName, timestamp, userId);
    db.prepare(`UPDATE workspaces SET name = ?, country_code = ?, currency_code = ?, updated_at = ?
      WHERE id = (SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY created_at LIMIT 1)`)
      .run(workspaceName, countryCode, currencyCode, timestamp, userId);
  });
  return getAccount(userId);
}

function updatePassword(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ?, password_auth_enabled = 1, updated_at = ? WHERE id = ?").run(passwordHash, now(), userId);
}

function createSession({ tokenHash, csrfHash, userId, expiresAt }) {
  const timestamp = now();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(tokenHash, userId, csrfHash, timestamp, expiresAt, timestamp);
}

function rotateSessionCsrf(tokenHash, csrfHash) {
  db.prepare("UPDATE sessions SET csrf_hash = ?, last_seen_at = ? WHERE token_hash = ? AND expires_at > ?")
    .run(csrfHash, now(), tokenHash, now());
}

function getSession(tokenHash) {
  const session = db.prepare(`SELECT s.token_hash AS tokenHash, s.csrf_hash AS csrfHash,
      s.created_at AS createdAt, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt,
      u.id AS userId, u.email, u.display_name AS displayName, u.is_demo AS isDemo,
      u.password_auth_enabled AS hasPassword,
      w.id AS workspaceId, w.name AS workspaceName, w.country_code AS countryCode,
      w.currency_code AS currencyCode, wm.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    JOIN workspace_members wm ON wm.user_id = u.id
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE s.token_hash = ? AND s.expires_at > ? ORDER BY wm.created_at LIMIT 1`).get(tokenHash, now());
  if (session) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now(), tokenHash);
  return session || null;
}

function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function listSessions(userId, currentTokenHash) {
  return db.prepare(`SELECT token_hash AS tokenHash, created_at AS createdAt, last_seen_at AS lastSeenAt,
      expires_at AS expiresAt
    FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`)
    .all(userId, now()).map((row) => ({
      current: row.tokenHash === currentTokenHash,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt
    }));
}

function deleteOtherSessions(userId, currentTokenHash) {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, currentTokenHash);
}

function storeOAuthFlow({ stateHash, browserHash, provider, nonce, codeVerifier, redirectUri, expiresAt }) {
  const timestamp = now();
  db.prepare("DELETE FROM oauth_flows WHERE expires_at <= ?").run(timestamp);
  db.prepare(`INSERT INTO oauth_flows (state_hash, browser_hash, provider, nonce, code_verifier, redirect_uri, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(stateHash, browserHash, provider, nonce, codeVerifier || null, redirectUri, expiresAt, timestamp);
}

function consumeOAuthFlow({ stateHash, browserHash, provider }) {
  return withTransaction(() => {
    const flow = db.prepare(`SELECT state_hash AS stateHash, browser_hash AS browserHash, provider, nonce,
        code_verifier AS codeVerifier, redirect_uri AS redirectUri, expires_at AS expiresAt
      FROM oauth_flows WHERE state_hash = ?`).get(stateHash);
    db.prepare("DELETE FROM oauth_flows WHERE state_hash = ?").run(stateHash);
    if (!flow || flow.provider !== provider || flow.browserHash !== browserHash || flow.expiresAt <= now()) return null;
    return flow;
  });
}

function findOAuthIdentity(provider, subject) {
  return db.prepare("SELECT user_id AS userId FROM oauth_identities WHERE provider = ? AND provider_subject = ?")
    .get(provider, subject) || null;
}

function linkOAuthIdentity({ provider, subject, userId }) {
  withTransaction(() => {
    db.prepare(`INSERT OR IGNORE INTO oauth_identities (provider, provider_subject, user_id, created_at)
      VALUES (?, ?, ?, ?)`)
      .run(provider, subject, userId, now());
    const identity = findOAuthIdentity(provider, subject);
    if (!identity || identity.userId !== userId) throw Object.assign(new Error("This sign-in identity is already linked to another account."), { statusCode: 409 });
  });
}

function resolveOAuthAccount({ provider, subject, email, displayName, passwordHash, id, workspaceId, workspaceName, countryCode, currencyCode }) {
  withTransaction(() => {
    const identity = findOAuthIdentity(provider, subject);
    if (identity) return;

    const existingUser = db.prepare("SELECT id, is_demo AS isDemo FROM users WHERE email = ? COLLATE NOCASE").get(email);
    if (existingUser?.isDemo) {
      throw Object.assign(new Error("This email is reserved for the shared demo. Use a different account."), { statusCode: 409 });
    }

    let userId = existingUser?.id;
    if (!existingUser) {
      userId = id;
      const timestamp = now();
      const isFirstWorkspace = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_demo = 0").get().count === 0;
      db.prepare(`INSERT INTO users (id, email, display_name, password_hash, password_auth_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)`)
        .run(userId, email, displayName, passwordHash, timestamp, timestamp);
      db.prepare(`INSERT INTO workspaces (id, name, country_code, currency_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(workspaceId, workspaceName, countryCode, currencyCode, timestamp, timestamp);
      db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
        VALUES (?, ?, 'owner', ?)`).run(workspaceId, userId, timestamp);
      if (isFirstWorkspace) {
        db.prepare("UPDATE community_needs SET workspace_id = ? WHERE workspace_id IS NULL").run(workspaceId);
        db.prepare(`UPDATE agent_runs SET workspace_id = COALESCE(
          (SELECT workspace_id FROM community_needs WHERE community_needs.id = agent_runs.need_id), ?)
          WHERE workspace_id IS NULL`).run(workspaceId);
        db.prepare("UPDATE orders SET workspace_id = ? WHERE workspace_id IS NULL").run(workspaceId);
      }
    }

    db.prepare(`INSERT INTO oauth_identities (provider, provider_subject, user_id, created_at)
      VALUES (?, ?, ?, ?)`).run(provider, subject, userId, now());
  });

  const identity = findOAuthIdentity(provider, subject);
  return identity ? getAccount(identity.userId) : null;
}

function authAttemptCount(keyHash, since) {
  db.prepare("DELETE FROM auth_attempts WHERE attempted_at < ?").run(new Date(Date.now() - 86400000).toISOString());
  return db.prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE key_hash = ? AND attempted_at > ?").get(keyHash, since).count;
}

function recordAuthAttempt(keyHash) {
  db.prepare("INSERT INTO auth_attempts (key_hash, attempted_at) VALUES (?, ?)").run(keyHash, now());
}

function createSupportTicket({ id, userId, workspaceId, email, category, subject, message }) {
  db.prepare(`INSERT INTO support_tickets
    (id, user_id, workspace_id, email, category, subject, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId || null, workspaceId || null, email, category, subject, message, now());
  return { id, status: "open" };
}

function listSupportTickets(workspaceId) {
  return db.prepare(`SELECT id, category, subject, message, status, created_at AS createdAt
    FROM support_tickets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`).all(workspaceId);
}

function seed() {
  const timestamp = now();
  withTransaction(() => {
    db.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (1, 'initial-relational-schema', ?)").run(timestamp);
    db.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (2, 'community-request-workflow', ?)").run(timestamp);
    db.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (4, 'agent-run-source-fallback', ?)").run(timestamp);
    const insertNeed = db.prepare(`INSERT OR IGNORE INTO community_needs
      (id, title, category, location, summary, suggested_prompt, default_budget_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const need of needs) insertNeed.run(need.id, need.title, need.category, need.location, need.summary, need.suggestedPrompt, need.defaultBudgetCents, timestamp);
    db.prepare(`UPDATE community_needs SET suggested_prompt = ?
      WHERE id = ? AND suggested_prompt = ?`)
      .run(needs[0].suggestedPrompt, needs[0].id, "Build a balanced pantry starter kit for a family of four. Keep it under $40 and avoid peanuts.");

    const insertProduct = db.prepare(`INSERT OR IGNORE INTO catalog_products
      (id, sku, name, description, category, unit_label, unit_price_cents, stock_on_hand, icon_key, tags_json, allergens_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const product of products) {
      insertProduct.run(product.id, product.sku, product.name, product.description, product.category, product.unitLabel, product.unitPriceCents, product.stockOnHand, product.iconKey, JSON.stringify(product.tags), JSON.stringify(product.allergens), timestamp);
    }
    const starterStatusMigration = db.prepare("SELECT version FROM schema_migrations WHERE version = 3").get();
    if (!starterStatusMigration) {
      db.prepare("UPDATE community_needs SET workflow_status = 'review' WHERE id IN ('pantry-quezon-city', 'school-la-paz', 'study-kumasi')").run();
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, 'starter-requests-require-review', ?)").run(timestamp);
    }
    const starterEventExists = db.prepare("SELECT 1 FROM community_request_events WHERE need_id = ? LIMIT 1");
    for (const need of needs) {
      if (!starterEventExists.get(need.id)) recordNeedEvent(need.id, "request.created", { status: "review", starter: true });
    }
  });
}

function parseProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    unitLabel: row.unit_label,
    unitPriceCents: row.unit_price_cents,
    availableStock: row.stock_on_hand - row.stock_reserved,
    iconKey: row.icon_key,
    tags: JSON.parse(row.tags_json),
    allergens: JSON.parse(row.allergens_json)
  };
}

function listNeeds(workspaceId) {
  return db.prepare("SELECT * FROM community_needs WHERE workspace_id = ? ORDER BY category, title").all(workspaceId).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    location: row.location,
    summary: row.summary,
    suggestedPrompt: row.suggested_prompt,
    defaultBudgetCents: row.default_budget_cents,
    status: row.workflow_status
  }));
}

function getNeed(id, workspaceId) {
  const row = db.prepare("SELECT * FROM community_needs WHERE id = ? AND workspace_id = ?").get(id, workspaceId);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    location: row.location,
    summary: row.summary,
    suggestedPrompt: row.suggested_prompt,
    defaultBudgetCents: row.default_budget_cents,
    status: row.workflow_status
  };
}

function recordNeedEvent(needId, eventType, details = {}) {
  db.prepare(`INSERT INTO community_request_events
    (id, need_id, event_type, actor_label, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(cryptoRandomId(), needId, eventType, "Workspace operator", JSON.stringify(details), now());
}

function createNeed({ id, workspaceId, title, category, location, summary, suggestedPrompt, defaultBudgetCents }) {
  const timestamp = now();
  withTransaction(() => {
    db.prepare(`INSERT INTO community_needs
      (id, workspace_id, title, category, location, summary, suggested_prompt, default_budget_cents, workflow_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review', ?)`)
      .run(id, workspaceId, title, category, location, summary, suggestedPrompt, defaultBudgetCents, timestamp);
    recordNeedEvent(id, "request.created", { status: "review" });
  });
  return getNeed(id, workspaceId);
}

function setNeedStatus(needId, status, workspaceId) {
  const transitions = {
    review: new Set(["ready", "closed"]),
    ready: new Set(["review", "closed"]),
    closed: new Set(["review", "ready"])
  };
  return withTransaction(() => {
    const current = getNeed(needId, workspaceId);
    if (!current) throw Object.assign(new Error("That request could not be found."), { statusCode: 404 });
    if (current.status === status) return current;
    if (!transitions[current.status]?.has(status)) throw Object.assign(new Error("That request cannot move to this status."), { statusCode: 409 });
    db.prepare("UPDATE community_needs SET workflow_status = ? WHERE id = ? AND workspace_id = ?").run(status, needId, workspaceId);
    recordNeedEvent(needId, "request.status-changed", { from: current.status, to: status });
    return getNeed(needId, workspaceId);
  });
}

function listNeedEvents(needId, workspaceId) {
  return db.prepare(`SELECT event_type AS type, actor_label AS actor, details_json AS details, created_at AS createdAt
    FROM community_request_events WHERE need_id = ? AND EXISTS (
      SELECT 1 FROM community_needs n WHERE n.id = community_request_events.need_id AND n.workspace_id = ?
    ) ORDER BY created_at DESC LIMIT 30`).all(needId, workspaceId)
    .map((row) => ({ ...row, details: JSON.parse(row.details) }));
}

function listProducts({ activeOnly = true } = {}) {
  const query = activeOnly
    ? "SELECT * FROM catalog_products WHERE active = 1 ORDER BY category, name"
    : "SELECT * FROM catalog_products ORDER BY category, name";
  return db.prepare(query).all().map(parseProduct);
}

function getProductsByIds(ids) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.prepare(`SELECT * FROM catalog_products WHERE active = 1 AND id IN (${placeholders})`).all(...uniqueIds).map(parseProduct);
}

function insertAgentRun({ id, needId, workspaceId, source, intent, budgetCents, constraints, plan }) {
  db.prepare(`INSERT INTO agent_runs (id, need_id, workspace_id, source, intent, budget_cents, constraints_json, plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, needId, workspaceId, source, intent, budgetCents, JSON.stringify(constraints), JSON.stringify(plan), now());
}

function recordAudit(orderId, eventType, details = {}) {
  db.prepare("INSERT INTO audit_events (id, order_id, event_type, details_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(cryptoRandomId(), orderId, eventType, JSON.stringify(details), now());
}

function cryptoRandomId() {
  return crypto.randomUUID();
}

function normalizeSelection(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) throw Object.assign(new Error("Choose between 1 and 12 kit items."), { statusCode: 400 });
  const merged = new Map();
  for (const entry of items) {
    if (!entry || typeof entry.productId !== "string" || !Number.isInteger(Number(entry.quantity))) throw Object.assign(new Error("Every item needs a valid catalog product and whole-number quantity."), { statusCode: 400 });
    const quantity = Number(entry.quantity);
    if (quantity < 1 || quantity > 20) throw Object.assign(new Error("Kit quantities must be between 1 and 20."), { statusCode: 400 });
    merged.set(entry.productId, (merged.get(entry.productId) || 0) + quantity);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

function orderItems(orderId) {
  return db.prepare(`SELECT id, product_id AS productId, sku_snapshot AS sku, name_snapshot AS name,
      unit_label_snapshot AS unitLabel, unit_price_cents AS unitPriceCents, quantity,
      line_total_cents AS lineTotalCents, reason
    FROM order_items WHERE order_id = ? ORDER BY rowid`).all(orderId);
}

function getOrderById(orderId, workspaceId) {
  const row = workspaceId
    ? db.prepare("SELECT * FROM orders WHERE id = ? AND workspace_id = ?").get(orderId, workspaceId)
    : db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!row) return null;
  return formatOrder(row);
}

function getOrderByIdempotencyKey(key, workspaceId) {
  const row = db.prepare("SELECT * FROM orders WHERE idempotency_key = ? AND workspace_id = ?").get(key, workspaceId);
  return row ? formatOrder(row) : null;
}

function formatOrder(row) {
  return {
    id: row.id,
    needId: row.need_id,
    needTitle: row.need_title_snapshot,
    needLocation: row.need_location_snapshot,
    intent: row.intent,
    budgetCents: row.budget_cents,
    subtotalCents: row.subtotal_cents,
    constraints: JSON.parse(row.constraints_json),
    currency: row.pay_currency_code || row.currency,
    fxRate: row.fx_rate,
    fxRateDate: row.fx_rate_date,
    status: row.status,
    paypalOrderId: row.paypal_order_id,
    paypalCaptureId: row.paypal_capture_id,
    paypalCreateRequestId: row.paypal_create_request_id,
    paypalCaptureRequestId: row.paypal_capture_request_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capturedAt: row.captured_at,
    items: orderItems(row.id)
  };
}

function validateAndSnapshotItems(items, budgetCents, constraints = { diet: "none", avoidAllergens: [] }) {
  const selection = normalizeSelection(items);
  const catalog = getProductsByIds(selection.map((item) => item.productId));
  if (catalog.length !== selection.length) throw Object.assign(new Error("One or more selected products are no longer available."), { statusCode: 409 });
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  let subtotalCents = 0;
  const snapshots = selection.map(({ productId, quantity }) => {
    const product = catalogById.get(productId);
    if (product.availableStock < quantity) throw Object.assign(new Error(`${product.name} has only ${product.availableStock} available. Update your kit and try again.`), { statusCode: 409 });
    if (product.allergens.some((allergen) => constraints.avoidAllergens.includes(allergen))) throw Object.assign(new Error(`${product.name} conflicts with an allergen restriction. Remove it from the kit.`), { statusCode: 400 });
    if (constraints.diet === "vegetarian" && product.tags.includes("meat")) throw Object.assign(new Error(`${product.name} conflicts with the vegetarian preference.`), { statusCode: 400 });
    if (constraints.diet === "vegan" && product.tags.includes("animal-derived")) throw Object.assign(new Error(`${product.name} conflicts with the vegan preference.`), { statusCode: 400 });
    const lineTotalCents = product.unitPriceCents * quantity;
    subtotalCents += lineTotalCents;
    const source = items.find((item) => item.productId === productId);
    return { ...product, quantity, lineTotalCents, reason: typeof source?.reason === "string" ? source.reason.slice(0, 180) : "" };
  });
  if (subtotalCents <= 0 || subtotalCents > budgetCents) throw Object.assign(new Error("The edited kit exceeds your budget. Remove an item or lower a quantity."), { statusCode: 400 });
  return { snapshots, subtotalCents };
}

function createOrder({ id, workspaceId, needId, intent, budgetCents, agentRunId, idempotencyKey, items, status,
  currency = "USD", fxRate = 1, fxRateDate = "", minorDigits = 2,
  constraints = { diet: "none", avoidAllergens: [] } }) {
  const need = getNeed(needId, workspaceId);
  if (!need) throw Object.assign(new Error("Choose a current community need before building a kit."), { statusCode: 400 });
  if (need.status !== "ready") throw Object.assign(new Error("This request is not ready for procurement. Move it to Ready in the request desk first."), { statusCode: 409 });
  if (agentRunId) {
    const agentRun = db.prepare("SELECT need_id FROM agent_runs WHERE id = ? AND workspace_id = ?").get(agentRunId, workspaceId);
    if (!agentRun || agentRun.need_id !== need.id) throw Object.assign(new Error("Rebuild this kit before checking out."), { statusCode: 400 });
  }
  const selection = normalizeSelection(items).sort((a, b) => a.productId.localeCompare(b.productId));
  const fingerprintInput = JSON.stringify({
    needId: need.id,
    intent: intent.slice(0, 600),
    budgetCents,
    currency,
    fxRate,
    constraints,
    items: selection.map(({ productId, quantity }) => ({ productId, quantity, reason: items.find((item) => item.productId === productId)?.reason || "" }))
  });
  const requestFingerprint = crypto.createHash("sha256").update(fingerprintInput).digest("hex");
  const ensureSameRequest = (existing) => {
    if (existing.requestFingerprint !== requestFingerprint) throw Object.assign(new Error("This checkout key was already used for a different kit. Rebuild the kit to start a new checkout."), { statusCode: 409 });
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
