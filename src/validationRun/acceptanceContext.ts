import { sha256CanonicalJson } from "./canonicalJson.js";

export type AcceptanceContextSnapshotV1 = {
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};

export type AcceptanceContext = AcceptanceContextSnapshotV1 | null;

export type AcceptanceContextValidationResult =
  | { readonly ok: true; readonly context: AcceptanceContext }
  | { readonly ok: false; readonly code: "empty_acceptance_context" | "unsupported_version" };

export const validateAcceptanceContext = (
  context: AcceptanceContextSnapshotV1 | null | undefined,
): AcceptanceContextValidationResult => {
  if (context === null || context === undefined) {
    return { ok: true, context: null };
  }

  if (context.version !== 1) {
    return { ok: false, code: "unsupported_version" };
  }

  if (
    context.title.trim().length === 0 &&
    context.description.trim().length === 0 &&
    context.comments.every((comment) => comment.trim().length === 0)
  ) {
    return { ok: false, code: "empty_acceptance_context" };
  }

  return { ok: true, context };
};

export const acceptanceContextFingerprint = (
  context: AcceptanceContextSnapshotV1 | null,
): string | null => (context === null ? null : sha256CanonicalJson(context));
