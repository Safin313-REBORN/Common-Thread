"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  config: { aiMode: "local-rules", paymentMode: "local-demo", paypalClientId: "", currency: "USD" },
  account: null,
  csrfToken: "",
  markets: { countries: [], currencies: [] },
  needs: [],
  catalog: [],
  orders: [],
  requestEvents: new Map(),
  metrics: { needCount: 0, productCount: 0, orderCount: 0, capturedByCurrency: {}, capturedOrders: 0 },
  selectedNeedId: "pantry-quezon-city",
  activePlan: null,
  cart: [],
  activeIdempotencyKey: null,
  activeAppOrderId: null,
  paypalReady: false,
  paypalSdkLoading: false,
  paypalSdkCurrency: "",
  paypalInstance: null,
  paypalApprovalStarted: false,
  toastTimer: 0,
  agentTimer: 0,
  view: "builder",
  requestFilter: "all",
  activeReceipt: null,
  chatHistory: []
};

document.documentElement.classList.add("js-ready");

function money(cents) {
  const currency = state.config.currency || "USD";
  const market = state.markets.currencies.find((item) => item.code === currency);
  const rate = currency === "USD" ? 1 : state.config.fx?.rate;
  if (!Number.isFinite(rate)) return `${currency} —`;
  const digits = market?.minorDigits ?? 2;
  const minor = Math.round(((Number(cents) || 0) / 100) * rate * (10 ** digits));
  return formatMoneyMinor(minor, currency, digits);
}

function formatMoneyMinor(amount, currency, digits) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount) / (10 ** digits)); }
  catch { return `${currency} ${(Number(amount) / (10 ** digits)).toFixed(digits)}`; }
}

function moneyOrder(minor, currency) {
  const digits = state.markets.currencies.find((item) => item.code === currency)?.minorDigits ?? 2;
  return formatMoneyMinor(minor, currency, digits);
}

