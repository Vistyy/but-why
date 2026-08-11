import { Data } from "effect";

export type WorkspaceCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class WorkspaceCommandExecutionFailed extends Data.TaggedError(
  "WorkspaceCommandExecutionFailed",
)<{
  readonly message: string;
}> {}

export type WorkspaceCommandExecutor = (
  command: string,
  options?: { readonly cwd?: string },
) => Promise<WorkspaceCommandResult>;
