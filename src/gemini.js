"use strict";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

function modelCandidates() {
  return [...new Set([
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash"
  ].map((model) => model.trim()).filter(Boolean))];
}

function outputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  return steps
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

async function createInteraction({ input, systemInstruction, responseFormat, maxOutputTokens, timeoutMs = 12000 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("Gemini is not configured."), { statusCode: 503 });

  let lastFailure;
  for (const model of modelCandidates()) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model,
          input,
          ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
          store: false,
          generation_config: { max_output_tokens: maxOutputTokens },
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      lastFailure = error;
      console.warn(`Gemini request failed for ${model}: ${error.name || "request error"}${error.code ? ` (${error.code})` : ""}`);
      continue;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastFailure = Object.assign(new Error(`Gemini returned HTTP ${response.status}.`), { providerStatus: response.status });
      console.warn(`Gemini request failed for ${model}: HTTP ${response.status}`);
      if (response.status === 408 || response.status === 429 || response.status >= 500) continue;
      break;
    }

    const text = outputText(payload);
    if (text.trim() && payload.status !== "incomplete") return { text, model };
    lastFailure = new Error("Gemini returned no text.");
    console.warn(`Gemini request returned no complete text for ${model} (status: ${payload.status || "unknown"}).`);
  }

  throw Object.assign(new Error("Gemini could not complete this request. Check the API key and model, then try again."), {
    statusCode: 502,
    cause: lastFailure
  });
}

module.exports = { createInteraction };
