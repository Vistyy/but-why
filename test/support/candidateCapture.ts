import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { openSqliteCandidateCapturePersistence } from "../../src/change/adapters/sqlite/sqliteCandidateCapturePersistence.js";
import { localCandidateCaptureGit } from "../../src/change/candidateCapture/adapters/localGitCandidate.js";
import {
  type CaptureLocalCandidateInput,
  type CaptureLocalCandidateResult,
  openCandidateCapture,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import { repositorySqlLayer } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { runTestProcess } from "./testProcess.js";

export const captureLocalCandidate = (input: CaptureLocalCandidateInput) =>
  Effect.flatMap(localCandidateCaptureGit.readWorkspace(input.cwd), (workspace) => {
    if (!workspace.ok) return Effect.succeed<CaptureLocalCandidateResult>(workspace);
    const result = runTestProcess(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: input.cwd },
    );
    if (result.status !== 0) {
      return Effect.succeed<CaptureLocalCandidateResult>({ ok: false, code: "git_tooling_error" });
    }
    const commonDirectory = realpathSync(result.stdout.trim());
    const program = Effect.flatMap(openSqliteCandidateCapturePersistence(), (persistence) =>
      openCandidateCapture({
        persistence,
        git: localCandidateCaptureGit,
      }).capture(input),
    );

    return Effect.scoped(
      program.pipe(
        Effect.provide(
          repositorySqlLayer({
            commonDirectory,
            statePath: join(commonDirectory, "but-why", "state.sqlite"),
          }),
        ),
      ),
    );
  });
