"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_BYTES = 64 * 1024;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp"
};

loadEnv(path.join(ROOT, ".env"));
const database = require("./src/database");
const { buildKitPlan, checkRateLimit: checkAgentRateLimit, cleanText, normalizeConstraints } = require("./src/agent");
const paypal = require("./src/paypal");
const auth = require("./src/auth");
const markets = require("./src/markets");
const fx = require("./src/fx");
const assistant = require("./src/assistant");
const oauth = require("./src/oauth");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

async function readBody(req) {
  let total = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) throw httpError(413, "Request body exceeds 64 KB.");
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.statusCode) throw error;
    throw httpError(400, "The request body could not be read.");
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object.");
    return parsed;
  } catch {
    throw httpError(400, "Send a valid JSON object.");
  }
}

function safeInteger(value, min, max, message) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw httpError(400, message);
  return parsed;
}

function accountPayload(session) {
  return {
    user: {
      id: session.userId, email: session.email, displayName: session.displayName,
      isDemo: Boolean(session.isDemo), hasPassword: Boolean(session.hasPassword)
    },
    workspace: {
      id: session.workspaceId, name: session.workspaceName, countryCode: session.countryCode,
      currencyCode: session.currencyCode, role: session.role
    }
  };
}

function sessionForRequest(req) {
  const token = auth.readCookie(req, "ct_session");
  if (!token) return null;
  const session = database.getSession(auth.tokenHash(token));
  return session?.isDemo && !auth.DEMO_LOGIN_ENABLED ? null : session;
}

function requireSession(req) {
  const session = sessionForRequest(req);
  if (!session) throw httpError(401, "Your session has ended. Sign in again to continue.");
  return session;
}

function requireCsrf(req, session) {
  requireSameOrigin(req);
  const submitted = req.headers["x-ct-csrf"];
  const submittedHash = typeof submitted === "string" ? auth.tokenHash(submitted) : "";
  const actual = Buffer.from(submittedHash, "hex");
  const expected = Buffer.from(session.csrfHash || "", "hex");
  if (!actual.length || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw httpError(403, "Refresh the page and try again. Your security token is missing or expired.");
  }
}

function rotateCsrf(session) {
  const csrfToken = auth.newOpaqueToken(24);
  database.rotateSessionCsrf(session.tokenHash, auth.tokenHash(csrfToken));
  return csrfToken;
}

function cleanCountryAndCurrency(countryCode, currencyCode) {
  const country = markets.country(countryCode);
  const currency = markets.currency(currencyCode);
  if (!country) throw httpError(400, "Choose a market supported by the PayPal REST country list.");
  if (!currency) throw httpError(400, "Choose one of PayPal’s supported REST checkout currencies.");
  if (currency.availableCountryCodes && !currency.availableCountryCodes.includes(country.code)) {
    throw httpError(400, `${currency.code} checkout is only available for in-country PayPal accounts.`);
  }
  return { country, currency };
}

function setSessionCookie(res, req, userId) {
  const token = auth.newOpaqueToken();
  const csrfToken = auth.newOpaqueToken(24);
  const session = { tokenHash: auth.tokenHash(token), csrfHash: auth.tokenHash(csrfToken), userId, expiresAt: auth.sessionExpiry() };
  database.createSession(session);
  appendCookie(res, auth.sessionCookie(token, req));
  return csrfToken;
}

function appendCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  const current = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader("Set-Cookie", [...current, cookie]);
}

function oauthFlowCookie(provider, req, value, clear = false) {
  const secure = Boolean(req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === "true");
  return [
    `ct_oauth_${provider}=${clear ? "" : value}`,
    `Path=/api/auth/oauth/${provider}/callback`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : 600}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function redirect(res, location, cookies = []) {
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  res.end();
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) {
    throw httpError(400, "Refresh the kit review and try again.");
  }
  return value;
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    needId: order.needId,
    needTitle: order.needTitle,
    needLocation: order.needLocation,
    intent: order.intent,
    budgetCents: order.budgetCents,
    subtotalCents: order.subtotalCents,
    currency: order.currency,
    fxRate: order.fxRate,
    fxRateDate: order.fxRateDate,
    constraints: order.constraints,
    status: order.status,
    paypalCaptureId: order.paypalCaptureId,
    errorMessage: order.errorMessage,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    capturedAt: order.capturedAt,
    items: order.items
  };
}