function minorDecimal(minor, currency) {
  const digits = state.markets.currencies.find((item) => item.code === currency)?.minorDigits ?? 2;
  return (Number(minor) / (10 ** digits)).toFixed(digits);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function api(url, options = {}) {
  const method = options.method || "GET";
  const headers = options.body ? { "Content-Type": "application/json" } : {};
  if (method !== "GET" && method !== "HEAD" && state.csrfToken) headers["X-CT-CSRF"] = state.csrfToken;
  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/api/auth/")) location.assign(`/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`);
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function setFormError(message = "") {
  const element = $("#form-error");
  element.textContent = message;
  element.hidden = !message;
}

function setCheckoutError(message = "") {
  const element = $("#checkout-error");
  element.textContent = message;
  element.hidden = !message;
}

function setModeLabels() {
  const isPaypal = state.config.paymentMode === "paypal-sandbox";
  const isGemini = state.config.aiMode === "gemini";
  const isDemo = Boolean(state.account?.user?.isDemo);
  $("#mode-label").textContent = isPaypal ? `PayPal sandbox · ${state.config.currency}` : `Local only · ${state.config.currency}`;
  $("#mode-label").title = isPaypal ? "PayPal sandbox checkout is configured. Test funds only." : "PayPal sandbox credentials are not configured. Local order records send no payment.";
  $("#ai-mode-label").textContent = isGemini ? "Gemini configured" : "Guided help";
  $("#payment-mode-label").textContent = isPaypal ? "PayPal sandbox" : "Local records · no payment sent";
  $("#hero-proof-copy").textContent = isPaypal
    ? `Reviewed request · ${state.config.currency} checkout · sandbox funds`
    : "Reviewed request · catalog priced · no-charge record";
  $("#kit-total-label").textContent = isPaypal ? "PayPal order total" : "Kit total";
  $("#merchant-note-copy").innerHTML = isPaypal
    ? "One itemized PayPal order<br><strong>Server verifies capture before saving</strong>"
    : "One itemized record<br><strong>No payment is sent</strong>";
  $("#checkout-caption").textContent = isPaypal
    ? `Sandbox payment only. Reference rate ${state.config.fx?.date || "unavailable"}; PayPal may apply its own conversion and fees. No goods ship.`
    : `No payment credentials are connected. Save a no-charge ${state.config.currency} local record.`;
  if (state.config.fx?.stale) $("#checkout-caption").textContent += " The saved reference rate is stale.";
  if (state.config.fxError) $("#checkout-caption").textContent = state.config.fxError;
  $("#assistant-mode").textContent = state.config.assistantMode === "gemini" ? "Personal workspace support · Gemini" : "Personal workspace support · guided answers";
  $("#local-checkout").hidden = isPaypal || isDemo;
  $("#paypal-button-container").hidden = !isPaypal || isDemo;
  if (isDemo) $("#checkout-caption").textContent = "Read-only demo. Build and inspect a plan; use a personal account to save an order.";
  $(".connection-light").classList.toggle("is-local", !isPaypal);
}

function showView(view) {
  const allowed = new Set(["builder", "requests", "orders", "how", "account"]);
  const next = allowed.has(view) ? view : "builder";
  state.view = next;
  $$(".page-view").forEach((section) => {
    const visible = section.id === `view-${next}`;
    section.classList.toggle("is-visible", visible);
    section.hidden = !visible;
  });
  $$(".nav-item").forEach((button) => {
    const current = button.dataset.view === next;
    button.classList.toggle("is-active", current);
    if (current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.body.classList.remove("nav-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  $("#menu-toggle").setAttribute("aria-label", "Open navigation");
  $("#mobile-menu-scrim").hidden = true;
  history.replaceState(null, "", next === "builder" ? "#builder" : `#${next}`);
  window.scrollTo({ left: 0, top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  observeReveals();
}

function selectNeed(needId, updatePrompt = true) {
  const need = state.needs.find((entry) => entry.id === needId);
  if (!need) return;
  state.selectedNeedId = need.id;
  $$("[data-need-id]").forEach((button) => {
    const selected = button.dataset.needId === need.id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (updatePrompt) $("#kit-intent").value = need.suggestedPrompt;
  $("#kit-budget").value = (need.defaultBudgetCents / 100).toFixed(2);
  setBudgetPreset(need.defaultBudgetCents);
  updateIntentCount();
  invalidatePlan("Need changed. Rebuild the kit to match this request.");
}

function setBudgetPreset(cents) {
  $$('[data-budget]').forEach((button) => {
    const selected = Number(button.dataset.budget) === cents;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderNeedOptions() {
  const container = $("#need-options");
  const readyNeeds = state.needs.filter((need) => need.status === "ready");
  if (!readyNeeds.length) {
    container.innerHTML = '<div class="need-empty"><strong>No requests are ready for planning.</strong><span>Review or add a request in the request desk first.</span><button class="text-link" type="button" data-view="requests">Open request desk <svg aria-hidden="true"><use href="#icon-arrow-up-right"/></svg></button></div>';
    return;
  }
  if (!readyNeeds.some((need) => need.id === state.selectedNeedId)) state.selectedNeedId = readyNeeds[0].id;
  container.innerHTML = readyNeeds.map((need) => `
    <button class="need-choice${need.id === state.selectedNeedId ? " is-selected" : ""}" type="button" data-need-id="${escapeHTML(need.id)}" aria-pressed="${need.id === state.selectedNeedId}">
      <span class="need-radio" aria-hidden="true"></span>
      <span class="need-choice-copy"><span class="need-choice-title">${escapeHTML(need.title)}</span><span class="need-choice-meta">${escapeHTML(need.location)}</span></span>
      <span class="need-category">${escapeHTML(need.category)}</span>
    </button>`).join("");
  $$("[data-need-id]", container).forEach((button) => button.addEventListener("click", () => selectNeed(button.dataset.needId)));
}

function requestStatusLabel(status) {
  return ({ review: "Needs review", ready: "Ready to plan", closed: "Closed" })[status] || "Needs review";
}

function renderRequestSummary() {
  const counts = {
    review: state.needs.filter((need) => need.status === "review").length,
    ready: state.needs.filter((need) => need.status === "ready").length,
    closed: state.needs.filter((need) => need.status === "closed").length
  };
  $("#request-summary").innerHTML = `
    <div class="request-stat is-review"><span>Needs review</span><strong>${counts.review}</strong><small>Awaiting an organizer decision</small></div>
    <div class="request-stat is-ready"><span>Ready to plan</span><strong>${counts.ready}</strong><small>Eligible for a procurement plan</small></div>
    <div class="request-stat"><span>Closed</span><strong>${counts.closed}</strong><small>Not currently accepting a plan</small></div>`;
  $("#nav-request-count").textContent = String(counts.review);
  $("#review-filter-count").textContent = String(counts.review);
  $("#ready-filter-count").textContent = String(counts.ready);
  $("#review-count").textContent = String(counts.review);
  $("#ready-count").textContent = String(counts.ready);
}

function renderRequestEvent(event) {
  const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(event.createdAt));
  const transition = event.type === "request.status-changed" && event.details?.from && event.details?.to
    ? `${requestStatusLabel(event.details.from)} → ${requestStatusLabel(event.details.to)}`
    : event.details?.starter ? "Illustrative starter request added" : "Request added to the workspace";
  return `<li><span class="request-event-dot"></span><div><strong>${escapeHTML(transition)}</strong><small>${escapeHTML(event.actor || "Workspace operator")} · ${escapeHTML(date)}</small></div></li>`;
}

function renderRequests() {
  renderRequestSummary();
  const list = $("#request-list");
  const requests = state.requestFilter === "all" ? state.needs : state.needs.filter((need) => need.status === state.requestFilter);
  $("#request-empty").hidden = requests.length > 0;
  list.hidden = requests.length === 0;
  list.innerHTML = requests.map((need) => {
    const events = state.requestEvents.get(need.id) || [];
    const nextActions = state.account?.user?.isDemo
      ? (need.status === "ready"
        ? `<button class="button button-primary" type="button" data-plan-request="${escapeHTML(need.id)}">Build procurement plan <svg aria-hidden="true"><use href="#icon-arrow"/></svg></button>`
        : `<span class="demo-action-note">Sample request · view only</span>`)
      : need.status === "review"
      ? `<button class="button button-primary" type="button" data-request-action="ready" data-request-id="${escapeHTML(need.id)}">Mark ready</button><button class="request-text-action" type="button" data-request-action="closed" data-request-id="${escapeHTML(need.id)}">Close request</button>`
      : need.status === "ready"
        ? `<button class="button button-primary" type="button" data-plan-request="${escapeHTML(need.id)}">Build procurement plan <svg aria-hidden="true"><use href="#icon-arrow"/></svg></button><button class="request-text-action" type="button" data-request-action="closed" data-request-id="${escapeHTML(need.id)}">Close request</button>`
        : `<button class="button button-outline" type="button" data-request-action="ready" data-request-id="${escapeHTML(need.id)}">Reopen as ready</button><button class="request-text-action" type="button" data-request-action="review" data-request-id="${escapeHTML(need.id)}">Return to review</button>`;
    return `<article class="request-card">
      <div class="request-card-top"><span class="request-category">${escapeHTML(need.category)}</span><span class="request-status is-${escapeHTML(need.status)}">${requestStatusLabel(need.status)}</span></div>
      <div class="request-card-body"><div><h2>${escapeHTML(need.title)}</h2><p class="request-location">${escapeHTML(need.location)}</p><p class="request-description">${escapeHTML(need.summary)}</p></div><div class="request-cap"><small>Planning cap · USD reference</small><strong>${money(need.defaultBudgetCents)}</strong><span>${escapeHTML(state.config.currency)}</span></div></div>
      <div class="request-card-actions">${nextActions}</div>
      <details class="request-activity" data-request-events-id="${escapeHTML(need.id)}"><summary>Activity record <span>${events.length || "View"}</span><svg aria-hidden="true"><use href="#icon-chevron"/></svg></summary><ol>${events.length ? events.map(renderRequestEvent).join("") : "<li class='request-event-loading'>Open to load the saved request timeline.</li>"}</ol></details>
    </article>`;
  }).join("");
}

async function loadRequestEvents(details) {
  const needId = details.dataset.requestEventsId;
  if (!needId || state.requestEvents.has(needId)) return;
  const list = $("ol", details);
  try {
    const payload = await api(`/api/needs/${encodeURIComponent(needId)}/events`);
    state.requestEvents.set(needId, payload.events);
    list.innerHTML = payload.events.length ? payload.events.map(renderRequestEvent).join("") : "<li class='request-event-loading'>No activity recorded yet.</li>";
    $("summary span", details).textContent = String(payload.events.length);
  } catch {
    list.innerHTML = "<li class='request-event-loading'>Activity record could not be loaded. Try again.</li>";
  }
}

function setRequestFormVisible(visible) {
  const form = $("#request-form");
  form.hidden = !visible;
  if (visible) {
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    $("input[name=title]", form).focus({ preventScroll: true });
  }
}

async function submitRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const error = $("#request-error");
  const submit = form.querySelector('button[type="submit"]');
  const budget = Number(values.get("budgetCents"));
  if (!Number.isFinite(budget) || budget < 5 || budget > 1000) {
    error.textContent = "Set a planning cap from $5 to $1,000 USD.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = "Saving request…";
  try {
    const payload = await api("/api/needs", { method: "POST", body: {
      title: values.get("title"), category: values.get("category"), location: values.get("location"),
      summary: values.get("summary"), budgetCents: Math.round(budget * 100)
    } });
    state.needs.unshift(payload.need);
    state.requestEvents.set(payload.need.id, payload.events);
    state.metrics = (await api("/api/board")).metrics;
    form.reset();
    setRequestFormVisible(false);
    state.requestFilter = "review";
    setRequestFilterButtons();
    renderRequests();
    renderNeedOptions();
    showToast("Request saved for organizer review.");
  } catch (requestError) {
    error.textContent = requestError.message || "The request could not be saved.";
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Save for review <svg aria-hidden="true"><use href="#icon-arrow"/></svg>';
  }
}

function setRequestFilterButtons() {
  $$("[data-request-filter]").forEach((button) => {
    const active = button.dataset.requestFilter === state.requestFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function updateRequestStatus(needId, status) {
  const action = document.querySelector(`[data-request-id="${CSS.escape(needId)}"][data-request-action="${CSS.escape(status)}"]`);
  if (action) action.disabled = true;
  try {
    const payload = await api(`/api/needs/${encodeURIComponent(needId)}/status`, { method: "PATCH", body: { status } });
    state.needs = state.needs.map((need) => need.id === needId ? payload.need : need);
    state.requestEvents.set(needId, payload.events);
    state.metrics = (await api("/api/board")).metrics;
    if (state.selectedNeedId === needId && status !== "ready") invalidatePlan("Request status changed. Choose a Ready request to build a new plan.");
    renderRequests();
    renderNeedOptions();
    showToast(`Request moved to ${requestStatusLabel(status).toLowerCase()}.`);
  } catch (error) {
    showToast(error.message || "The request status could not be changed.");
    if (action) action.disabled = false;
  }
}

function selectedConstraints() {
  return {
    diet: $("#diet-preference").value,
    avoidAllergens: $$('input[name="allergen"]:checked').map((input) => input.value)
  };
}

function currentBudgetCents() {
  const value = Number($("#kit-budget").value);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function updateIntentCount() {
  $("#intent-count").textContent = `${$("#kit-intent").value.length} / 600`;
}

function setAgentState(mode, message, stepIndex = 0) {
  const rail = $(".agent-rail");
  rail.classList.toggle("is-working", mode === "working");
  $("#agent-status-text").textContent = message || (mode === "working" ? "BUILDING KIT" : mode === "ready" ? "READY TO PLAN" : "KIT READY");
  const steps = $$(".agent-step");
  if (mode === "working") {
    steps.forEach((step, index) => {
      step.classList.toggle("is-current", index === stepIndex);
      step.classList.toggle("is-done", index < stepIndex);
    });
  } else if (mode === "complete") {
    steps.forEach((step) => { step.classList.remove("is-current"); step.classList.add("is-done"); });
  } else {
    steps.forEach((step, index) => {
      step.classList.toggle("is-current", index === 0);
      step.classList.remove("is-done");
    });
  }
}

function productIcon(key) {
  const supported = new Set(["grain", "bottle", "can", "jar", "soap", "book", "pencil", "bag", "lamp", "bulb", "cord", "tools"]);
  const icon = supported.has(key) ? key : "box";
  return `<svg aria-hidden="true"><use href="#icon-${icon}"/></svg>`;
}

async function buildKit(event) {
  event.preventDefault();
  const intent = $("#kit-intent").value.trim();
  const budgetCents = currentBudgetCents();
  if (!state.selectedNeedId) { setFormError("Choose a community need first."); return; }
  if (intent.length < 12) { setFormError("Describe the kit in at least 12 characters."); $("#kit-intent").focus(); return; }
  if (!Number.isInteger(budgetCents) || budgetCents < 500 || budgetCents > 100000) { setFormError("Choose a budget from $5 to $1,000 USD."); $("#kit-budget").focus(); return; }
  setFormError("");
  invalidatePlan("");
  const progressLabels = ["READING YOUR NEED", "MATCHING CATALOG", "CHECKING THE KIT"];
  let progressStep = 0;
  setAgentState("working", progressLabels[progressStep], progressStep);
  window.clearInterval(state.agentTimer);
  state.agentTimer = window.setInterval(() => {
    progressStep = Math.min(progressStep + 1, progressLabels.length - 1);
    setAgentState("working", progressLabels[progressStep], progressStep);
  }, 850);
  const button = $("#build-kit");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector("span").textContent = state.config.aiMode === "gemini" ? "Preparing plan…" : "Checking the catalog…";
  try {
    const plan = await api("/api/agent/kit", {
      method: "POST",
      body: { needId: state.selectedNeedId, intent, budgetCents, constraints: selectedConstraints() }
    });
    state.activePlan = plan;
    state.cart = plan.items.map((item) => ({ ...item }));
    state.activeIdempotencyKey = null;
    state.activeAppOrderId = null;
    setAgentState("complete", plan.source === "gemini" ? "KIT READY · GEMINI" : plan.source === "local-fallback" ? "KIT READY · LOCAL FALLBACK" : "KIT READY · LOCAL");
    renderKit();
    $("#kit-review").hidden = false;
    window.setTimeout(() => $("#kit-review").scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  } catch (error) {
    setAgentState("ready");
    setFormError(error.message);
  } finally {
    window.clearInterval(state.agentTimer);
    state.agentTimer = 0;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.querySelector("span").textContent = "Build procurement plan";
  }
}

function invalidatePlan(message) {
  if (!state.activePlan) return;
  discardCheckoutAttempt();
  state.activePlan = null;
  state.cart = [];
  $("#kit-review").hidden = true;
  destroyPayPalButton();
  if (message) showToast(message);
}

function discardCheckoutAttempt() {
  const appOrderId = state.activeAppOrderId;
  if (appOrderId) {
    api(`/api/orders/${encodeURIComponent(appOrderId)}/cancel`, { method: "POST", body: {} }).catch(() => {});
  }
  state.activeIdempotencyKey = null;
  state.activeAppOrderId = null;
  state.paypalApprovalStarted = false;
}

function cartSubtotal() {
  return state.cart.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}

function cartIssues() {
  const issues = [];
  if (!state.cart.length) issues.push("Add at least one available catalog item.");
  if (state.config.currency !== "USD" && !state.config.fx) issues.push(state.config.fxError || "A current currency rate is unavailable. Switch to USD before checkout.");
  if (cartSubtotal() > currentBudgetCents()) issues.push("Your kit is over budget. Remove an item or lower a quantity.");
  const constraints = selectedConstraints();
  for (const item of state.cart) {
    if (item.availableStock < item.quantity) issues.push(`${item.name} exceeds current catalog availability.`);
    if (item.allergens.some((allergen) => constraints.avoidAllergens.includes(allergen))) issues.push(`${item.name} conflicts with an allergen restriction.`);
    if (constraints.diet === "vegetarian" && item.tags.includes("meat")) issues.push(`${item.name} conflicts with the vegetarian preference.`);
    if (constraints.diet === "vegan" && item.tags.includes("animal-derived")) issues.push(`${item.name} conflicts with the vegan preference.`);
  }
  return [...new Set(issues)];
}

function renderKit() {
  const plan = state.activePlan;
  if (!plan) return;
  const need = state.needs.find((entry) => entry.id === state.selectedNeedId);
  $("#kit-source").textContent = plan.source === "gemini" ? "Gemini recommendation · review required" : plan.source === "local-fallback" ? "Gemini unavailable · local rules used" : "Local planning rules";
  $("#kit-source").classList.toggle("is-ai", plan.source === "gemini");
  $("#kit-summary").textContent = plan.summary;
  $("#order-need-name").textContent = need ? `${need.title} · ${need.location}` : "Community need";
  const recentOrder = need && state.orders.find((order) => {
    if (order.needId !== need.id || !["captured-sandbox", "awaiting-approval", "local-demo"].includes(order.status)) return false;
    return Date.now() - new Date(order.createdAt).getTime() < 72 * 60 * 60 * 1000;
  });
  $("#duplicate-warning").hidden = !recentOrder;
  $("#kit-item-count").textContent = `${state.cart.length} ${state.cart.length === 1 ? "item" : "items"}`;
  $("#kit-lines").innerHTML = state.cart.length ? state.cart.map((item) => `
    <article class="kit-line" data-product-id="${escapeHTML(item.id)}">
      <span class="product-glyph">${productIcon(item.iconKey)}</span>
      <div class="kit-line-copy"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.sku)} · ${escapeHTML(item.unitLabel)} · ${money(item.unitPriceCents)} each</span><small>${escapeHTML(item.reason || "Catalog item · server checked")}</small></div>
      <div class="kit-line-actions">
        <div class="quantity-control" aria-label="Quantity for ${escapeHTML(item.name)}"><button type="button" data-cart-action="minus" data-product-id="${escapeHTML(item.id)}" aria-label="Remove one ${escapeHTML(item.name)}" ${item.quantity <= 1 ? "disabled" : ""}><svg aria-hidden="true"><use href="#icon-minus"/></svg></button><strong>${item.quantity}</strong><button type="button" data-cart-action="plus" data-product-id="${escapeHTML(item.id)}" aria-label="Add one ${escapeHTML(item.name)}" ${item.quantity >= item.availableStock ? "disabled" : ""}><svg aria-hidden="true"><use href="#icon-plus"/></svg></button></div>
        <div class="kit-line-price"><strong>${money(item.unitPriceCents * item.quantity)}</strong><small>${item.quantity} × ${money(item.unitPriceCents)}</small></div>
        <button class="remove-item" type="button" data-cart-action="remove" data-product-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.name)}"><svg aria-hidden="true"><use href="#icon-close"/></svg></button>
      </div>
    </article>`).join("") : '<div class="loading-row">Your basket is empty. Add a catalog item below.</div>';
  const subtotal = cartSubtotal();
  const budget = currentBudgetCents();
  const remaining = Math.max(0, budget - subtotal);
  $("#kit-subtotal").textContent = money(subtotal);
  $("#kit-budget-cap").textContent = money(budget);
  $("#kit-total").textContent = money(subtotal);
  $("#budget-remaining").textContent = subtotal > budget ? `${money(subtotal - budget)} over budget` : `${money(remaining)} remaining in budget`;
  $("#budget-meter-fill").style.width = `${budget > 0 ? Math.min(100, subtotal / budget * 100) : 0}%`;
  $("#budget-meter-fill").style.background = subtotal > budget ? "var(--danger)" : "var(--signal)";
  const issues = cartIssues();
  const validation = $("#kit-validation");
  validation.classList.toggle("is-error", issues.length > 0);
  validation.innerHTML = `<svg aria-hidden="true"><use href="#icon-${issues.length ? "close" : "shield"}"/></svg><span>${escapeHTML(issues[0] || "Server will recheck product IDs, current prices, stock, restrictions, and budget before checkout.")}</span>`;
  $("#local-checkout").disabled = issues.length > 0;
  $("#paypal-button-container").hidden = state.config.paymentMode !== "paypal-sandbox" || issues.length > 0;
  $("#add-catalog-product").innerHTML = `<option value="">${state.cart.length >= 12 ? "12 item limit reached" : "Choose a product"}</option>${availableCatalogAdditions().map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${money(item.unitPriceCents)}</option>`).join("")}`;
  $("#add-catalog-product").disabled = state.cart.length >= 12;
  $("#add-catalog-item").disabled = state.cart.length >= 12;
  setCheckoutError("");
  destroyPayPalButton();
  if (state.config.paymentMode === "paypal-sandbox" && !issues.length) renderPayPalButtons();
}

function availableCatalogAdditions() {
  const selected = new Set(state.cart.map((item) => item.id));
  const constraints = selectedConstraints();
  return state.catalog.filter((product) => {
    if (selected.has(product.id) || product.availableStock < 1) return false;
    if (product.allergens.some((allergen) => constraints.avoidAllergens.includes(allergen))) return false;
    if (constraints.diet === "vegetarian" && product.tags.includes("meat")) return false;
    if (constraints.diet === "vegan" && product.tags.includes("animal-derived")) return false;
    return true;
  });
}

function editCart(action, productId) {
  const item = state.cart.find((entry) => entry.id === productId);
  if (!item) return;
  if (action === "remove") {
    state.cart = state.cart.filter((entry) => entry.id !== productId);
  } else if (action === "plus") {
    if (item.quantity >= item.availableStock) { showToast("That is the recorded availability for this item."); return; }
    if (cartSubtotal() + item.unitPriceCents > currentBudgetCents()) { showToast("That quantity would exceed the kit budget."); return; }
    item.quantity += 1;
  } else if (action === "minus" && item.quantity > 1) {
    item.quantity -= 1;
  }
  discardCheckoutAttempt();
  renderKit();
}

function addCatalogItem() {
  if (state.cart.length >= 12) { showToast("A kit can include up to 12 catalog items."); return; }
  const productId = $("#add-catalog-product").value;
  const product = availableCatalogAdditions().find((entry) => entry.id === productId);
  if (!product) { showToast("Choose an available catalog product first."); return; }
  if (cartSubtotal() + product.unitPriceCents > currentBudgetCents()) { showToast("That item would exceed the kit budget."); return; }
  state.cart.push({ ...product, quantity: 1, lineTotalCents: product.unitPriceCents, reason: "Added by the supporter." });
  discardCheckoutAttempt();
  renderKit();
}

function orderRequestBody() {
  return {
    needId: state.selectedNeedId,
    agentRunId: state.activePlan.id,
    intent: state.activePlan.intent,
    budgetCents: currentBudgetCents(),
    constraints: selectedConstraints(),
    items: state.cart.map((item) => ({ productId: item.id, quantity: item.quantity, reason: item.reason })),
    idempotencyKey: state.activeIdempotencyKey ||= crypto.randomUUID()
  };
}

function renderOrderMetrics(metrics) {
  const summary = metrics || state.metrics;
  const capturedValues = Object.entries(summary.capturedByCurrency || {}).map(([currency, amount]) => moneyOrder(amount, currency));
  $("#order-metrics").innerHTML = `
    <div class="order-metric"><span>Saved order records</span><strong>${summary.orderCount}</strong></div>
    <div class="order-metric"><span>PayPal sandbox captures</span><strong>${summary.capturedOrders}</strong></div>
    <div class="order-metric"><span>Captured value by currency</span><strong>${capturedValues.length ? capturedValues.map(escapeHTML).join(" · ") : "—"}</strong></div>`;
}

function statusPresentation(status) {
  if (status === "captured-sandbox") return { label: "PayPal sandbox capture", className: "is-captured" };
  if (status === "local-demo") return { label: "Local record · no charge", className: "is-local" };
  if (status === "awaiting-approval") return { label: "Awaiting PayPal approval", className: "" };
  if (status === "cancelled") return { label: "Cancelled", className: "" };
  if (status === "failed") return { label: "Checkout failed", className: "" };
  return { label: "Preparing checkout", className: "" };
}

function auditEventLabel(type) {
  return ({
    "order.local-demo": "No-charge order record saved",
    "order.reserved": "Catalog quantities reserved",
    "paypal.order-created": "PayPal sandbox checkout created",
    "paypal.order-failed": "PayPal sandbox checkout failed",
    "order.cancelled": "Checkout cancelled",
    "paypal.capture-completed": "PayPal sandbox capture verified"
  })[type] || String(type || "Activity").replace(/[.-]/g, " ");
}

function renderOrders(orders = state.orders, metrics = state.metrics) {
  state.orders = orders;
  state.metrics = metrics;
  $("#nav-order-count").textContent = String(orders.length);
  renderOrderMetrics(metrics);
  $("#orders-empty").hidden = orders.length > 0;
  $("#orders-list").hidden = !orders.length;
  $("#orders-list").innerHTML = orders.map((order) => {
    const status = statusPresentation(order.status);
    const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(order.createdAt));
    const names = order.items.map((item) => `<span class="order-history-item">${escapeHTML(item.name)} × ${item.quantity}</span>`).join("");
    return `<article class="order-history-card"><div class="order-history-head"><div><h2>${escapeHTML(order.needTitle)}</h2><p>${escapeHTML(order.needLocation)} · ${date} · Ref ${escapeHTML(order.id.slice(0, 8).toUpperCase())}</p></div><span class="order-status ${status.className}">${status.label}</span></div><div class="order-history-items">${names}</div><div class="order-history-foot"><span>${order.paypalCaptureId ? `Capture ${escapeHTML(order.paypalCaptureId)}` : order.status === "local-demo" ? "No payment sent" : "Payment state recorded"}</span><strong>${moneyOrder(order.subtotalCents, order.currency)}</strong><button type="button" data-view-order="${escapeHTML(order.id)}">View record</button></div>${order.fxRateDate ? `<small class="order-fx-note">${escapeHTML(order.currency)} reference rate saved ${escapeHTML(order.fxRateDate)} · ${Number(order.fxRate).toFixed(5)} per USD</small>` : ""}</article>`;
  }).join("");
  $("#export-ledger").disabled = orders.length === 0;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\t\r]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportOrderLedger(orders = state.orders) {
  if (!orders.length) { showToast("There are no payment records to export yet."); return; }
  const rows = [["Created at", "Order reference", "Request", "Location", "Payment state", "Currency", "SKU", "Item", "Quantity", "Unit amount", "Line amount", "PayPal capture reference"]];
  for (const order of orders) {
    for (const item of order.items) rows.push([
      order.createdAt, order.id, order.needTitle, order.needLocation, order.status, order.currency,
      item.sku, item.name, item.quantity, minorDecimal(item.unitPriceCents, order.currency), minorDecimal(item.lineTotalCents, order.currency), order.paypalCaptureId || ""
    ]);
  }
  downloadCsv(`commonthread-payment-records-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  showToast("Itemized payment statement downloaded.");
}

function showReceipt(order) {
  if (!order) return;
  state.activeReceipt = order;
  const captured = order.status === "captured-sandbox";
  const messages = {
    "captured-sandbox": ["Sandbox capture recorded.", "PayPal confirmed this test capture. No real money moved and no goods ship."],
    "local-demo": ["Order record saved.", "This local record is stored in SQLite. No payment was sent."],
    "awaiting-approval": ["Waiting for approval.", "The order is waiting for buyer approval in PayPal sandbox. No capture is recorded yet."],
    cancelled: ["Checkout was cancelled.", "The sandbox checkout was cancelled. No capture was recorded."],
    failed: ["Checkout could not be completed.", "PayPal did not create a checkout that the buyer could approve."]
  };
  const status = statusPresentation(order.status);
  const [title, subtitle] = messages[order.status] || ["Order status", "Review the saved order details below."];
  $("#receipt-title").textContent = title;
  $("#receipt-subtitle").textContent = subtitle;
  $("#receipt-id").textContent = order.id.toUpperCase();
  $("#receipt-lines").innerHTML = order.items.map((item) => `<div class="receipt-line"><span>${escapeHTML(item.name)} <small>× ${item.quantity}</small></span><strong>${moneyOrder(item.lineTotalCents, order.currency)}</strong></div>`).join("");
  $("#receipt-total").textContent = moneyOrder(order.subtotalCents, order.currency);
  $("#receipt-status").textContent = order.paypalCaptureId ? `${status.label} · Capture ID ${order.paypalCaptureId}` : status.label;
  $("#receipt-status").classList.toggle("is-not-captured", !captured);
  $("#receipt-audit-list").innerHTML = '<li class="request-event-loading">Loading saved activity…</li>';
  $("#receipt-dialog").showModal();
  api(`/api/orders/${encodeURIComponent(order.id)}`).then((payload) => {
    const events = payload.audit || [];
    $("#receipt-audit-list").innerHTML = events.length ? events.map((event) => {
      const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(event.createdAt));
      return `<li><span class="request-event-dot"></span><div><strong>${escapeHTML(auditEventLabel(event.type))}</strong><small>${escapeHTML(date)}</small></div></li>`;
    }).join("") : '<li class="request-event-loading">No activity recorded.</li>';
  }).catch(() => { $("#receipt-audit-list").innerHTML = '<li class="request-event-loading">Activity record could not be loaded.</li>'; });
}

function exportReceipt() {
  const order = state.activeReceipt;
  if (!order) return;
  const rows = [["Order reference", "Payment state", "Request", "Location", "Currency", "SKU", "Item", "Unit", "Quantity", "Unit amount", "Line amount", "Capture reference"]];
  for (const item of order.items) rows.push([order.id, order.status, order.needTitle, order.needLocation, order.currency, item.sku, item.name, item.unitLabel, item.quantity, minorDecimal(item.unitPriceCents, order.currency), minorDecimal(item.lineTotalCents, order.currency), order.paypalCaptureId || ""]);
  downloadCsv(`commonthread-order-${order.id.slice(0, 8)}.csv`, rows);
}

async function saveLocalOrder() {
  if (!state.activePlan) return;
  const issues = cartIssues();
  if (issues.length) { setCheckoutError(issues[0]); return; }
  const button = $("#local-checkout");
  button.disabled = true;
  button.querySelector("span").textContent = "Saving record…";
  setCheckoutError("");
  try {
    const result = await api("/api/local-orders", { method: "POST", body: orderRequestBody() });
    const payload = await api("/api/orders");
    renderOrders(payload.orders, payload.metrics);
    showReceipt(result.order);
    state.activeIdempotencyKey = null;
    state.activeAppOrderId = null;
    showToast("No-charge record saved. No money moved.");
  } catch (error) {
    setCheckoutError(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Save no-charge record";
  }
}

function destroyPayPalButton() {
  const container = $("#paypal-button-container");
  const previous = state.paypalInstance;
  state.paypalInstance = null;
  container.replaceChildren();
  container.dataset.rendered = "false";
  if (previous && typeof previous.close === "function") {
    try { Promise.resolve(previous.close()).catch(() => {}); } catch { /* A removed checkout can finish closing asynchronously. */ }
  }
}

function renderPayPalButtons() {
  const container = $("#paypal-button-container");
  if (state.account?.user?.isDemo || !state.paypalReady || !state.activePlan || !state.cart.length || state.config.paymentMode !== "paypal-sandbox" || cartIssues().length) return;
  if (container.dataset.rendered === "true") return;
  container.hidden = false;
  container.dataset.rendered = "true";
  const instance = window.paypal.Buttons({
    style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 44 },
    createOrder: async () => {
      setCheckoutError("");
      try {
        state.paypalApprovalStarted = false;
        const result = await api("/api/orders", { method: "POST", body: orderRequestBody() });
        state.activeAppOrderId = result.appOrderId;
        return result.id;
      } catch (error) {
        state.activeIdempotencyKey = null;
        state.activeAppOrderId = null;
        throw error;
      }
    },
    onApprove: async () => {
      if (!state.activeAppOrderId) { setCheckoutError("The saved order reference is missing. Rebuild the kit before checking out."); return; }
      state.paypalApprovalStarted = true;
      setCheckoutError("");
      try {
        const result = await api(`/api/orders/${encodeURIComponent(state.activeAppOrderId)}/capture`, { method: "POST", body: {} });
        const orders = await api("/api/orders");
        renderOrders(orders.orders, orders.metrics);
        showReceipt(result.order);
        state.activeIdempotencyKey = null;
        state.activeAppOrderId = null;
        state.paypalApprovalStarted = false;
        showToast("PayPal sandbox capture saved to order history.");
      } catch (error) {
        setCheckoutError(error.message);
      }
    },
    onCancel: async () => {
      if (state.activeAppOrderId) {
        try { await api(`/api/orders/${encodeURIComponent(state.activeAppOrderId)}/cancel`, { method: "POST", body: {} }); } catch { /* Reservation expires after fifteen minutes. */ }
      }
      state.activeIdempotencyKey = null;
      state.activeAppOrderId = null;
      state.paypalApprovalStarted = false;
      setCheckoutError("Checkout was cancelled. No capture was recorded.");
    },
    onError: (error) => {
      if (!state.paypalApprovalStarted) discardCheckoutAttempt();
      setCheckoutError(error?.message || "PayPal checkout could not complete. Review the kit and try again.");
    }
  });
  state.paypalInstance = instance;
  instance.render("#paypal-button-container").catch((error) => {
    container.dataset.rendered = "false";
    container.replaceChildren();
    state.paypalInstance = null;
    discardCheckoutAttempt();
    setCheckoutError(error?.message || "The PayPal sandbox button could not be displayed.");
  });
}

function loadPayPalSdk() {
  if (state.account?.user?.isDemo || state.config.paymentMode !== "paypal-sandbox" || !state.config.paypalClientId) return;
  const currency = state.config.currency;
  if (state.paypalReady && state.paypalSdkCurrency === currency) return;
  if (state.paypalSdkLoading && state.paypalSdkCurrency === currency) return;
  if (state.paypalReady && state.paypalSdkCurrency !== currency) {
    setCheckoutError("Your checkout currency changed. Reload this page before creating a PayPal order.");
    return;
  }
  const existingScript = $("#paypal-sdk");
  if (existingScript && existingScript.dataset.currency !== currency) {
    setCheckoutError("PayPal is still loading for another currency. Reload this page before checkout.");
    return;
  }
  if (existingScript) return;
  const script = document.createElement("script");
  script.id = "paypal-sdk";
  script.dataset.currency = currency;
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.config.paypalClientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
  script.async = true;
  state.paypalSdkLoading = true;
  state.paypalSdkCurrency = currency;
  script.onload = () => {
    state.paypalSdkLoading = false;
    if (state.config.currency !== currency) {
      setCheckoutError("Your checkout currency changed while PayPal was loading. Reload this page before checkout.");
      return;
    }
    if (!window.paypal?.Buttons) {
      state.paypalSdkCurrency = "";
      script.remove();
      setCheckoutError("PayPal's sandbox button could not initialize. Check the sandbox app credentials.");
      return;
    }
    state.paypalReady = true;
    renderPayPalButtons();
  };
  script.onerror = () => {
    state.paypalSdkLoading = false;
    state.paypalSdkCurrency = "";
    script.remove();
    setCheckoutError("PayPal's checkout script could not load. Check the network connection and sandbox client ID.");
  };
  document.head.append(script);
}

async function loadOrders() {
  try {
    const result = await api("/api/orders");
    renderOrders(result.orders, result.metrics);
  } catch (error) {
    showToast(`Order history could not load: ${error.message}`);
  }
}

function setupTaglineReveal() {
  const tagline = $("#tagline-text");
  const lines = ["From a written need", "to an order you can inspect."];
  const fragment = document.createDocumentFragment();
  let wordIndex = 0;
  lines.forEach((line, lineIndex) => {
    for (const word of line.split(/\s+/)) {
      const span = document.createElement("span");
      span.className = "tag-word";
      span.textContent = word;
      span.style.transitionDelay = `${Math.min(wordIndex * 35, 315)}ms`;
      fragment.append(span);
      wordIndex += 1;
    }
    if (lineIndex < lines.length - 1) fragment.append(document.createElement("br"));
  });
  tagline.replaceChildren(fragment);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    $$(".tag-word", tagline).forEach((word) => word.classList.add("is-active"));
    return;
  }
  const wordObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-active");
      wordObserver.unobserve(entry.target);
    }
  }, { threshold: 0.55, rootMargin: "0px 0px -12% 0px" });
  $$(".tag-word", tagline).forEach((word) => wordObserver.observe(word));
}

let revealObserver;
function observeReveals() {
  const sections = $$(".reveal-section:not(.is-revealed)");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sections.forEach((section) => section.classList.add("is-revealed"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
  }
  sections.forEach((section) => revealObserver.observe(section));
}

function populateMarketControls() {
  const countrySelect = $("#account-country");
  countrySelect.innerHTML = state.markets.countries.map((item) => `<option value="${escapeHTML(item.code)}">${escapeHTML(item.name)} · ${escapeHTML(item.localCurrency)}</option>`).join("");
  countrySelect.value = state.account.workspace.countryCode;
  updateCurrencyOptions(state.account.workspace.currencyCode);
  updateMarketNote();
}

function updateCurrencyOptions(preferredCode = "") {
  const countryCode = $("#account-country").value;
  const currencies = state.markets.currencies.filter((item) => !item.availableCountryCodes || item.availableCountryCodes.includes(countryCode));
  const currencySelect = $("#account-currency");
  currencySelect.innerHTML = currencies.map((item) => `<option value="${escapeHTML(item.code)}">${escapeHTML(item.code)} · ${escapeHTML(item.name)}</option>`).join("");
  const country = state.markets.countries.find((item) => item.code === countryCode);
  const selectedCode = currencies.some((item) => item.code === preferredCode)
    ? preferredCode
    : country?.defaultCheckoutCurrency;
  currencySelect.value = selectedCode || "USD";
}

function updateMarketNote() {
  const country = state.markets.countries.find((item) => item.code === $("#account-country").value);
  const currency = $("#account-currency").value;
  if (!country) return;
  const inCountryOnly = state.markets.currencies.find((item) => item.code === currency)?.availableCountryCodes?.length > 0;
  $("#market-note").textContent = `Local currency: ${country.localCurrency}. Checkout is charged in ${currency}. ${inCountryOnly ? "PayPal restricts this currency to in-country accounts." : "PayPal country features differ; this country selection does not guarantee every payment feature."} Catalog conversion uses a dated daily reference rate; PayPal may apply its own rate or fees.`;
}

function renderAccount(account) {
  state.account = account;
  const isDemo = Boolean(account.user.isDemo);
  const hasPassword = Boolean(account.user.hasPassword);
  $("#demo-workspace-banner").hidden = !isDemo;
  $("#new-request-toggle").disabled = isDemo;
  $("#new-request-toggle").setAttribute("aria-label", isDemo ? "Adding requests is disabled in the shared demo" : "Add a request");
  for (const input of $("#profile-form").querySelectorAll('input:not([readonly])')) input.readOnly = isDemo;
  for (const select of $("#market-form").querySelectorAll("select")) select.disabled = isDemo;
  for (const button of [$("#profile-form button[type=submit]"), $("#market-form button[type=submit]"), $("#password-form button[type=submit]"), $("#revoke-sessions")]) button.disabled = isDemo;
  for (const control of $("#password-form").querySelectorAll("input")) control.disabled = isDemo;
  $("#current-password-field").hidden = !hasPassword;
  $("#current-password").required = hasPassword;
  $("#password-submit").textContent = hasPassword ? "Change password" : "Set a password";
  $("#security-copy").textContent = hasPassword
    ? "Passwords are stored as salted scrypt hashes."
    : "This account uses a linked identity provider. Set a password to enable email sign-in too.";
  for (const control of $("#request-form").querySelectorAll("input,select,textarea,button")) control.disabled = isDemo;
  $("#account-name").value = account.user.displayName;
  $("#account-email").value = account.user.email;
  $("#workspace-name").value = account.workspace.name;
  populateMarketControls();
}

async function refreshMoneyConfig() {
  const [config, catalog] = await Promise.all([api("/api/config"), api("/api/catalog")]);
  state.config = config;
  state.catalog = catalog.products;
  setModeLabels();
  renderNeedOptions();
  renderRequests();
  renderOrders(state.orders, state.metrics);
  if (state.activePlan) renderKit();
  loadPayPalSdk();
}

async function loadAccountPanels() {
  try {
    const [sessionData, supportData] = await Promise.all([api("/api/account/sessions"), api("/api/account/support")]);
    $("#session-list").innerHTML = sessionData.sessions.length ? sessionData.sessions.map((entry) => {
      const seen = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.lastSeenAt));
      return `<li><span><strong>${entry.current ? "This device" : "Signed-in device"}${entry.current ? " · current" : ""}</strong>Last active ${escapeHTML(seen)}</span><small>Expires ${escapeHTML(new Date(entry.expiresAt).toLocaleDateString())}</small></li>`;
    }).join("") : "<li>No active sessions found.</li>";
    $("#ticket-list").innerHTML = supportData.tickets.length ? supportData.tickets.map((ticket) => {
      const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ticket.createdAt));
      return `<li><span><strong>${escapeHTML(ticket.subject)}</strong>${escapeHTML(ticket.category)} · ${escapeHTML(date)}<small>${escapeHTML(ticket.message.slice(0, 150))}${ticket.message.length > 150 ? "…" : ""}</small></span><b class="ticket-state">${escapeHTML(ticket.status)}</b></li>`;
    }).join("") : "<li>No support tickets yet. Use Contact CommonThread support if you need help.</li>";
  } catch (error) {
    $("#session-list").innerHTML = `<li>${escapeHTML(error.message)}</li>`;
    $("#ticket-list").innerHTML = `<li>${escapeHTML(error.message)}</li>`;
  }
}

function showInlineError(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
}

async function saveProfile(event) {
  event.preventDefault();
  showInlineError("#profile-error", "");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = await api("/api/account/profile", { method: "PATCH", body: {
      displayName: $("#account-name").value,
      workspaceName: $("#workspace-name").value,
      countryCode: state.account.workspace.countryCode,
      currencyCode: state.account.workspace.currencyCode
    } });
    renderAccount(payload);
    showToast("Profile saved.");
  } catch (error) { showInlineError("#profile-error", error.message); }
  finally { button.disabled = false; }
}

async function saveMarket(event) {
  event.preventDefault();
  showInlineError("#market-error", "");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const currencyChanged = state.account.workspace.currencyCode !== $("#account-currency").value;
    const payload = await api("/api/account/profile", { method: "PATCH", body: {
      displayName: state.account.user.displayName,
      workspaceName: state.account.workspace.name,
      countryCode: $("#account-country").value,
      currencyCode: $("#account-currency").value
    } });
    renderAccount(payload);
    invalidatePlan("Checkout currency changed. Rebuild the kit using the new reference rate.");
    if (currencyChanged) { location.reload(); return; }
    await refreshMoneyConfig();
    showToast("Payment region updated.");
  } catch (error) { showInlineError("#market-error", error.message); }
  finally { button.disabled = false; }
}

async function changePassword(event) {
  event.preventDefault();
  showInlineError("#password-error", "");
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/account/password", { method: "POST", body: Object.fromEntries(new FormData(form)) });
    form.reset();
    await loadAccountPanels();
    showToast("Password updated. Other sessions were signed out.");
  } catch (error) { showInlineError("#password-error", error.message); }
  finally { button.disabled = false; }
}

function appendChatMessage(text, role) {
  const message = document.createElement("p");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
  message.textContent = text;
  $("#chat-messages").append(message);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
  return message;
}

async function sendAssistantMessage(event) {
  event.preventDefault();
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendChatMessage(message, "user");
  state.chatHistory.push({ role: "user", content: message });
  state.chatHistory = state.chatHistory.slice(-10);
  const waiting = appendChatMessage("Thinking…", "assistant");
  $("#chat-form button").disabled = true;
  try {
    const result = await api("/api/assistant/chat", { method: "POST", body: { message, history: state.chatHistory } });
    waiting.textContent = result.reply;
    state.chatHistory.push({ role: "assistant", content: result.reply });
    state.chatHistory = state.chatHistory.slice(-10);
    $("#assistant-mode").textContent = result.mode === "gemini" ? "Gemini · workspace support" : "Guided workspace support";
  } catch (error) { waiting.textContent = error.message; }
  finally { $("#chat-form button").disabled = false; $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight; input.focus(); }
}

async function signOut() {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); }
  catch { /* The session may already have expired. */ }
  location.assign("/login.html");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { showView(viewButton.dataset.view); return; }
    if (event.target.closest("#new-request-toggle, [data-open-request]")) { setRequestFormVisible(true); return; }
    if (event.target.closest("#close-request-form, #cancel-request")) { setRequestFormVisible(false); return; }
  });
  $$('[data-scroll-builder]').forEach((button) => button.addEventListener("click", () => {
    if (state.view !== "builder") showView("builder");
    window.setTimeout(() => $("#builder").scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }));
  $$('[data-edit-request]').forEach((button) => button.addEventListener("click", () => {
    window.scrollTo({ top: $("#builder").offsetTop - 85, behavior: "smooth" });
  }));
  $("#builder-form").addEventListener("submit", buildKit);
  $("#request-form").addEventListener("submit", submitRequest);
  $("#request-list").addEventListener("click", (event) => {
    const action = event.target.closest("[data-request-action]");
    if (action) updateRequestStatus(action.dataset.requestId, action.dataset.requestAction);
    const plan = event.target.closest("[data-plan-request]");
    if (plan) {
      const need = state.needs.find((item) => item.id === plan.dataset.planRequest && item.status === "ready");
      if (!need) return;
      showView("builder");
      selectNeed(need.id);
      window.setTimeout(() => $("#builder").scrollIntoView({ behavior: "smooth", block: "start" }), 20);
    }
  });
  $("#request-list").addEventListener("toggle", (event) => {
    if (event.target.matches("details[data-request-events-id]") && event.target.open) loadRequestEvents(event.target);
  }, true);
  $$('[data-request-filter]').forEach((button) => button.addEventListener("click", () => {
    state.requestFilter = button.dataset.requestFilter;
    setRequestFilterButtons();
    renderRequests();
  }));
  $("#export-ledger").addEventListener("click", () => exportOrderLedger());
  $("#export-receipt").addEventListener("click", exportReceipt);
  $("#kit-intent").addEventListener("input", updateIntentCount);
  $("#kit-budget").addEventListener("input", () => {
    const cents = currentBudgetCents();
    setBudgetPreset(cents);
    if (state.activePlan) { discardCheckoutAttempt(); renderKit(); }
  });
  $$('[data-budget]').forEach((button) => button.addEventListener("click", () => {
    $("#kit-budget").value = (Number(button.dataset.budget) / 100).toFixed(2);
    setBudgetPreset(Number(button.dataset.budget));
    if (state.activePlan) { discardCheckoutAttempt(); renderKit(); }
  }));
  $("#diet-preference").addEventListener("change", () => { if (state.activePlan) { discardCheckoutAttempt(); renderKit(); } });
  $$('input[name="allergen"]').forEach((input) => input.addEventListener("change", () => { if (state.activePlan) { discardCheckoutAttempt(); renderKit(); } }));
  $("#add-catalog-item").addEventListener("click", addCatalogItem);
  $("#kit-lines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-action]");
    if (button) editCart(button.dataset.cartAction, button.dataset.productId);
  });
  $("#local-checkout").addEventListener("click", saveLocalOrder);
  $("#orders-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-order]");
    if (!button) return;
    const order = state.orders.find((entry) => entry.id === button.dataset.viewOrder);
    if (order) showReceipt(order);
  });
  $("#receipt-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-receipt]")) $("#receipt-dialog").close();
  });
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#market-form").addEventListener("submit", saveMarket);
  $("#account-country").addEventListener("change", () => {
    const country = state.markets.countries.find((entry) => entry.code === $("#account-country").value);
    if (country) updateCurrencyOptions(country.defaultCheckoutCurrency);
    updateMarketNote();
  });
  $("#account-currency").addEventListener("change", updateMarketNote);
  $("#password-form").addEventListener("submit", changePassword);
  $("#revoke-sessions").addEventListener("click", async () => {
    try { await api("/api/account/sessions", { method: "DELETE" }); await loadAccountPanels(); showToast("Other sessions signed out."); }
    catch (error) { showToast(error.message); }
  });
  $("#sign-out").addEventListener("click", signOut);
  $("#chat-launch").addEventListener("click", () => {
    const open = $("#help-chat").hidden;
    $("#help-chat").hidden = !open;
    $("#chat-launch").setAttribute("aria-expanded", String(open));
    $("#chat-launch").hidden = open;
    if (open) $("#chat-input").focus();
  });
  $("#chat-close").addEventListener("click", () => { $("#help-chat").hidden = true; $("#chat-launch").hidden = false; $("#chat-launch").setAttribute("aria-expanded", "false"); $("#chat-launch").focus(); });
  $("#chat-form").addEventListener("submit", sendAssistantMessage);
  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#menu-toggle").getAttribute("aria-expanded") !== "true";
    document.body.classList.toggle("nav-open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
    $("#menu-toggle").setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    $("#mobile-menu-scrim").hidden = !open;
  });
  $("#mobile-menu-scrim").addEventListener("click", () => {
    document.body.classList.remove("nav-open");
    $("#menu-toggle").setAttribute("aria-expanded", "false");
    $("#menu-toggle").setAttribute("aria-label", "Open navigation");
    $("#mobile-menu-scrim").hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.body.classList.remove("nav-open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
      $("#mobile-menu-scrim").hidden = true;
    }
  });
}

