import { Effect } from "effect";

export const noOpTerminalCleanupDependencies = {
  indexTranscripts: () => Effect.succeed({ ok: true as const }),
  reviewerSessionPathFor: () => "/unused/reviewer-sessions",
  artifactLifecycle: {
    removeContent: () => Effect.succeed({ ok: true as const }),
  },
};
