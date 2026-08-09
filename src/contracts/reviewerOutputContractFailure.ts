import { Data } from "effect";

import type { ContractDiagnostic } from "./contractDiagnostics.js";

export class ReviewerOutputContractFailed extends Data.TaggedError("ReviewerOutputContractFailed")<{
  readonly operationName: string;
  readonly reviewer: string;
  readonly attempts: number;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}
