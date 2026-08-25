import { Data, Effect } from "effect";
import type { ContractDiagnostic } from "../../contracts/contractDiagnostics.js";
import {
  decodeTaskSimplificationAdvice,
  type TaskSimplificationAdvice,
} from "./taskSimplificationAdvice.js";

class TaskSimplificationAdviceOutputContractFailed extends Data.TaggedError(
  "TaskSimplificationAdviceOutputContractFailed",
)<{
  readonly operationName: "decode_task_simplification_advice_output";
  readonly reviewer: "underengineer";
  readonly attempts: number;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
}> {}

export type TaskSimplificationAdviceOutput = TaskSimplificationAdvice;

export const decodeTaskSimplificationAdviceOutput = (input: {
  readonly attempts: number;
  readonly output: unknown;
}): Effect.Effect<TaskSimplificationAdviceOutput, TaskSimplificationAdviceOutputContractFailed> =>
  Effect.try({
    try: () => decodeTaskSimplificationAdvice(input.output),
    catch: (cause) =>
      new TaskSimplificationAdviceOutputContractFailed({
        operationName: "decode_task_simplification_advice_output",
        reviewer: "underengineer",
        attempts: input.attempts,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
