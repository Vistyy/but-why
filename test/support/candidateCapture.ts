import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import {
  openCandidateCapture,
  type CaptureLocalCandidateInput,
  type CaptureLocalCandidateResult,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import { localCandidateCaptureGit } from "../../src/change/candidateCapture/localGitCandidate.js";
import { repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";

export const captureLocalCandidate = (input: CaptureLocalCandidateInput) =>
  Effect.flatMap(localCandidateCaptureGit.readWorkspace(input.cwd), (workspace) => {
    if (!workspace.ok) return Effect.succeed<CaptureLocalCandidateResult>(workspace);
    const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: input.cwd,
      encoding: "utf8",
    });
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