function centsFromPayPal(value, currencyCode) {
  const digits = markets.currency(currencyCode)?.minorDigits;
  if (digits === undefined) return null;
  const match = String(value || "").match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  if (fraction.length > digits && /[^0]/.test(fraction.slice(digits))) return null;
  return Number(match[1]) * (10 ** digits) + Number(fraction.slice(0, digits).padEnd(digits, "0") || 0);
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://www.paypal.com https://www.paypalobjects.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://www.paypalobjects.com",
    "connect-src 'self' https://api-m.sandbox.paypal.com https://generativelanguage.googleapis.com https://www.paypal.com https://www.sandbox.paypal.com https://www.paypalobjects.com",
    "frame-src https://www.paypal.com https://www.sandbox.paypal.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
}

function requireSameOrigin(req) {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") throw httpError(403, "Cross-site requests are not accepted.");
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw httpError(403, "This request origin is not allowed."); }
  if (parsed.host !== req.headers.host) throw httpError(403, "This request origin is not allowed.");
}

async function createPayPalOrder(body, session) {
  if (!paypal.isConfigured()) throw httpError(503, "PayPal sandbox is not configured. Save a local no-charge order record instead.");
  const need = database.getNeed(cleanText(body.needId, 80), session.workspaceId);
  if (!need) throw httpError(400, "Choose one of the listed community needs.");
  const budgetCents = safeInteger(body.budgetCents, 500, 100000, "Choose a budget between $5 and $1,000 USD.");
  const orderIdempotencyKey = validateIdempotencyKey(body.idempotencyKey);
  const intent = cleanText(body.intent, 600);
  const constraints = normalizeConstraints(body.constraints);
  const currency = markets.currency(session.currencyCode);
  const rate = await fx.getUsdRate(currency.code);
  if (intent.length < 12) throw httpError(400, "The kit request is too short. Rebuild it with a little more detail.");
  const items = Array.isArray(body.items) ? body.items.map((item) => ({
    productId: cleanText(item?.productId, 80),
    quantity: Number(item?.quantity),
    reason: cleanText(item?.reason, 180)
  })) : [];

  database.expireReservations();
  const draft = database.createOrder({
    id: crypto.randomUUID(),
    workspaceId: session.workspaceId,
    needId: need.id,
    intent,
    budgetCents,
    agentRunId: cleanText(body.agentRunId, 80),
    idempotencyKey: orderIdempotencyKey,
    items,
    constraints,
    status: "creating-paypal",
    currency: currency.code,
    fxRate: rate.rate,
    fxRateDate: rate.date,
    minorDigits: currency.minorDigits
  });
  if (draft.order.status === "awaiting-approval" && draft.order.paypalOrderId) {
    return { appOrderId: draft.order.id, id: draft.order.paypalOrderId, status: draft.order.status, reused: true };
  }
  if (draft.order.status !== "creating-paypal" || !draft.createRequestId) throw httpError(409, "This order cannot be checked out. Rebuild the kit.");

  try {
    const providerOrder = await paypal.createOrder({ order: draft.order, requestId: draft.createRequestId });
    const saved = database.setPayPalOrder(draft.order.id, providerOrder.id);
    return { appOrderId: saved.id, id: providerOrder.id, status: saved.status, reused: !draft.created };
  } catch (error) {
    // No buyer approval has happened yet, so release the hold even if the
    // network outcome was uncertain. A retry must start with a new checkout key.
    database.markOrderFailed(draft.order.id, error.message);
    throw error;
  }
}

async function capturePayPalOrder(appOrderId, workspaceId) {
  if (!paypal.isConfigured()) throw httpError(503, "PayPal sandbox is not configured.");
  database.expireReservations();
  const order = database.getOrderById(appOrderId, workspaceId);
  if (!order) throw httpError(404, "That order could not be found.");
  if (order.status === "captured-sandbox") return order;
  if (order.status !== "awaiting-approval" || !order.paypalOrderId) throw httpError(409, "This order is no longer waiting for payment.");

  const result = await paypal.captureOrder({ paypalOrderId: order.paypalOrderId, requestId: order.paypalCaptureRequestId });
  if (result.status !== "COMPLETED") throw httpError(502, "PayPal did not complete the sandbox capture.");
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedCents = centsFromPayPal(capture?.amount?.value, order.currency);
  if (!capture?.id || capture.amount?.currency_code !== order.currency || capturedCents !== order.subtotalCents) {
    throw httpError(502, "PayPal's captured amount or currency did not match the saved order.");
  }
  return database.markOrderCaptured(order.id, capture.id, capturedCents);
}

