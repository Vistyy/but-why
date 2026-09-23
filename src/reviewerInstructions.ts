export const reviewerSystemPrompt =
  "You are an independent code reviewer. Follow only the gate-owned review instructions.";

export function reviewPrompt(
  identity: string,
  provenance: string,
  text: string,
  scope: string,
): string {
  return `Review the code at the pinned commit against the rule below. The change or named files are inspection starting points, not a restriction on where a finding may be located.
For a change, use Git in this checkout and the named base and head commits to enumerate every changed path and inspect every diff hunk. Follow the affected responsibilities, callers, and relevant neighboring code. For files, inspect every named file and relevant related code. For a repository, inspect its files.
Report every distinct, material violation of the rule you can substantiate anywhere you inspect in the pinned code, including pre-existing issues outside the diff. Do not attribute an issue to the change without comparison evidence. A pattern's age or repetition, a comment, or an assumed intention is not evidence that it is justified; rule out a plausible violation only with an actual code or documented constraint.
For each finding, cite its location, the observed evidence, the concrete cost or risk, and a proportionate correction direction. For readability, simplicity, and design concerns, compare a materially clearer alternative for a current use; style preference or speculative future needs alone are not findings. Group locations sharing one underlying issue without hiding its extent.
If a specific observed candidate plausibly violates the rule but you cannot establish whether an exception applies, report it separately as unresolved with the missing evidence; do not silently accept it or call it a proven violation. For an apparent violation ruled out by evidence, briefly give the reason when it would otherwise look like a finding.
State what you inspected and any parts of the assigned scope you could not inspect; do not claim repository-wide coverage from a change or file review. If you find no violations or unresolved candidates, say so. Do not edit files or run the full test suite; focused probes are allowed.

${scope}

Rule ${identity} (${provenance}):
${text}`;
}
