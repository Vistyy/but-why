import { Data, Effect, Schema } from "effect";
import {
  type ContractDiagnostic,
  contractDiagnostics,
  formatContractDiagnostics,
} from "../../contracts/contractDiagnostics.js";
import { reviewerFindingCoreSchema } from "../../contracts/reviewerFinding.js";

class TaskReviewerOutputContractFailed extends Data.TaggedError(
  "TaskReviewerOutputContractFailed",
)<{
  readonly operationName: string;
  readonly reviewer: "task";
  readonly attempts: number;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}

const taskReviewerOutputSchema = Schema.Struct({
  findings: Schema.Array(reviewerFindingCoreSchema),
});

export type TaskReviewerOutput = Schema.Schema.Type<typeof taskReviewerOutputSchema>;

export const decodeTaskReviewerOutput = (input: {
  readonly attempts: number;
  readonly output: unknown;
}): Effect.Effect<TaskReviewerOutput, TaskReviewerOutputContractFailed> =>
  Schema.decodeUnknown(taskReviewerOutputSchema, { onExcessProperty: "error" })(input.output).pipe(
    Effect.mapError((error) => {
      const diagnostics = contractDiagnostics(error, input.output);
      return new TaskReviewerOutputContractFailed({
        operationName: "decode_task_reviewer_output",
        reviewer: "task",
        attempts: input.attempts,
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      });
    }),
  );
