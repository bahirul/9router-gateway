const PATTERNS = {
  quick: /\b(translate|summari[sz]e|rewrite|rephrase|format|spellcheck|typo|define|convert|one[- ]liner|short answer|terjemah(?:kan)?|ringkas|rangkum|tulis ulang|parafrase|perbaiki ejaan|definisikan)\b/i,
  coding: /\b(code|implement|function|class|typescript|javascript|python|rust|golang|java|sql|regex|api|endpoint|component|refactor|repository|codebase|kode|implementasi|fungsi|kelas|komponen|repositori|basis kode)\b/i,
  debugging: /\b(debug|bug|error|exception|stack trace|fails?|broken|regression|root cause|diagnos[ei]|fix this|galat|kesalahan|gagal|rusak|akar masalah|perbaiki ini)\b/i,
  planning: /\b(plan|architecture|design|strategy|proposal|roadmap|specification|migration plan|implementation plan|trade[- ]?offs?|rencana|rencanakan|arsitektur|desain|strategi|peta jalan|spesifikasi|pertimbangan)\b/i,
  review: /\b(review|audit|pull request|diff|vulnerabilit|security review|code review|threat model|tinjau|ulasan?|kerentanan|tinjauan keamanan|tinjauan kode|model ancaman)\b/i,
  research: /\b(research|compare|evaluate|benchmark|investigate|latest|sources?|citations?|evidence|riset|teliti|bandingkan|evaluasi|investigasi|terbaru|sumber|sitasi|bukti)\b/i,
  risk: /\b(production|security|authentication|authorization|permission|credential|secret|payment|billing|finance|medical|legal|destructive|delete data|data loss|tenant|encryption|produksi|keamanan|autentikasi|otorisasi|izin|kredensial|rahasia|pembayaran|keuangan|medis|hukum|destruktif|hapus data|kehilangan data|penyewa|enkripsi)\b/i,
  migration: /\b(migrat(?:e|ion)|schema change|database upgrade|backfill|zero downtime|rollout|rollback|compatibility|migrasi|perubahan skema|pemutakhiran basis data|tanpa downtime|peluncuran|kompatibilitas)\b/i,
  multiStep: /\b(first|then|after that|finally|step \d+|end[- ]to[- ]end|across (?:the )?codebase|multiple files?|pertama|kemudian|setelah itu|akhirnya|langkah \d+|seluruh basis kode|beberapa file)\b/i,
};

function matched(pattern, text) {
  return pattern.test(text);
}

function chooseTask(flags) {
  if (flags.planning) return "planning";
  if (flags.review) return "review";
  if (flags.debugging) return "debugging";
  if (flags.research) return "research";
  if (flags.coding) return "coding";
  if (flags.quick) return "quick";
  return "general";
}

function ruleConfidence(score, thresholds, signalCount) {
  const distance = Math.min(
    Math.abs(score - thresholds.medium),
    Math.abs(score - thresholds.high),
  );
  const distanceConfidence = Math.min(1, distance / 20);
  const signalConfidence = Math.min(1, signalCount / 5);
  return Number((0.45 + distanceConfidence * 0.35 + signalConfidence * 0.2).toFixed(3));
}

export function extractFeatures(normalized, thresholds) {
  const text = `${normalized.systemText}\n${normalized.latestUserText}`.trim();
  const flags = Object.fromEntries(
    Object.entries(PATTERNS).map(([name, pattern]) => [name, matched(pattern, text)]),
  );
  const chars = normalized.allText.length;
  let score = chars < 400 ? 5 : chars < 2000 ? 15 : chars < 8000 ? 25 : 35;

  if (normalized.messageCount > 6) score += 5;
  if (normalized.messageCount > 15) score += 5;
  score += Math.min(15, normalized.toolCount * 3);
  if (normalized.hasStructuredOutput) score += 10;
  if (flags.coding) score += 10;
  if (flags.debugging) score += 15;
  if (flags.planning) score += 25;
  if (flags.review) score += 20;
  if (flags.research) score += 20;
  if (flags.risk) score += 30;
  if (flags.migration) score += 25;
  if (flags.multiStep) score += 10;
  if (flags.quick && !flags.risk) score -= 15;
  if (["high", "xhigh", "enabled"].includes(String(normalized.reasoningEffort).toLowerCase())) {
    score += 20;
  }

  score = Math.max(0, Math.min(100, score));
  const signalCount = Object.values(flags).filter(Boolean).length
    + Number(normalized.toolCount > 0)
    + Number(normalized.hasStructuredOutput);

  return {
    text,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    flags,
    task: chooseTask(flags),
    ruleScore: score,
    ruleConfidence: ruleConfidence(score, thresholds, signalCount),
    signalCount,
    hardFloor: flags.risk || flags.migration
      ? "high"
      : flags.planning || flags.review || flags.research || (flags.debugging && !flags.quick)
        ? "medium"
        : null,
  };
}
