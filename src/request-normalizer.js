import crypto from "node:crypto";

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return part.text || part.input_text || part.output_text || part.content || "";
  }).filter(Boolean).join("\n");
}

function hasImageContent(content) {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    const type = String(part?.type || "").toLowerCase();
    return type.includes("image") || Boolean(part?.image_url || part?.source?.type === "base64");
  });
}

function normalizeOpenAI(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.map((message) => ({
    role: message.role || "unknown",
    text: textFromContent(message.content),
    hasImage: hasImageContent(message.content),
  }));
}

function normalizeResponses(body) {
  if (typeof body.input === "string") return [{ role: "user", text: body.input, hasImage: false }];
  const input = Array.isArray(body.input) ? body.input : [];
  return input.map((item) => ({
    role: item.role || (item.type === "message" ? "user" : item.type || "unknown"),
    text: textFromContent(item.content ?? item.input ?? item.text),
    hasImage: hasImageContent(item.content),
  }));
}

function normalizeAnthropic(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const normalized = [];
  if (body.system) {
    normalized.push({ role: "system", text: textFromContent(body.system), hasImage: false });
  }
  for (const message of messages) {
    normalized.push({
      role: message.role || "unknown",
      text: textFromContent(message.content),
      hasImage: hasImageContent(message.content),
    });
  }
  return normalized;
}

function firstMeaningful(messages, role) {
  return messages.find((message) => message.role === role && message.text.trim())?.text.trim() || "";
}

function lastMeaningful(messages, role) {
  return [...messages].reverse().find((message) => message.role === role && message.text.trim())?.text.trim() || "";
}

function detectRequestFormat(pathname, body) {
  if (pathname.endsWith("/messages")) return "anthropic";
  if (pathname.endsWith("/responses") || body.input !== undefined) return "openai-responses";
  return "openai-chat";
}

export function normalizeRequest(pathname, body) {
  const format = detectRequestFormat(pathname, body);
  const messages = format === "anthropic"
    ? normalizeAnthropic(body)
    : format === "openai-responses"
      ? normalizeResponses(body)
      : normalizeOpenAI(body);
  const allText = messages.map((message) => message.text).filter(Boolean).join("\n");
  const latestUserText = lastMeaningful(messages, "user") || lastMeaningful(messages, "input");
  const firstUserText = firstMeaningful(messages, "user") || firstMeaningful(messages, "input");
  const systemText = firstMeaningful(messages, "system");
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const reasoningEffort = body.reasoning_effort || body.reasoning?.effort || body.thinking?.type || null;

  return {
    format,
    model: body.model,
    messages,
    allText,
    latestUserText,
    firstUserText,
    systemText,
    messageCount: messages.length,
    userTurnCount: messages.filter((message) => ["user", "input"].includes(message.role)).length,
    toolCount: tools.length,
    toolNames: tools.map((tool) => tool?.function?.name || tool?.name || tool?.type).filter(Boolean),
    hasImage: messages.some((message) => message.hasImage),
    hasStructuredOutput: Boolean(body.response_format || body.text?.format || body.output_schema),
    reasoningEffort,
    promptHash: crypto.createHash("sha256").update(allText).digest("hex"),
  };
}

function conversationFingerprint(normalized, headers = {}) {
  const bodySeed = [
    normalized.systemText,
    normalized.firstUserText,
    headers["user-agent"] || "",
  ].join("\n").slice(0, 16000);
  return crypto.createHash("sha256").update(bodySeed).digest("hex");
}

export function extractSessionId(body, normalized, headers = {}) {
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const explicit = headers["x-smart-router-session-id"]
    || body.prompt_cache_key
    || body.session_id
    || body.conversation_id
    || body.thread_id
    || metadata.session_id
    || metadata.conversation_id;
  if (explicit) {
    return `explicit:${crypto.createHash("sha256").update(String(explicit)).digest("hex")}`;
  }
  return `fingerprint:${conversationFingerprint(normalized, headers)}`;
}

export function isRoutablePath(method, pathname) {
  if (method !== "POST") return false;
  return pathname.endsWith("/chat/completions")
    || pathname.endsWith("/responses")
    || pathname.endsWith("/messages");
}