async function init() {
  const themeButton = $("#theme-toggle");
  const savedTheme = localStorage.getItem("commonthread-theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = savedTheme;
  themeButton.setAttribute("aria-pressed", String(savedTheme === "dark"));
  themeButton.setAttribute("aria-label", savedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  themeButton.querySelector("span").textContent = savedTheme === "dark" ? "Light mode" : "Dark mode";
  themeButton.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("commonthread-theme", dark ? "dark" : "light");
    themeButton.setAttribute("aria-pressed", String(dark));
    themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeButton.querySelector("span").textContent = dark ? "Light mode" : "Dark mode";
  });
  bindEvents();
  setupTaglineReveal();
  observeReveals();
  try {
    const session = await api("/api/auth/session");
    state.account = { user: session.user, workspace: session.workspace };
    state.csrfToken = session.csrfToken;
    state.markets = await api("/api/markets");
    renderAccount(state.account);
    const [config, board, catalog, orders] = await Promise.all([
      api("/api/config"), api("/api/board"), api("/api/catalog"), api("/api/orders")
    ]);
    state.config = config;
    state.needs = board.needs;
    state.metrics = board.metrics;
    state.catalog = catalog.products;
    state.orders = orders.orders;
    state.metrics = orders.metrics;
    if (!state.needs.some((need) => need.id === state.selectedNeedId && need.status === "ready")) state.selectedNeedId = state.needs.find((need) => need.status === "ready")?.id || "";
    $("#catalog-count").textContent = String(catalog.products.length);
    renderNeedOptions();
    renderRequests();
    setModeLabels();
    renderOrders(state.orders, state.metrics);
    const selected = state.needs.find((need) => need.id === state.selectedNeedId);
    if (selected) {
      $("#kit-intent").value = selected.suggestedPrompt;
      $("#kit-budget").value = (selected.defaultBudgetCents / 100).toFixed(2);
      setBudgetPreset(selected.defaultBudgetCents);
      updateIntentCount();
    }
    loadPayPalSdk();
    const view = location.hash.slice(1);
    showView(["requests", "orders", "how", "account"].includes(view) ? view : "builder");
    await loadAccountPanels();
    observeReveals();
  } catch (error) {
    if (error.status === 401) { location.assign("/login.html"); return; }
    $("#mode-label").textContent = "Server unavailable";
    showToast(error.message || "Start the local server to load the kit builder.");
  }
}

init();
