"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;
const PASSWORD_N = 32768;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const PASSWORD_LENGTH = 64;
const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@commonthread.test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "CommonThreadDemo2026!";
const DEMO_LOGIN_ENABLED = process.env.DEMO_LOGIN_ENABLED !== "false";

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_LENGTH, { N: PASSWORD_N, r: PASSWORD_R, p: PASSWORD_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltText, keyText] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !/^\d+$/.test(n) || !/^\d+$/.test(r) || !/^\d+$/.test(p) || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const salt = Buffer.from(saltText, "base64url");
  if (!expected.length || !salt.length) return false;
  const actual = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function newOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function readCookie(req, name) {
  const source = req.headers.cookie || "";
  for (const pair of source.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return "";
}

function sessionCookie(token, req, clear = false) {
  const secure = Boolean(req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === "true");
  return [
    `ct_session=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : SESSION_DAYS * 24 * 60 * 60}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = { DEMO_EMAIL, DEMO_LOGIN_ENABLED, DEMO_PASSWORD, SESSION_DAYS, hashPassword, newOpaqueToken, readCookie, sessionCookie, sessionExpiry, tokenHash, verifyPassword };