async function routeApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, { status: "ok", database: database.databaseType, aiMode: process.env.GEMINI_API_KEY ? "gemini" : "guided-help", paymentMode: paypal.isConfigured() ? "paypal-sandbox" : "local-demo" });
    return;
  }
  if (req.method === "GET" && pathname === "/api/markets") {
    json(res, 200, { countries: markets.COUNTRIES, currencies: markets.CURRENCIES });
    return;
  }
  if (req.method === "GET" && pathname === "/api/contact") {
    json(res, 200, { email: process.env.SUPPORT_EMAIL || "", phone: process.env.SUPPORT_PHONE || "", website: process.env.SUPPORT_URL || "" });
    return;
  }
  if (req.method === "GET" && pathname === "/api/auth/providers") {
    json(res, 200, {
      providers: oauth.providerStatus(),
      demo: auth.DEMO_LOGIN_ENABLED ? { enabled: true, email: auth.DEMO_EMAIL, password: auth.DEMO_PASSWORD } : { enabled: false }
    });
    return;
  }
  const oauthStart = pathname.match(/^\/api\/auth\/oauth\/(google|paypal)\/start$/);
  if (req.method === "GET" && oauthStart) {
    const provider = oauthStart[1];
    if (!oauth.providerStatus()[provider]?.enabled) throw httpError(503, `${provider === "google" ? "Google" : "PayPal"} sign-in is not configured.`);
    const ip = req.socket.remoteAddress || "unknown";
    const keyHash = crypto.createHash("sha256").update(`oauth-start:${provider}:${ip}`).digest("hex");
    if (database.authAttemptCount(keyHash, new Date(Date.now() - 60 * 60 * 1000).toISOString()) >= 20) throw httpError(429, "Too many provider sign-in attempts. Try again later.");
    database.recordAuthAttempt(keyHash);
    const browserToken = auth.newOpaqueToken();
    const state = auth.newOpaqueToken();
    const nonce = auth.newOpaqueToken();
    const codeVerifier = provider === "google" ? auth.newOpaqueToken(48) : "";
    const codeChallenge = codeVerifier ? crypto.createHash("sha256").update(codeVerifier).digest("base64url") : "";
    const redirectUri = oauth.callbackUri(provider);
    database.storeOAuthFlow({
      stateHash: auth.tokenHash(state), browserHash: auth.tokenHash(browserToken), provider, nonce, codeVerifier,
      redirectUri, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    appendCookie(res, oauthFlowCookie(provider, req, browserToken));
    redirect(res, oauth.authorizationUrl(provider, { state, nonce, codeChallenge }));
    return;
  }
  const oauthCallback = pathname.match(/^\/api\/auth\/oauth\/(google|paypal)\/callback$/);
  if (req.method === "GET" && oauthCallback) {
    const provider = oauthCallback[1];
    const clearCookie = oauthFlowCookie(provider, req, "", true);
    try {
      const state = url.searchParams.get("state") || "";
      const browserToken = auth.readCookie(req, `ct_oauth_${provider}`);
      const flow = state && browserToken ? database.consumeOAuthFlow({
        stateHash: auth.tokenHash(state), browserHash: auth.tokenHash(browserToken), provider
      }) : null;
      if (!flow || url.searchParams.has("error")) throw new Error("OAuth callback could not be verified.");
      const code = url.searchParams.get("code") || "";
      if (!code || code.length > 4096) throw new Error("OAuth callback did not include a valid code.");
      const identity = await oauth.exchangeCode(provider, code, flow);
      const email = cleanText(identity.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("OAuth provider did not return an email address.");

      let account;
      const linked = database.findOAuthIdentity(provider, identity.subject);
      if (linked) account = database.getAccount(linked.userId);
      else {
        const existingUser = database.getUserByEmail(email);
        const passwordHash = existingUser ? "" : await auth.hashPassword(auth.newOpaqueToken(48));
        account = database.resolveOAuthAccount({
          provider, subject: identity.subject, email,
          displayName: cleanText(identity.displayName, 80) || email.split("@")[0],
          passwordHash, id: crypto.randomUUID(), workspaceId: crypto.randomUUID(),
          workspaceName: `${cleanText(identity.displayName, 48) || "My"} community`, countryCode: "US", currencyCode: "USD"
        });
      }
      if (!account) throw new Error("OAuth account could not be loaded.");
      setSessionCookie(res, req, account.userId);
      appendCookie(res, clearCookie);
      redirect(res, "/");
    } catch (error) {
      if (Number(error.statusCode) >= 500) console.error(`${provider} sign-in failed: ${cleanText(error.message, 120)}`);
      redirect(res, "/login.html?auth_error=social_signin_failed", [clearCookie]);
    }
    return;
  }
  if (req.method === "GET" && pathname === "/api/auth/session") {
    const session = sessionForRequest(req);
    if (!session) throw httpError(401, "Sign in to continue.");
    json(res, 200, { ...accountPayload(session), csrfToken: rotateCsrf(session) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/signup") {
    requireSameOrigin(req);
    const body = await readBody(req);
    const name = cleanText(body.displayName, 80);
    const workspaceName = cleanText(body.workspaceName, 80);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2) throw httpError(400, "Enter a name with at least two characters.");
    if (workspaceName.length < 2) throw httpError(400, "Enter a community or organization name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid email address.");
    if (password.length < 12 || password.length > 128) throw httpError(400, "Use a password between 12 and 128 characters.");
    const ip = req.socket.remoteAddress || "unknown";
    const keyHash = crypto.createHash("sha256").update(`signup:${ip}`).digest("hex");
    if (database.authAttemptCount(keyHash, new Date(Date.now() - 86400000).toISOString()) >= 5) throw httpError(429, "Too many accounts were created from this connection. Try again tomorrow.");
    database.recordAuthAttempt(keyHash);
    if (database.getUserByEmail(email)) throw httpError(409, "An account with this email already exists. Sign in instead.");
    const { country, currency } = cleanCountryAndCurrency(body.countryCode || "US", body.currencyCode || "USD");
    const id = crypto.randomUUID();
    const account = database.createAccount({
      id, email, displayName: name, passwordHash: await auth.hashPassword(password),
      workspaceId: crypto.randomUUID(), workspaceName, countryCode: country.code, currencyCode: currency.code
    });
    const csrfToken = setSessionCookie(res, req, id);
    json(res, 201, { ...accountPayload(account), csrfToken });
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/login") {
    requireSameOrigin(req);
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const ip = req.socket.remoteAddress || "unknown";
    const keyHash = crypto.createHash("sha256").update(`login:${ip}:${email}`).digest("hex");
    if (database.authAttemptCount(keyHash, new Date(Date.now() - 15 * 60 * 1000).toISOString()) >= 10) throw httpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
    const user = database.getUserByEmail(email);
    const valid = user && (!user.is_demo || auth.DEMO_LOGIN_ENABLED) && user.password_auth_enabled && password.length <= 128 && await auth.verifyPassword(password, user.password_hash);
    if (!valid) {
      database.recordAuthAttempt(keyHash);
      throw httpError(401, "Email or password is incorrect.");
    }
    const account = database.getAccount(user.id);
    const csrfToken = setSessionCookie(res, req, user.id);
    json(res, 200, { ...accountPayload(account), csrfToken });
    return;
  }
  if (req.method === "POST" && pathname === "/api/contact") {
    const session = sessionForRequest(req);
    if (session?.isDemo) throw httpError(403, "The shared demo account cannot submit support records. Create a personal account to contact support.");
    if (session) requireCsrf(req, session);
    else requireSameOrigin(req);
    const ip = req.socket.remoteAddress || "unknown";
    const keyHash = crypto.createHash("sha256").update(`contact:${ip}`).digest("hex");
    if (database.authAttemptCount(keyHash, new Date(Date.now() - 60 * 60 * 1000).toISOString()) >= 6) {
      throw httpError(429, "Too many support requests were sent from this connection. Try again in an hour.");
    }
    database.recordAuthAttempt(keyHash);
    const body = await readBody(req);
    const email = session?.email || cleanText(body.email, 254).toLowerCase();
    const category = cleanText(body.category, 32);
    const subject = cleanText(body.subject, 120);
    const message = cleanText(body.message, 3000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid reply email.");
    if (!["Account", "Payments", "Community requests", "Technical issue", "Other"].includes(category)) throw httpError(400, "Choose a support topic.");
    if (subject.length < 4 || message.length < 20) throw httpError(400, "Add a subject and at least 20 characters describing the issue.");
    const ticket = database.createSupportTicket({ id: crypto.randomUUID(), userId: session?.userId, workspaceId: session?.workspaceId, email, category, subject, message });
    json(res, 201, { ticket, message: "Your support request has been saved." });
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const session = sessionForRequest(req);
    if (session) {
      requireCsrf(req, session);
      database.deleteSession(session.tokenHash);
    } else requireSameOrigin(req);
    res.setHeader("Set-Cookie", auth.sessionCookie("", req, true));
    json(res, 200, { ok: true });
    return;
  }

  const session = requireSession(req);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) requireCsrf(req, session);
  if (session.isDemo && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && !["/api/agent/kit", "/api/assistant/chat"].includes(pathname)) {
    throw httpError(403, "The shared demo workspace is read-only. Create a personal account to save changes or place orders.");
  }

  if (req.method === "GET" && pathname === "/api/config") {
    let rate = null;
    let rateError = "";
    try { rate = await fx.getUsdRate(session.currencyCode); } catch (error) { rateError = error.message; }
    json(res, 200, {
      aiMode: process.env.GEMINI_API_KEY ? "gemini" : "guided-help",
      assistantMode: process.env.GEMINI_API_KEY ? "gemini" : "guided-help",
      paymentMode: paypal.isConfigured() ? "paypal-sandbox" : "local-demo",
      paypalClientId: paypal.getPublicClientId(),
      currency: session.currencyCode,
      currencyName: markets.currency(session.currencyCode)?.name || "US dollar",
      minorDigits: markets.currency(session.currencyCode)?.minorDigits ?? 2,
      fx: rate,
      fxError: rateError
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/board") {
    database.expireReservations();
    json(res, 200, { needs: database.listNeeds(session.workspaceId), metrics: database.getMetrics(session.workspaceId), orders: database.listOrders(session.workspaceId, 6).map(publicOrder) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/catalog") {
    database.expireReservations();
    let rate = null;
    try { rate = await fx.getUsdRate(session.currencyCode); } catch {}
    json(res, 200, { products: database.listProducts(), source: "workspace-catalog", baseCurrency: "USD", currency: session.currencyCode, fx: rate });
    return;
  }
  if (req.method === "GET" && pathname === "/api/account/sessions") {
    json(res, 200, { sessions: database.listSessions(session.userId, session.tokenHash) });
    return;
  }
  if (req.method === "DELETE" && pathname === "/api/account/sessions") {
    database.deleteOtherSessions(session.userId, session.tokenHash);
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && pathname === "/api/account/support") {
    json(res, 200, { tickets: database.listSupportTickets(session.workspaceId) });
    return;
  }
  if (req.method === "PATCH" && pathname === "/api/account/profile") {
    const body = await readBody(req);
    const displayName = cleanText(body.displayName, 80);
    const workspaceName = cleanText(body.workspaceName, 80);
    if (displayName.length < 2 || workspaceName.length < 2) throw httpError(400, "Names need at least two characters.");
    const { country, currency } = cleanCountryAndCurrency(body.countryCode, body.currencyCode);
    const account = database.updateAccount({ userId: session.userId, displayName, workspaceName, countryCode: country.code, currencyCode: currency.code });
    json(res, 200, accountPayload(account));
    return;
  }
  if (req.method === "POST" && pathname === "/api/account/password") {
    const body = await readBody(req);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const user = database.getUserByEmail(session.email);
    if (!user || (user.password_auth_enabled && !await auth.verifyPassword(currentPassword, user.password_hash))) throw httpError(400, "Your current password is incorrect.");
    if (newPassword.length < 12 || newPassword.length > 128) throw httpError(400, "Use a new password between 12 and 128 characters.");
    database.updatePassword(session.userId, await auth.hashPassword(newPassword));
    database.deleteOtherSessions(session.userId, session.tokenHash);
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && pathname === "/api/assistant/chat") {
    const body = await readBody(req);
    const message = cleanText(body.message, 1000);
    if (message.length < 2) throw httpError(400, "Ask a short question first.");
    assistant.checkRateLimit(session.userId);
    const metrics = database.getMetrics(session.workspaceId);
    json(res, 200, await assistant.answer({ message, history: body.history, account: session, metrics }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/needs") {
    const body = await readBody(req);
    const title = cleanText(body.title, 80);
    const category = cleanText(body.category, 32);
    const location = cleanText(body.location, 80);
    const summary = cleanText(body.summary, 500);
    const categories = new Set(["Food", "Learning", "Community space", "Emergency", "Other"]);
    if (title.length < 4) throw httpError(400, "Give this request a clear title of at least four characters.");
    if (!categories.has(category)) throw httpError(400, "Choose a request category from the list.");
    if (location.length < 2) throw httpError(400, "Add a city, region, or community area.");
    if (summary.length < 24) throw httpError(400, "Describe the practical need in at least 24 characters.");
    const defaultBudgetCents = safeInteger(body.budgetCents, 500, 100000, "Set an approved planning cap between $5 and $1,000 USD.");
    const need = database.createNeed({
      id: crypto.randomUUID(), workspaceId: session.workspaceId, title, category, location, summary,
      suggestedPrompt: `Plan a practical supply kit for this request: ${summary}`, defaultBudgetCents
    });
    json(res, 201, { need, events: database.listNeedEvents(need.id, session.workspaceId) });
    return;
  }
  const needStatus = pathname.match(/^\/api\/needs\/([a-z0-9-]{1,80})\/status$/i);
  if (req.method === "PATCH" && needStatus) {
    const body = await readBody(req);
    if (!["review", "ready", "closed"].includes(body.status)) throw httpError(400, "Choose Review, Ready, or Closed.");
    const need = database.setNeedStatus(needStatus[1], body.status, session.workspaceId);
    json(res, 200, { need, events: database.listNeedEvents(need.id, session.workspaceId) });
    return;
  }
  const needEvents = pathname.match(/^\/api\/needs\/([a-z0-9-]{1,80})\/events$/i);
  if (req.method === "GET" && needEvents) {
    if (!database.getNeed(needEvents[1], session.workspaceId)) throw httpError(404, "That request could not be found.");
    json(res, 200, { events: database.listNeedEvents(needEvents[1], session.workspaceId) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/agent/kit") {
    const body = await readBody(req);
    const budgetCents = safeInteger(body.budgetCents, 500, 100000, "Choose a budget between $5 and $1,000 USD.");
    checkAgentRateLimit(session.userId);
    const plan = await buildKitPlan({ needId: cleanText(body.needId, 80), workspaceId: session.workspaceId, intent: cleanText(body.intent, 600), budgetCents, constraints: body.constraints });
    json(res, 200, plan);
    return;
  }
  if (req.method === "POST" && pathname === "/api/orders") {
    json(res, 201, await createPayPalOrder(await readBody(req), session));
    return;
  }
  if (req.method === "POST" && pathname === "/api/local-orders") {
    if (paypal.isConfigured()) throw httpError(403, "PayPal sandbox checkout is enabled. Use its buyer approval flow.");
    const body = await readBody(req);
    const need = database.getNeed(cleanText(body.needId, 80), session.workspaceId);
    if (!need) throw httpError(400, "Choose one of the listed community needs.");
    const budgetCents = safeInteger(body.budgetCents, 500, 100000, "Choose a budget between $5 and $1,000 USD.");
    const intent = cleanText(body.intent, 600);
    const constraints = normalizeConstraints(body.constraints);
    if (intent.length < 12) throw httpError(400, "The kit request is too short. Rebuild it with a little more detail.");
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const items = Array.isArray(body.items) ? body.items.map((item) => ({ productId: cleanText(item?.productId, 80), quantity: Number(item?.quantity), reason: cleanText(item?.reason, 180) })) : [];
    const currency = markets.currency(session.currencyCode);
    const rate = await fx.getUsdRate(currency.code);
    const order = database.createOrder({
      id: crypto.randomUUID(), workspaceId: session.workspaceId, needId: need.id, intent, budgetCents,
      agentRunId: cleanText(body.agentRunId, 80), idempotencyKey, items, constraints, status: "local-demo",
      currency: currency.code, fxRate: rate.rate, fxRateDate: rate.date, minorDigits: currency.minorDigits
    }).order;
    json(res, 201, { order: publicOrder(order), audit: database.listAuditEvents(order.id) });
    return;
  }
  const orderCapture = pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/capture$/i);
  if (req.method === "POST" && orderCapture) {
    await readBody(req);
    const order = await capturePayPalOrder(orderCapture[1], session.workspaceId);
    json(res, 200, { order: publicOrder(order), audit: database.listAuditEvents(order.id) });
    return;
  }
  const orderCancel = pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/cancel$/i);
  if (req.method === "POST" && orderCancel) {
    await readBody(req);
    const current = database.getOrderById(orderCancel[1], session.workspaceId);
    if (!current) throw httpError(404, "That order could not be found.");
    if (current.status === "awaiting-approval") database.markOrderCancelled(current.id);
    const order = database.getOrderById(current.id, session.workspaceId);
    json(res, 200, { order: publicOrder(order) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/orders") {
    json(res, 200, { orders: database.listOrders(session.workspaceId, 40).map(publicOrder), metrics: database.getMetrics(session.workspaceId) });
    return;
  }
  const orderDetail = pathname.match(/^\/api\/orders\/([a-f0-9-]{36})$/i);
  if (req.method === "GET" && orderDetail) {
    const order = database.getOrderById(orderDetail[1], session.workspaceId);
    if (!order) throw httpError(404, "That order could not be found.");
    json(res, 200, { order: publicOrder(order), audit: database.listAuditEvents(order.id) });
    return;
  }
  throw httpError(404, "API route not found.");
}

function serveStatic(pathname, res, headOnly = false) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw httpError(400, "The page address is malformed."); }
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    throw httpError(404, "Page not found.");
  }
  let stat;
  try { stat = fs.statSync(filePath); } catch { throw httpError(404, "Page not found."); }
  if (!stat.isFile()) throw httpError(404, "Page not found.");
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-store"
  });
  if (headOnly) { res.end(); return; }
  fs.createReadStream(filePath).pipe(res);
}

async function route(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    await routeApi(req, res, url);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "This page only accepts GET requests.");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (!sessionForRequest(req)) {
      res.writeHead(302, { Location: "/login.html", "Cache-Control": "no-store" });
      res.end();
      return;
    }
  }
  if (url.pathname === "/login.html" && sessionForRequest(req)) {
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return;
  }
  serveStatic(url.pathname, res, req.method === "HEAD");
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent || res.destroyed) return;
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) console.error(`${req.method} ${new URL(req.url, "http://localhost").pathname}: ${cleanText(error.message, 180)}`);
    json(res, statusCode, { error: cleanText(error.message, 240) || "The request could not be completed." });
  });
});

