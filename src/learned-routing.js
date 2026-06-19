const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "you", "your", "are", "was", "were", "will", "can", "into", "have", "has", "had", "not", "but", "what", "when", "where", "how", "why", "all", "any", "our", "out", "use", "using", "please", "help",
  "yang", "dan", "untuk", "dengan", "dari", "ini", "itu", "apa", "bagaimana", "tolong",
]);

export function learnedRoutingTokens(text) {
  return [...new Set(String(text || "").toLowerCase()
    .replace(/[^a-z0-9_+#./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))]
    .slice(0, 200);
}

export function learnedRoutingSimilarity(aTokens, bTokens) {
  const a = new Set(aTokens || []);
  const b = new Set(bTokens || []);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function bestLearnedRoutingMatch(text, examples, { threshold = 0.24, margin = 0.05 } = {}) {
  const tokens = learnedRoutingTokens(text);
  const scored = (examples || []).map((example) => ({
    ...example,
    similarity: learnedRoutingSimilarity(tokens, example.tokens || learnedRoutingTokens(example.promptText)),
  })).sort((a, b) => b.similarity - a.similarity);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.similarity < threshold) return null;
  if (second && best.similarity - second.similarity < margin && second.expectedTargetKey !== best.expectedTargetKey) return null;
  return { ...best, tokens, secondSimilarity: second?.similarity || 0 };
}
