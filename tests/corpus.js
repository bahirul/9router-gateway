const SEEDS = {
  small: [
    "Translate this sentence to Indonesian.",
    "Rewrite this paragraph in a concise tone.",
    "Summarize the following meeting note.",
    "Fix the spelling and punctuation.",
    "Convert this JSON key list to CSV.",
    "Define idempotency in one sentence.",
    "Format this SQL query.",
    "Provide a short title for this conversation.",
    "Rephrase this email politely.",
    "Extract the dates from this text.",
  ],
  planning: [
    "Plan the architecture for a background job system.",
    "Design an implementation strategy for a cache service.",
    "Write a roadmap for splitting a monolith.",
    "Compare trade-offs for queue technologies and propose a plan.",
    "Create an implementation plan for adding audit logs.",
    "Design the API architecture for a notification service.",
    "Plan a staged rollout for a new search index.",
    "Propose a testing strategy for an SDK rewrite.",
    "Create a technical specification for offline synchronization.",
    "Plan how to refactor this repository into modules.",
  ],
  medium: [
    "Debug this null pointer error in the request handler.",
    "Review this pull request for correctness and missing tests.",
    "Research and compare two JavaScript validation libraries.",
    "Implement pagination across the API and UI components.",
    "Debug why this unit test intermittently fails.",
    "Review this diff for behavioral regressions.",
    "Investigate the cause of duplicate webhook delivery.",
    "Implement a parser with structured JSON output.",
    "Compare database connection pool settings.",
    "Review this module and propose focused fixes.",
  ],
  large: [
    "Review production authorization and tenant isolation vulnerabilities.",
    "Design a zero downtime database schema migration with rollback.",
    "Audit authentication, credential storage, and encryption handling.",
    "Plan a production payment migration without data loss.",
    "Debug a production security regression across multiple services.",
    "Threat model this API and review permission boundaries.",
    "Migrate tenant data with compatibility and rollback guarantees.",
    "Review destructive cleanup logic that can delete customer data.",
    "Design secret rotation for production services.",
    "Audit billing calculations and financial reconciliation logic.",
  ],
  vision: [
    "Review the attached UI screenshot.",
    "Read the error visible in this image.",
    "Compare this mockup with the implemented component.",
    "Describe the architecture diagram in the image.",
    "Find accessibility issues in this screenshot.",
    "Extract the table from the attached image.",
    "Debug the layout shown in this screenshot.",
    "Review the visual regression image.",
    "Identify the chart values in this image.",
    "Explain the sequence diagram shown here.",
  ],
};

const CONTEXTS = [
  "Return a concise answer.",
  "Explain the reasoning.",
  "Use the existing project conventions.",
  "Include acceptance criteria.",
  "Do not change unrelated behavior.",
  "Consider failure handling.",
];

export function buildCorpus() {
  const cases = [];
  for (const [expected, seeds] of Object.entries(SEEDS)) {
    for (const seed of seeds) {
      for (const context of CONTEXTS) {
        cases.push({
          expected,
          text: `${seed} ${context}`,
          image: expected === "vision",
        });
      }
    }
  }
  return cases;
}
