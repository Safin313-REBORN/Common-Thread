"use strict";

const crypto = require("node:crypto");

const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";
const PAYPAL_LIVE = "https://api-m.paypal.com";
let googleKeysCache = { keys: [], expiresAt: 0 };

function callbackUri(provider) {
  const envKey = provider === "google" ? "GOOGLE_OAUTH_REDIRECT_URI" : "PAYPAL_LOGIN_REDIRECT_URI";
  if (process.env[envKey]) return process.env[envKey];
  const port = Number(process.env.PORT) || 3000;
  return `http://localhost:${port}/api/auth/oauth/${provider}/callback`;
}

function paypalApiBase() {
  return process.env.PAYPAL_LOGIN_ENV === "live" ? PAYPAL_LIVE : PAYPAL_SANDBOX;
}

function providerStatus() {
  return {
    google: {
      enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      redirectUri: callbackUri("google")
    },
    paypal: {
      enabled: Boolean(process.env.PAYPAL_LOGIN_CLIENT_ID && process.env.PAYPAL_LOGIN_CLIENT_SECRET),
      redirectUri: callbackUri("paypal"),
      environment: process.env.PAYPAL_LOGIN_ENV === "live" ? "live" : "sandbox"
    }
  };
}

function providerConfig(provider) {
  if (provider === "google") {
    if (!providerStatus().google.enabled) throw Object.assign(new Error("Google sign-in is not configured."), { statusCode: 503 });
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: callbackUri("google")
    };
  }
  if (provider === "paypal") {
    if (!providerStatus().paypal.enabled) throw Object.assign(new Error("PayPal sign-in is not configured."), { statusCode: 503 });
    return {
      clientId: process.env.PAYPAL_LOGIN_CLIENT_ID,
      clientSecret: process.env.PAYPAL_LOGIN_CLIENT_SECRET,
      redirectUri: callbackUri("paypal")
    };
  }
  throw Object.assign(new Error("Choose a supported sign-in provider."), { statusCode: 404 });
}

function authorizationUrl(provider, { state, nonce, codeChallenge }) {
  const config = providerConfig(provider);
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    }).toString();
    return url.toString();
  }

  const url = new URL("https://www.sandbox.paypal.com/connect");
  if (process.env.PAYPAL_LOGIN_ENV === "live") url.hostname = "www.paypal.com";
  url.search = new URLSearchParams({
    flowEntry: "static",
    client_id: config.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: config.redirectUri,
    state,
    nonce
  }).toString();
  return url.toString();
}

async function readJson(response, message) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(message), { statusCode: 502 });
  return payload;
}

async function exchangeGoogleCode(code, flow) {
  const config = providerConfig("google");
  let response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: flow.redirectUri,
        grant_type: "authorization_code",
        code_verifier: flow.codeVerifier
      }),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw Object.assign(new Error("Google sign-in could not be completed. Try again."), { statusCode: 502 });
  }
  const token = await readJson(response, "Google sign-in could not be completed. Try again.");
  const claims = await validateGoogleIdToken(token.id_token, config.clientId, flow.nonce);
  if (!claims.email || claims.email_verified !== true || !claims.sub) {
    throw Object.assign(new Error("Google did not return a verified email address."), { statusCode: 401 });
  }
  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    displayName: claims.name || claims.given_name || claims.email.split("@")[0]
  };
}

async function getGoogleKeys(force = false) {
  if (!force && googleKeysCache.expiresAt > Date.now() && googleKeysCache.keys.length) return googleKeysCache.keys;
  let response;
  try {
    response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(8000) });
  } catch {
    throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 502 });
  }
  const payload = await readJson(response, "Google sign-in could not be verified. Try again.");
  if (!Array.isArray(payload.keys)) throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 502 });
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1]) || 3600;
  googleKeysCache = { keys: payload.keys, expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 21600)) * 1000 };
  return googleKeysCache.keys;
}

function parseJwtPart(part) {
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); }
  catch { return null; }
}

async function validateGoogleIdToken(idToken, clientId, expectedNonce) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 401 });
  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) {
    throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 401 });
  }

  let keys = await getGoogleKeys();
  let jwk = keys.find((key) => key.kid === header.kid && key.alg === "RS256");
  if (!jwk) {
    keys = await getGoogleKeys(true);
    jwk = keys.find((key) => key.kid === header.kid && key.alg === "RS256");
  }
  if (!jwk) throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 401 });
  let signatureValid = false;
  try {
    signatureValid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  } catch { /* A malformed signing key is treated as an invalid token. */ }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const issuerValid = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
  const timeValid = Number(claims.exp) > Date.now() / 1000 && Number(claims.iat) <= Date.now() / 1000 + 60;
  const audienceValid = audience.includes(clientId) && (!claims.azp || claims.azp === clientId);
  if (!signatureValid || !issuerValid || !timeValid || !audienceValid || claims.nonce !== expectedNonce) {
    throw Object.assign(new Error("Google sign-in could not be verified. Try again."), { statusCode: 401 });
  }
  return claims;
}

async function exchangePayPalCode(code) {
  const config = providerConfig("paypal");
  let tokenResponse;
  try {
    tokenResponse = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw Object.assign(new Error("PayPal sign-in could not be completed. Try again."), { statusCode: 502 });
  }
  const token = await readJson(tokenResponse, "PayPal sign-in could not be completed. Try again.");
  if (!token.access_token) throw Object.assign(new Error("PayPal sign-in could not be completed. Try again."), { statusCode: 502 });

  let userResponse;
  try {
    userResponse = await fetch(`${paypalApiBase()}/v1/identity/openidconnect/userinfo?schema=openid`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw Object.assign(new Error("PayPal could not share the account details needed to sign in."), { statusCode: 502 });
  }
  const profile = await readJson(userResponse, "PayPal could not share the account details needed to sign in.");
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  const subject = profile.sub || profile.user_id;
  if (!subject || !email || profile.email_verified !== true) {
    throw Object.assign(new Error("PayPal did not return a verified email address."), { statusCode: 401 });
  }
  const fullName = [profile.given_name, profile.family_name].filter(Boolean).join(" ");
  return { subject: String(subject), email, displayName: profile.name || fullName || email.split("@")[0] };
}

async function exchangeCode(provider, code, flow) {
  if (provider === "google") return exchangeGoogleCode(code, flow);
  if (provider === "paypal") return exchangePayPalCode(code, flow);
  throw Object.assign(new Error("Choose a supported sign-in provider."), { statusCode: 404 });
}

module.exports = { authorizationUrl, callbackUri, exchangeCode, providerStatus };
