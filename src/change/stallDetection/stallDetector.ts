import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Data, Effect, Schema } from "effect";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ValidationRunFindingRecord } from "../validationRun/validationRun.js";

export const stallDetectorResponseContract =
  '{"decision":"continue"|"stop","reason":"brief reason"}';

export const stallDetectorPrompt = `You are the Stall Detector for a linked Change.

The input separates all previous qualifying Validation Run Findings from the current Validation Run Findings under one unchanged Acceptance Context.
Previous Validation Runs are ordered oldest to newest.
Judge whether the current Run shows that correction work is looping or progressing.

\`continue\` means the current Findings are new correction work, a narrower follow-up, or evidence that earlier defects disappeared.

\`stop\` means the current Findings concretely repeat the same underlying defect at the same boundary, location, or consequence as an earlier Run, or show an equivalent or broader consequence of that defect.
Exact wording is not required for repetition.
A problem that recurs after different intervening Findings can show a loop.

Do not stop merely because reviews failed, Findings remain, Findings are serious, or earlier Runs conflict with each other.
Base a \`stop\` decision on concrete details that relate the current Finding to an earlier accepted constraint, observable defect or consequence, and location or boundary.
Temporal or evaluative wording in a Finding, including \`still\`, \`remain\`, \`again\`, \`recurring\`, \`equivalent\`, or \`broader\`, is not evidence of repetition by itself.

Return only:
${stallDetectorResponseContract}
Do not add fields.`;

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

const decodeResponse = (value: unknown, policy: StallDetectorPolicy) => {
  const contract = /^\{"decision":"([^"|]+)"\|"([^"|]+)","reason":"([^"]+)"\}$/u.exec(
    policy.responseContract,
  );
  if (contract === null) {
    throw new Error("The frozen Stall Detector response contract is invalid.");
  }
  const firstDecision = contract[1];
  const secondDecision = contract[2];
  if (
    (firstDecision !== "continue" && firstDecision !== "stop") ||
    (secondDecision !== "continue" && secondDecision !== "stop") ||
    firstDecision === secondDecision
  ) {
    throw new Error("The frozen Stall Detector response contract is invalid.");
  }
  const responseSchema = Schema.Struct({
    decision: Schema.Literal(firstDecision, secondDecision),
    reason: Schema.String.pipe(Schema.filter((reason) => reason.trim().length > 0)),
  });
  return Schema.decodeUnknownSync(responseSchema, {
    onExcessProperty: "error",
  })(value);
};

const requestContent = (input: StallDetectionInput) => {
  const current = input.runs.at(-1);
  return JSON.stringify({
    acceptanceContext: input.acceptanceContext,
    previousValidationRuns: input.runs.slice(0, -1).map((run) => ({
      findings: run.findings,
    })),
    currentValidationRun: { findings: current?.findings ?? [] },
  });
};

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
            const content = requestContent(input);
            const requestBytes = new TextEncoder().encode(
              `${input.policy.prompt}\n${content}`,
            ).byteLength;
            if (requestBytes > 262_144) {
              return {
                kind: "unavailable" as const,
                message:
                  "The complete Stall Detection history exceeds the 262144-byte request limit.",
              };
            }
            const response = await runtime.completeSimple(
              model,
              {
                systemPrompt: input.policy.prompt,
                messages: [{ role: "user", content, timestamp: 0 }],
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
            return { kind: "decision" as const, ...decodeResponse(JSON.parse(text), input.policy) };
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
