import * as webllm from "@mlc-ai/web-llm";

const MODEL = "Phi-3.5-mini-instruct-q4f16_1-MLC";
let enginePromise = null;

export async function getEngine(statusCb) {
  if (!enginePromise) {
    enginePromise = webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (p) =>
        statusCb?.(p?.text || "Loading model...")
    });
  }
  return enginePromise;
}

export async function llmJson(engine, messages, max_tokens = 800) {
  const resp = await engine.chat.completions.create({
    messages,
    max_tokens,
    temperature: 0.2
    // ❌ REMOVE response_format
  });

  const text = resp.choices?.[0]?.message?.content || "";

  try {
    // Extract JSON block if model wraps it in text
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};

    return JSON.parse(match[0]);
  } catch (err) {
    console.warn("JSON parse failed:", err);
    return {};
  }
}