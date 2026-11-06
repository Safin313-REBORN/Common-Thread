"use strict";

const $ = (selector) => document.querySelector(selector);
const nextUrl = new URLSearchParams(location.search).get("next");
const safeNext = nextUrl && nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : "/";
const defaultDemo = { email: "demo@commonthread.test", password: "CommonThreadDemo2026!" };
let demoCredentials = { ...defaultDemo };
let markets = { countries: [], currencies: [] };

function populateSelect(select, items, value, label) {
  select.innerHTML = items.map((item) => `<option value="${item[value]}">${label(item)}</option>`).join("");
}

function updateMarketNote(countrySelect, currencySelect, note) {
  const country = markets.countries.find((item) => item.code === countrySelect.value);
  const currency = markets.currencies.find((item) => item.code === currencySelect.value);
  if (!country || !currency) return;
  note.textContent = `Local currency: ${country.localCurrency}. PayPal checkout currency: ${currency.code}. Availability and settlement depend on the merchant account.`;
}

function updateSignupCurrencies(preferredCode = "") {
  const countryCode = $("#signup-country").value;
  const currencies = markets.currencies.filter((item) => !item.availableCountryCodes || item.availableCountryCodes.includes(countryCode));
  populateSelect($("#signup-currency"), currencies, "code", (item) => `${item.code} · ${item.name}`);
  const country = markets.countries.find((item) => item.code === countryCode);
  const selectedCode = currencies.some((item) => item.code === preferredCode)
    ? preferredCode
    : country?.defaultCheckoutCurrency;
  $("#signup-currency").value = selectedCode || "USD";
}

async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function showSignup(visible) {
  const loginForm = $("#login-form");
  const signupForm = $("#signup-form");
  const nextForm = visible ? signupForm : loginForm;
  loginForm.hidden = visible;
  signupForm.hidden = !visible;
  $("#demo-access").hidden = visible || !demoCredentials.enabled;
  $("#auth-title").textContent = visible ? "Create your workspace." : "Sign in to continue.";
  $("#auth-subtitle").textContent = visible ? "Start a private space for your community." : "Open your community procurement workspace.";
  $("#auth-switch").innerHTML = visible
    ? 'Already have an account? <button id="show-login" type="button">Sign in</button>'
    : 'New to CommonThread? <button id="show-signup" type="button">Create an account</button>';
  nextForm.classList.remove("auth-enter");
  requestAnimationFrame(() => nextForm.classList.add("auth-enter"));
  nextForm.addEventListener("animationend", () => nextForm.classList.remove("auth-enter"), { once: true });
}

function setSubmitBusy(button, busy, label) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  const text = button.querySelector("span:first-child");
  if (text) text.textContent = busy ? label : button.dataset.idleLabel;
}

function showAuthFeedback(message) {
  const feedback = $("#auth-feedback");
  feedback.textContent = message;
  feedback.hidden = !message;
}

document.addEventListener("click", (event) => {
  if (event.target.closest("#show-signup")) showSignup(true);
  if (event.target.closest("#show-login")) showSignup(false);
});

for (const provider of ["google", "paypal"]) {
  $(`#${provider}-signin`).addEventListener("click", (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.querySelector("span").textContent = `Opening ${provider === "google" ? "Google" : "PayPal"}…`;
    location.assign(`/api/auth/oauth/${provider}/start`);
  });
}

$("#demo-login").addEventListener("click", () => {
  $("#login-email").value = demoCredentials.email;
  $("#login-password").value = demoCredentials.password;
  $("#login-form").requestSubmit();
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = $("#login-error");
  error.hidden = true;
  setSubmitBusy(button, true, "Signing in…");
  try {
    await request("/api/auth/login", Object.fromEntries(new FormData(form)));
    location.assign(safeNext);
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    setSubmitBusy(button, false);
  }
});

$("#signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = $("#signup-error");
  error.hidden = true;
  setSubmitBusy(button, true, "Creating workspace…");
  try {
    await request("/api/auth/signup", Object.fromEntries(new FormData(form)));
    location.assign(safeNext);
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    setSubmitBusy(button, false);
  }
});

async function loadSignInOptions() {
  const response = await fetch("/api/auth/providers", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Sign-in settings are unavailable.");
  const options = await response.json();

  for (const provider of ["google", "paypal"]) {
    const button = $(`#${provider}-signin`);
    const configured = Boolean(options.providers?.[provider]?.enabled);
    button.disabled = !configured;
    $(`[data-provider-state="${provider}"]`).textContent = configured
      ? (provider === "paypal" ? (options.providers[provider].environment === "live" ? "Live" : "Sandbox") : "Ready")
      : "Set up required";
  }

  demoCredentials.enabled = Boolean(options.demo?.enabled);
  if (demoCredentials.enabled) {
    demoCredentials.email = options.demo.email;
    demoCredentials.password = options.demo.password;
    $("#demo-email").textContent = demoCredentials.email;
    $("#demo-password").textContent = demoCredentials.password;
    if ([defaultDemo.email, ""].includes($("#login-email").value)) $("#login-email").value = demoCredentials.email;
    if ([defaultDemo.password, ""].includes($("#login-password").value)) $("#login-password").value = demoCredentials.password;
  } else {
    $("#demo-access").hidden = true;
    if ($("#login-email").value === defaultDemo.email) $("#login-email").value = "";
    if ($("#login-password").value === defaultDemo.password) $("#login-password").value = "";
  }
}

async function loadMarkets() {
  const response = await fetch("/api/markets", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Market options could not load.");
  markets = await response.json();
  populateSelect($("#signup-country"), markets.countries, "code", (item) => `${item.name} · ${item.localCurrency}`);
  $("#signup-country").value = "US";
  updateSignupCurrencies("USD");
  updateMarketNote($("#signup-country"), $("#signup-currency"), $("#signup-market-note"));
  $("#signup-country").addEventListener("change", () => {
    const country = markets.countries.find((item) => item.code === $("#signup-country").value);
    const defaultCurrency = country?.defaultCheckoutCurrency;
    updateSignupCurrencies(defaultCurrency);
    updateMarketNote($("#signup-country"), $("#signup-currency"), $("#signup-market-note"));
  });
  $("#signup-currency").addEventListener("change", () => updateMarketNote($("#signup-country"), $("#signup-currency"), $("#signup-market-note")));
}

async function init() {
  const authError = new URLSearchParams(location.search).get("auth_error");
  if (authError === "social_signin_failed") showAuthFeedback("We couldn't finish provider sign-in. Try again, or use your email and password.");
  for (const button of document.querySelectorAll(".auth-submit")) {
    button.dataset.idleLabel = button.querySelector("span:first-child").textContent;
    button.setAttribute("aria-busy", "false");
  }
  try {
    await Promise.all([loadSignInOptions(), loadMarkets()]);
  } catch {
    $("#signup-error").textContent = "Some sign-in settings could not load. Refresh and try again.";
  }
}

init();
