import { chmodSync, readdirSync, statSync } from "node:fs";

import { Clock, Effect } from "effect";
import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
  ReviewerOutputDecoder,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  type ReviewerContinuity,
  type ReviewerSessionIdentity,
  type ReviewerSessionStore,
  reviewerSessionFingerprint,
  reviewerSessionsPath,
} from "./reviewerSession.js";

export type ReviewerExecutionEvidence = {
  readonly continuity: ReviewerContinuity;
  readonly identityFingerprint: string;
  readonly restartReason?: string;
  readonly durationMs: number;
  readonly reviewCalls: number;
};

export type ExecuteReviewerSessionInput<Output, ReviewBoundaryError> = {
  readonly identity: ReviewerSessionIdentity;
  readonly runtime: ReviewerAgentRuntime<Output>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly decodeOutput: (
    output: unknown,
    reviewCall: number,
  ) => ReturnType<ReviewerOutputDecoder<Output>>;
  readonly prompt: string;
  readonly continuationPrompt: string;
  readonly commandCwd: string;
  readonly resourceRoot?: string;
  readonly sessionStorageRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
  readonly completeReview: (input: {
    readonly initialResult: ReviewerAgentResult<Output>;
    readonly review: (
      prompt: string,
      resumeSession?: string,
    ) => Effect.Effect<ReviewerAgentResult<Output>>;
  }) => Effect.Effect<ReviewerAgentResult<Output>, ReviewBoundaryError>;
};

export type ExecuteReviewerSessionResult<Output> = {
  readonly result: ReviewerAgentResult<Output>;
  readonly evidence: ReviewerExecutionEvidence;
};

export const executeReviewerSession = <Output, ReviewBoundaryError>(
  input: ExecuteReviewerSessionInput<Output, ReviewBoundaryError>,
): Effect.Effect<
  ExecuteReviewerSessionResult<Output>,
  ReviewBoundaryError | RepositoryStorageError
> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const fingerprint = reviewerSessionFingerprint(input.identity);
    const stored =
      input.sessionStore === undefined
        ? undefined
        : yield* input.sessionStore.get(input.identity.changeId, input.identity.producer);
    const compatible =
      stored !== undefined &&
      stored.fingerprint === fingerprint &&
      stored.sessionReference.length > 0;
    let continuity: ReviewerContinuity = compatible
      ? "resumed"
      : stored === undefined
        ? "fresh"
        : "restarted";
    let restartReason: string | undefined =
      stored === undefined
        ? undefined
        : stored.fingerprint === fingerprint && stored.sessionReference.length === 0
          ? "session_capture_unavailable"
          : compatible
            ? undefined
            : "identity_mismatch";
    let reviewCalls = 0;

    const review = (prompt: string, resumeSession?: string) => {
      reviewCalls += 1;
      const reviewCall = reviewCalls;
      return input.runtime.review({
        reviewerExecutor: input.reviewerExecutor,
        reviewer: input.identity.producer,
        decodeOutput: (output) => input.decodeOutput(output, reviewCall),
        prompt,
        profile: input.identity.agentProfile,
        commandCwd: input.commandCwd,
        ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
        ...(input.identity.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: input.identity.agentEnvironment }),
        ...(input.sessionStorageRoot === undefined
          ? {}
          : {
              sessionStorageRoot: reviewerSessionsPath(
                input.sessionStorageRoot,
                input.identity.changeId,
                input.identity.producer,
              ),
            }),
        ...(resumeSession === undefined ? {} : { resumeSession }),
      });
    };

    let result = yield* review(
      compatible ? input.continuationPrompt : input.prompt,
      compatible ? stored?.sessionReference : undefined,
    );
    if (!result.ok && compatible && result.sessionUsability === "unusable") {
      continuity = "restarted";
      restartReason = "session_unusable";
      if (input.sessionStore !== undefined)
        yield* input.sessionStore.remove(input.identity.changeId, input.identity.producer);
      result = yield* review(input.prompt);
    }
    result = yield* input.completeReview({ initialResult: result, review });

    if (result.ok && result.sessionReference === undefined && restartReason === undefined) {
      restartReason = "session_capture_unavailable";
    }
    const sessionPermissionsOk =
      result.sessionFilePath === undefined || hardenSessionPath(result.sessionFilePath);
    if (!sessionPermissionsOk && restartReason === undefined) {
      restartReason = "session_permissions_unavailable";
    }
    if (result.ok && input.sessionStore !== undefined && sessionPermissionsOk) {
      yield* input.sessionStore.save({
        changeId: input.identity.changeId,
        producer: input.identity.producer,
        fingerprint,
        sessionReference: result.sessionReference ?? "",
      });
    }

    return {
      result,
      evidence: {
        continuity,
        identityFingerprint: fingerprint,
        ...(restartReason === undefined ? {} : { restartReason }),
        durationMs: (yield* Clock.currentTimeMillis) - startedAt,
        reviewCalls,
      },
    };
  });

const hardenSessionPath = (path: string): boolean => {
  try {
    chmodSync(path, 0o700);
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (!hardenSessionPath(`${path}/${entry}`)) return false;
      }
    } else {
      chmodSync(path, 0o600);
    }
    return true;
  } catch {
    return false;
  }
};
