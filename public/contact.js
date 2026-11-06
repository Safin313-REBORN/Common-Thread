"use strict";

const $ = (selector) => document.querySelector(selector);
let csrfToken = "";
let signedIn = false;
let sessionEmail = "";

async function loadContact() {
  const [contactResponse, sessionResponse] = await Promise.all([
    fetch("/api/contact", { credentials: "same-origin" }).then((response) => response.json()),
    fetch("/api/auth/session", { credentials: "same-origin" }).then(async (response) => response.ok ? response.json() : null).catch(() => null)
  ]);
  const details = $("#contact-details");
  const links = [];
  if (contactResponse.email) {
    const link = document.createElement("a");
    link.href = `mailto:${contactResponse.email}`;
    link.textContent = contactResponse.email;
    details.replaceChildren(link);
    links.push(link);
  }
  if (contactResponse.phone) {
    const link = document.createElement("a");
    link.href = `tel:${contactResponse.phone.replace(/[^+\d]/g, "")}`;
    link.textContent = contactResponse.phone;
    if (links.length) details.append(document.createTextNode(" · "));
    details.append(link);
    links.push(link);
  }
  if (contactResponse.website) {
    const website = document.createElement("a");
    try {
      const url = new URL(contactResponse.website);
      if (["http:", "https:"].includes(url.protocol)) {
        website.href = url.href;
        website.target = "_blank";
        website.rel = "noreferrer";
        website.textContent = "Support site";
        if (links.length) details.append(document.createTextNode(" · "));
        details.append(website);
        links.push(website);
      }
    } catch {}
  }
  if (!links.length) details.textContent = "Send a note using the form. The site operator has not published direct contact details.";
  if (sessionResponse) {
    signedIn = true;
    csrfToken = sessionResponse.csrfToken;
    sessionEmail = sessionResponse.user.email;
    const email = $("#contact-form [name=email]");
    email.value = sessionEmail;
    email.readOnly = true;
    $("#contact-email-field").querySelector("small")?.remove();
    $("#contact-back").href = "/#account";
    $("#contact-back").textContent = "Back to your workspace";
  }
}

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = $("#contact-error");
  const success = $("#contact-success");
  error.hidden = true;
  success.hidden = true;
  button.disabled = true;
  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(signedIn ? { "X-CT-CSRF": csrfToken } : {}) },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    success.textContent = `${payload.message} Ticket ${payload.ticket.id.slice(0, 8).toUpperCase()}.`;
    success.hidden = false;
    form.reset();
    if (signedIn) form.querySelector('[name="email"]').value = sessionEmail;
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

loadContact().catch(() => {});
