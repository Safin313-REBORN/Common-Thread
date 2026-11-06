"use strict";

const { currency } = require("./markets");

const cache = new Map();
const CACHE_MS = 12 * 60 * 60 * 1000;

async function getUsdRate(currencyCode) {
  const target = currency(currencyCode);
  if (!target) throw Object.assign(new Error("Choose a currency supported by PayPal checkout."), { statusCode: 400 });
  if (target.code === "USD") return { currency: "USD", rate: 1, date: new Date().toISOString().slice(0, 10), provider: "base-currency" };
  const cached = cache.get(target.code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.value;
  try {
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${encodeURIComponent(target.code)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6500)
    });
    const payload = await response.json().catch(() => ({}));
    const rate = Number(payload.rates?.[target.code]);
    if (!response.ok || !Number.isFinite(rate) || rate <= 0 || typeof payload.date !== "string") throw new Error("No current reference rate is published for this currency.");
    const value = { currency: target.code, rate, date: payload.date, provider: "Frankfurter reference rate" };
    cache.set(target.code, { value, fetchedAt: Date.now() });
    return value;
  } catch (error) {
    if (cached && Date.now() - cached.fetchedAt < 48 * 60 * 60 * 1000) return { ...cached.value, stale: true };
    throw Object.assign(new Error(`A current ${target.code} reference rate is unavailable. Switch to USD or try again later.`), { statusCode: 503 });
  }
}

function toMinorUnits(usdCents, rate, minorDigits) {
  const amount = (Number(usdCents) / 100) * rate;
  return Math.round(amount * (10 ** minorDigits));
}

function formatMinorUnits(amount, currencyCode, minorDigits) {
  return (Number(amount) / (10 ** minorDigits)).toFixed(minorDigits);
}

module.exports = { formatMinorUnits, getUsdRate, toMinorUnits };
