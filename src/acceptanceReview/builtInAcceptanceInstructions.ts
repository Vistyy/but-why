export const builtInAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Inspect the repository and Candidate diff before deciding.",
  "Report each material mismatch between the Candidate and the approved Task intent as a Finding.",
  "Return an empty findings array when the Candidate fully satisfies the approved intent.",
].join("\n");
