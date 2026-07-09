import { Data } from "effect";

import type { ContractDiagnostic } from "./contractDiagnostics.js";

export class RepoConfigValidationFailed extends Data.TaggedError("RepoConfigValidationFailed")<{
  readonly path?: string;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}

export class GlobalConfigValidationFailed extends Data.TaggedError("GlobalConfigValidationFailed")<{
  readonly path?: string;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly message: string;
}> {}
