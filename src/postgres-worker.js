"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { Client } = require("pg");

const state = new Int32Array(workerData.shared, 0, 2);
const bytes = new Uint8Array(workerData.shared, 8);
const client = new Client({
  connectionString: workerData.connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 15000,
  query_timeout: 20000
});

function publish(ok, value) {
  const payload = Buffer.from(ok ? JSON.stringify(value ?? null) : String(value?.message || value || "Database request failed."));
  if (payload.length > bytes.length) {
    const message = Buffer.from("Database response exceeded the supported size.");
    bytes.set(message);
    Atomics.store(state, 1, message.length);
    Atomics.store(state, 0, -1);
  } else {
    bytes.set(payload);
    Atomics.store(state, 1, payload.length);
    Atomics.store(state, 0, ok ? 1 : -1);
  }
  Atomics.notify(state, 0);
}

(async () => {
  await client.connect();
  // The constructor waits for the worker to finish opening its PostgreSQL
  // connection before the app begins creating schema or serving requests.
  publish(true, { ready: true });
  parentPort.on("message", async ({ mode, sql, params = [] }) => {
    try {
      const result = await client.query({ text: sql, values: params, query_timeout: 20000 });
      if (mode === "exec") return publish(true, null);
      const rows = (result.rows || []).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
        if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
          const numeric = Number(value);
          if (Number.isSafeInteger(numeric) || Number.isFinite(numeric)) return [key, numeric];
        }
        return [key, value];
      })));
      if (mode === "get") return publish(true, rows[0] || null);
      if (mode === "all") return publish(true, rows);
      return publish(true, { changes: result.rowCount || 0, lastInsertRowid: 0 });
    } catch (error) {
      publish(false, error);
    }
  });
})().catch((error) => publish(false, error));
