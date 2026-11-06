"use strict";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
const { currency: getCurrency } = require("./markets");
let cachedToken = "";
let tokenExpiresAt = 0;

function isConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function getPublicClientId() {
  return process.env.PAYPAL_CLIENT_ID || "";
}

function formatMinor(amount, currencyCode) {
  const digits = getCurrency(currencyCode)?.minorDigits;
  if (digits === undefined) throw Object.assign(new Error("This currency is not supported by PayPal checkout."), { statusCode: 400 });
  return (amount / (10 ** digits)).toFixed(digits);
}

async function accessToken() {
  if (!isConfigured()) throw Object.assign(new Error("PayPal sandbox credentials are not configured."), { statusCode: 503 });
  if (cachedToken && tokenExpiresAt > Date.now() + 30000) return cachedToken;
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw Object.assign(new Error(result.error_description || "PayPal sandbox authentication failed. Check the sandbox app credentials."), { statusCode: 502, knownFailure: true });
  }
  cachedToken = result.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, Number(result.expires_in || 0) - 60) * 1000;
  return cachedToken;
}

async function request(url, method, body, requestId) {
  const token = await accessToken();
  const response = await fetch(`${PAYPAL_BASE}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = result.details?.[0]?.description || result.message || "PayPal sandbox request failed.";
    throw Object.assign(new Error(issue.slice(0, 240)), { statusCode: 502, knownFailure: true, providerStatus: response.status });
  }
  return result;
}

async function createOrder({ order, requestId }) {
  const currency = order.currency;
  const items = order.items.map((item) => ({
    name: item.name.slice(0, 127),
    description: `${item.sku} · ${item.reason || item.category}`.slice(0, 127),
    sku: item.sku,
    category: "PHYSICAL_GOODS",
    quantity: String(item.quantity),
    unit_amount: { currency_code: currency, value: formatMinor(item.unitPriceCents, currency) }
  }));
  const payload = await request("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "CommonThread",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING"
        }
      }
    },
    purchase_units: [{
      reference_id: "commonthread-kit",
      invoice_id: order.id,
      custom_id: `${order.needId}:${order.id}`.slice(0, 127),
      description: `Supply kit for ${order.needTitle}`.slice(0, 127),
      amount: {
        currency_code: currency,
        value: formatMinor(order.subtotalCents, currency),
        breakdown: { item_total: { currency_code: currency, value: formatMinor(order.subtotalCents, currency) } }
      },
      items
    }]
  }, requestId);
  if (!payload.id) throw Object.assign(new Error("PayPal did not return an order ID."), { statusCode: 502, knownFailure: true });
  return payload;
}

async function captureOrder({ paypalOrderId, requestId }) {
  return request(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, "POST", {}, requestId);
}

module.exports = { captureOrder, createOrder, getPublicClientId, isConfigured };