server.requestTimeout = 30000;
server.headersTimeout = 10000;
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

async function prepareDemoWorkspace() {
  if (!auth.DEMO_LOGIN_ENABLED) return;
  const [localPart, domain] = auth.DEMO_EMAIL.split("@");
  const passwordHash = await auth.hashPassword(auth.DEMO_PASSWORD);
  for (let suffix = 0; suffix <= 100; suffix += 1) {
    const demoEmail = suffix === 0 ? auth.DEMO_EMAIL : `${localPart}+judge${suffix === 1 ? "" : suffix}@${domain}`;
    const existing = database.getUserByEmail(demoEmail);
    if (existing && !existing.is_demo) continue;
    try {
      database.ensureDemoAccount({
        id: existing?.id || "commonthread-demo-account",
        email: demoEmail,
        displayName: "CommonThread Demo",
        passwordHash,
        workspaceId: "commonthread-demo-workspace",
        workspaceName: "CommonThread demo",
        countryCode: "US",
        currencyCode: "USD"
      });
      auth.DEMO_EMAIL = demoEmail;
      return;
    } catch (error) {
      if (!String(error.message).includes("DEMO_EMAIL is already used by a normal account")) throw error;
    }
  }
  throw new Error("Could not allocate a separate demo sign-in address.");
}

prepareDemoWorkspace().then(() => {
  server.listen(port, host, () => {
    console.log(`CommonThread running at http://${host}:${port} (${paypal.isConfigured() ? "PayPal sandbox" : "local no-charge records"}; ${database.databaseType})`);
  });
}).catch((error) => {
  console.error(`CommonThread could not start: ${cleanText(error.message, 180)}`);
  database.closeDatabase();
  process.exitCode = 1;
});

function shutdown() {
  server.close(() => {
    database.closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
