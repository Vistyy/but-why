import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Data, Effect, Schema } from "effect";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ValidationRunFindingRecord } from "../validationRun/validationRun.js";

export const stallDetectorPrompt = `You are the Stall Detector for a linked Change.

\`continue\` means the Findings remain concrete correction work and the history does not establish that the implementation approach is failing.

\`stop\` means the history itself shows that the approach is not credibly converging or that safe continuation requires Operator authority, such as the same underlying conflict recurring despite correction, corrections producing equivalent or broader violations, incompatible accepted constraints, or materially expanding cross-cutting problems.

Do not stop merely because reviews failed, Findings remain, or Findings are serious.

Base the relationship only on concrete details that identify the accepted constraint, observable defect or consequence, and relevant correction.
Temporal or evaluative wording in a Finding, including \`still\`, \`remain\`, \`again\`, \`recurring\`, \`equivalent\`, or \`broader\`, is not evidence of repetition or non-convergence by itself.

Return only:
{"decision":"continue"|"stop","reason":"brief reason"}
Do not add fields.`;

export const stallDetectorResponseContract =
  '{"decision":"continue"|"stop","reason":"brief reason"}';

export type StallDetectorPolicy = {
  readonly prompt: string;
  readonly responseContract: string;
};

export type StallDetectionRunGroup = {
  readonly validationRunId: number;
  readonly findings: readonly Pick<
    ValidationRunFindingRecord,
    "producer" | "title" | "description" | "evidence" | "files"
  >[];
};

export type StallDetectionInput = {
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly runs: readonly StallDetectionRunGroup[];
  readonly model: string;
  readonly thinking?: Exclude<ModelThinkingLevel, "off">;
  readonly policy: StallDetectorPolicy;
};

export type StallDetectorResult =
  | { readonly ok: true; readonly decision: "continue" | "stop"; readonly reason: string }
  | { readonly ok: false; readonly message: string };

class StallDetectorModelFailure extends Data.TaggedError("StallDetectorModelFailure")<{
  readonly cause: unknown;
}> {}

export type StallDetector = {
  readonly judge: (input: StallDetectionInput) => Effect.Effect<StallDetectorResult>;
};

const responseSchema = Schema.Struct({
  decision: Schema.Literal("continue", "stop"),
  reason: Schema.String.pipe(Schema.filter((value) => value.trim().length > 0)),
});

const decodeResponse = Schema.decodeUnknownSync(responseSchema, {
  onExcessProperty: "error",
});

export const makePiAiStallDetector = (): StallDetector => ({
  judge: (input) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.tryPromise({
          try: async () => {
            const runtime = await ModelRuntime.create({ refreshOnCreate: false });
            const [provider, ...modelParts] = input.model.split("/");
            const modelId = modelParts.join("/");
            if (provider === undefined || modelId.length === 0) {
              return { kind: "unavailable" as const, message: "The frozen model name is invalid." };
            }
            const model = runtime.getModel(provider, modelId);
            if (model === undefined) {
              return { kind: "unavailable" as const, message: "The frozen model is unavailable." };
            }
            const response = await runtime.completeSimple(
              model,
              {
                systemPrompt: input.policy.prompt,
                messages: [
                  {
                    role: "user",
                    content: JSON.stringify({
                      acceptanceContext: input.acceptanceContext,
                      runs: input.runs,
                    }),
                    timestamp: 0,
                  },
                ],
              },
              input.thinking === undefined ? undefined : { reasoning: input.thinking },
            );
            if (response.stopReason === "error" || response.stopReason === "aborted") {
              return {
                kind: "unavailable" as const,
                message: response.errorMessage ?? "The Stall Detector model did not complete.",
              };
            }
            const text = response.content
              .filter(
                (part): part is { readonly type: "text"; readonly text: string } =>
                  part.type === "text",
              )
              .map((part) => part.text)
              .join("");
            const decoded = decodeResponse(JSON.parse(text) as unknown);
            return { kind: "decision" as const, ...decoded };
          },
          catch: (cause) => new StallDetectorModelFailure({ cause }),
        }),
      );
      if (result._tag === "Left") {
        return {
          ok: false,
          message:
            result.left instanceof StallDetectorModelFailure
              ? result.left.cause instanceof Error
                ? result.left.cause.message
                : String(result.left.cause)
              : String(result.left),
        } as const;
      }
      return result.right.kind === "unavailable"
        ? { ok: false, message: result.right.message }
        : { ok: true, decision: result.right.decision, reason: result.right.reason };
    }),
});
