import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import {
  openChangeCandidateCapture,
  type CaptureLocalCandidateInput,
  type CaptureLocalCandidateResult,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import { localChangeCandidateCaptureGit } from "../../src/change/candidateCapture/localGitCandidate.js";
import { repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeCandidateCapturePersistence } from "../../src/sqlite/sqliteChangeCandidateCapturePersistence.js";

export const captureLocalCandidate = (input: CaptureLocalCandidateInput) =>
  Effect.flatMap(localChangeCandidateCaptureGit.readWorkspace(input.cwd), (workspace) => {
    if (!workspace.ok) return Effect.succeed<CaptureLocalCandidateResult>(workspace);
    const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: input.cwd,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return Effect.succeed<CaptureLocalCandidateResult>({ ok: false, code: "git_tooling_error" });
    }
    const commonDirectory = realpathSync(result.stdout.trim());
    const program = Effect.flatMap(openSqliteChangeCandidateCapturePersistence(), (persistence) =>
      openChangeCandidateCapture({
        persistence,
        git: localChangeCandidateCaptureGit,
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
