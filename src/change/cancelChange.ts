import { openCancellationUseCases as openTaskChangeCancellationUseCases } from "../taskChange/cancelTaskChange.js";
import type {
  CancellationDependencies,
  CancellationUseCases,
  ChangeCancellationResult,
  TaskCancellationResult,
} from "../taskChange/cancelTaskChange.js";

export const openCancellationUseCases = (
  dependencies: CancellationDependencies,
): CancellationUseCases => openTaskChangeCancellationUseCases(dependencies);

export type {
  CancellationDependencies,
  CancellationUseCases,
  ChangeCancellationResult,
  TaskCancellationResult,
};
