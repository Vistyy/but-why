import { describe, expect, it } from "vitest";

import {
  herdrSessionName,
  openHerdrInteractiveSessionHost,
} from "../src/change/herdrInteractiveSessionHost.js";

// Set HERDR_SMOKE_WORKTREE to an existing ready Managed Worktree after starting Herdr.
// biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
const smokeWorktree = process.env["HERDR_SMOKE_WORKTREE"];
const smokeChangeId = "herdr-smoke-change";
// biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
const smokeRepository = process.env["HERDR_SMOKE_REPOSITORY"];
// biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
const smokePath = process.env["HERDR_SMOKE_PATH"];

const smoke = smokeWorktree === undefined || smokeRepository === undefined ? it.skip : it;

describe("Herdr smoke", () => {
  smoke(
    "opens an existing worktree once under its stable session name",
    async () => {
      const host = openHerdrInteractiveSessionHost(undefined, {
        ...(smokePath === undefined ? {} : { path: smokePath }),
      });
      const first = await host.launch({
        changeId: smokeChangeId,
        repositoryPath: smokeRepository as string,
        worktreePath: smokeWorktree as string,
        initialPrompt: "Verify the Herdr Change Implement smoke test, then stop.",
      });
      const second = await host.launch({
        changeId: smokeChangeId,
        repositoryPath: smokeRepository as string,
        worktreePath: smokeWorktree as string,
        initialPrompt: undefined,
      });

      expect(first, JSON.stringify(first)).toMatchObject({ ok: true, host: "herdr" });
      expect(second).toEqual({ ok: true, host: "herdr", status: "already_active" });
      expect(herdrSessionName(smokeChangeId)).toBe("but-why-herdr-smoke-change");
    },
    30_000,
  );
});
