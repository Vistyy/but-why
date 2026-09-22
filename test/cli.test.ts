import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Reviewer, runCli } from "../src/cli.js";
import { ReviewerActivityUncertain } from "../src/reviewers.js";

const roots: string[] = [];

const originalHome = process.env["HOME"];

const OutputSchema = Schema.fromJsonString(
  Schema.Struct({
    incomplete: Schema.Boolean,
    model: Schema.optional(Schema.String),
    requestedThinkingLevel: Schema.optional(Schema.String),
    thinkingLevel: Schema.optional(Schema.String),
    rules: Schema.optional(
      Schema.Array(
        Schema.Struct({
          identity: Schema.String,
          provenance: Schema.String,
          digest: Schema.String,
        }),
      ),
    ),
    reviews: Schema.optional(
      Schema.Array(
        Schema.Struct({
          output: Schema.NullOr(Schema.String),
          failure: Schema.NullOr(Schema.String),
        }),
      ),
    ),
    cleanupFailure: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
);

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "by-test-"));
  const home = await mkdtemp(join(tmpdir(), "by-config-home-"));
  roots.push(root, home);
  process.env["HOME"] = home;
  process.env["PI_CODING_AGENT_DIR"] = join(root, "agent");
  await mkdir(join(root, "agent"), { recursive: true });
  await mkdir(join(home, ".config", "but-why"), { recursive: true });
  await writeFile(
    join(home, ".config", "but-why", "config.json"),
    JSON.stringify({ model: "fixture/model" }),
  );

  const run = async (...args: string[]) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");

    return promisify(execFile)("git", args, { cwd: root });
  };

  await run("init", "-q");
  await run("config", "user.email", "test@example.com");
  await run("config", "user.name", "Test");
  await writeFile(join(root, "code.ts"), "export const old = 1;\n");
  await mkdir(join(root, ".but-why/rules"), { recursive: true });
  await writeFile(join(root, ".but-why/rules/check.md"), "PINNED BASE POLICY\n");
  await run("add", ".");
  await run("commit", "-qm", "base");
  const base = (await run("rev-parse", "HEAD")).stdout.trim();

  return { root, home, run, base };
}

async function execute(root: string, args: string[], reviewer?: Reviewer) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const status = await runCli(args, reviewer, root);

  const value = await Effect.runPromise(
    Schema.decodeEffect(OutputSchema)(String(log.mock.calls[0]?.[0])),
  );

  log.mockRestore();

  return { status, value };
}

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env["PI_CODING_AGENT_DIR"];

  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("standalone reviewer", () => {
  it("pins project rules to base and supplies direct change paths and diff", async () => {
    const r = await repo();
    await writeFile(join(r.root, ".but-why/rules/check.md"), "LIVE MUTATED POLICY\n");
    await writeFile(join(r.root, "code.ts"), "export const next = 2;\n");
    await r.run("add", ".");
    await r.run("commit", "-qm", "head");
    const head = (await r.run("rev-parse", "HEAD")).stdout.trim();

    const got = await execute(
      r.root,
      ["review", "change", "--base", r.base, "--head", head],
      async ({ prompt }) => prompt,
    );

    expect(got.status).toBe(0);
    const prose = got.value.reviews?.[0]?.output;
    expect(prose).toContain("PINNED BASE POLICY");
    expect(prose?.split("Rule project/check (")[1]).not.toContain("LIVE MUTATED POLICY");
    expect(prose).toContain("code.ts");
    expect(prose).toContain("export const next = 2");
  });
  it("uses configured model and thinking defaults with per-review overrides", async () => {
    const r = await repo();
    const args = ["review", "repository", "--at", r.base];
    const reviewer: Reviewer = async () => "reviewed";

    const configured = await execute(r.root, args, reviewer);
    expect(configured.status).toBe(0);
    expect(configured.value.model).toBe("fixture/model");
    expect(configured.value.requestedThinkingLevel).toBe("medium");
    expect(configured.value.thinkingLevel).toBeUndefined();

    await writeFile(
      join(r.home, ".config", "but-why", "config.json"),
      JSON.stringify({ model: "fixture/model", thinkingLevel: "high" }),
    );
    const configuredLevel = await execute(r.root, args, reviewer);
    expect(configuredLevel.value.requestedThinkingLevel).toBe("high");

    const overridden = await execute(
      r.root,
      [...args, "--model", "other/model", "--thinking-level", "low"],
      reviewer,
    );

    expect(overridden.status).toBe(0);
    expect(overridden.value.model).toBe("other/model");
    expect(overridden.value.requestedThinkingLevel).toBe("low");

    const invalidLevel = await execute(r.root, [...args, "--thinking-level", "ultra"], reviewer);
    expect(invalidLevel.status).toBe(1);
    expect(invalidLevel.value.error).toContain("Thinking level must be");

    await writeFile(join(r.home, ".config", "but-why", "config.json"), "{}");
    const absent = await execute(r.root, args, reviewer);
    expect(absent.status).toBe(1);
    expect(absent.value.error).toContain("Choose a reviewer model");

    const malformed = await execute(r.root, [...args, "--model", "not-a-slug"], reviewer);
    expect(malformed.status).toBe(1);
    expect(malformed.value.error).toContain("exact provider/model-id");

    await writeFile(
      join(r.home, ".config", "but-why", "config.json"),
      JSON.stringify({ model: "fixture/model", extensions: ["./project-extension.ts"] }),
    );
    const relative = await execute(r.root, args, reviewer);
    expect(relative.status).toBe(1);
    expect(relative.value.error).toContain(
      "extensions must be absolute paths or Pi package references",
    );
  });

  it("reports Pi's effective thinking level before starting reviewers", async () => {
    const r = await repo();
    const previousKey = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "by-test-not-a-real-key";

    try {
      await writeFile(
        join(r.home, ".config", "but-why", "config.json"),
        JSON.stringify({
          model: "openai/gpt-4.1-mini",
          thinkingLevel: "high",
          extensions: [join(r.root, "missing-extension.ts")],
        }),
      );
      const got = await execute(r.root, ["review", "repository", "--at", r.base]);
      expect(got.status).toBe(1);
      expect(got.value.model).toBe("openai/gpt-4.1-mini");
      expect(got.value.requestedThinkingLevel).toBe("high");
      expect(got.value.thinkingLevel).toBe("off");
      expect(got.value.error).toContain("No Pi extension found");
      expect(
        (await r.run("worktree", "list", "--porcelain")).stdout.match(/\nworktree /g),
      ).toBeNull();
    } finally {
      if (previousKey === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = previousKey;
    }
  });

  it("rejects an unknown Pi model before creating a reviewer checkout", async () => {
    const r = await repo();

    const got = await execute(r.root, [
      "review",
      "repository",
      "--at",
      r.base,
      "--model",
      "missing-review-provider/unknown-model",
    ]);

    expect(got.status).toBe(1);
    expect(got.value.model).toBe("missing-review-provider/unknown-model");
    expect(got.value.error).toContain("Unknown reviewer model");
    expect(got.value.cleanupFailure).toBeUndefined();
    expect(
      (await r.run("worktree", "list", "--porcelain")).stdout.match(/\nworktree /g),
    ).toBeNull();
  });

  it("bounds a large valid change diff without rejecting the review", async () => {
    const r = await repo();
    await writeFile(join(r.root, "code.ts"), `export const large = "${"x".repeat(180_000)}";\n`);
    await r.run("add", "code.ts");
    await r.run("commit", "-qm", "large change");
    const head = (await r.run("rev-parse", "HEAD")).stdout.trim();

    const got = await execute(
      r.root,
      ["review", "change", "--base", r.base, "--head", head],
      async ({ prompt }) => prompt,
    );

    expect(got.status).toBe(0);
    expect(got.value.reviews?.[0]?.output).toContain("[Diff truncated after");
    expect(got.value.reviews?.[0]?.output).toContain("code.ts");
  });

  it("rejects traversal and absent audited paths", async () => {
    const r = await repo();
    const review = async () => "";
    expect(
      (await execute(r.root, ["review", "files", "--at", r.base, "../escape"], review)).status,
    ).toBe(1);
    expect(
      (await execute(r.root, ["review", "files", "--at", r.base, "absent.ts"], review)).status,
    ).toBe(1);
    expect(
      (await execute(r.root, ["review", "repository", "--at", r.base, "extra"], review)).status,
    ).toBe(1);
  });
  it("isolates reviewer failure and bounds concurrent reviewers", async () => {
    const r = await repo();
    await writeFile(join(r.root, ".but-why/rules/a.md"), "A\n");
    await writeFile(join(r.root, ".but-why/rules/b.md"), "B\n");
    await writeFile(join(r.root, ".but-why/rules/c.md"), "C\n");
    await r.run("add", ".");
    await r.run("commit", "-qm", "rules");
    const at = (await r.run("rev-parse", "HEAD")).stdout.trim();
    let running = 0;
    let maximum = 0;

    const reviewer: Reviewer = async ({ prompt }) => {
      running++;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      running--;

      if (prompt.includes("project/a")) throw new Error("one failed");

      return "completed";
    };

    const got = await execute(r.root, ["review", "repository", "--at", at], reviewer);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(got.status).toBe(1);
    expect(got.value.reviews?.filter(({ output }) => output !== null)).toHaveLength(3);
    expect(got.value.reviews?.some(({ failure }) => failure === "one failed")).toBe(true);
  });
  it("reports both global and pinned project rules separately", async () => {
    const r = await repo();
    const global = join(r.root, "agent", "but-why", "rules");
    await mkdir(global, { recursive: true });
    await writeFile(join(global, "check.md"), "GLOBAL RULE\n");

    const got = await execute(
      r.root,
      ["review", "repository", "--at", r.base],
      async () => "completed",
    );

    expect(got.status).toBe(0);
    expect(got.value.rules?.map(({ identity }) => identity)).toEqual([
      "global/check",
      "project/check",
    ]);
    expect(got.value.rules?.[0]?.provenance).toBe(join(global, "check.md"));
    expect(got.value.rules?.[1]?.provenance).toContain(`${r.base}:.but-why/rules/check.md`);
    expect(got.value.rules?.every(({ digest }) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
    expect(got.value.reviews?.map(({ output }) => output)).toEqual(["completed", "completed"]);

    const alternate = join(r.home, "alternate-rules");
    await mkdir(alternate);
    await writeFile(join(alternate, "other.md"), "ANOTHER RULE\n");
    await writeFile(
      join(r.home, ".config", "but-why", "config.json"),
      JSON.stringify({ model: "fixture/model", rulesDirectory: alternate }),
    );

    const overridden = await execute(
      r.root,
      ["review", "repository", "--at", r.base],
      async () => "completed",
    );

    expect(overridden.value.rules?.map(({ identity }) => identity)).toEqual([
      "global/other",
      "project/check",
    ]);
    expect(overridden.value.rules?.[0]?.provenance).toBe(join(alternate, "other.md"));
  });

  it("preserves a checkout when its Git registration stops being detached", async () => {
    const r = await repo();

    const reviewer: Reviewer = async ({ cwd }) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("git", ["switch", "-c", "registration-changed"], { cwd });

      return "reviewed";
    };

    const got = await execute(r.root, ["review", "repository", "--at", r.base], reviewer);
    expect(got.status).toBe(1);
    expect(got.value.cleanupFailure).toContain("Git registration is absent or changed");
    const path = got.value.cleanupFailure?.match(/Preserved checkout (.*?):/)?.[1];

    if (path === undefined) throw new Error("Expected preserved checkout path");

    await r.run("worktree", "remove", path);
    await rm(dirname(path), { recursive: true });
  });

  it("preserves a checkout when the Pi adapter cannot prove its activity settled", async () => {
    const r = await repo();

    const got = await execute(r.root, ["review", "repository", "--at", r.base], () =>
      Promise.reject(new ReviewerActivityUncertain({ message: "still active" })),
    );

    expect(got.status).toBe(1);
    expect(got.value.cleanupFailure).toContain("Reviewer may still be running");
    const path = got.value.cleanupFailure?.match(/Preserved checkout (.*?):/)?.[1];

    if (path === undefined) throw new Error("Expected preserved checkout path");

    await r.run("worktree", "remove", path);
    await rm(dirname(path), { recursive: true });
  });

  it("preserves ignored files created in the reviewer checkout", async () => {
    const r = await repo();
    await writeFile(join(r.root, ".gitignore"), "output.cache\n");
    await r.run("add", ".gitignore");
    await r.run("commit", "-qm", "ignore fixture output");
    const head = (await r.run("rev-parse", "HEAD")).stdout.trim();

    const reviewer: Reviewer = async ({ cwd }) => {
      await writeFile(join(cwd, "output.cache"), "preserve ignored output");

      return "done";
    };

    const got = await execute(r.root, ["review", "repository", "--at", head], reviewer);
    expect(got.status).toBe(1);
    expect(got.value.cleanupFailure).toContain("Worktree is dirty: !! output.cache");
    const path = got.value.cleanupFailure?.match(/Preserved checkout (.*?):/)?.[1];

    if (path === undefined) throw new Error("Expected preserved checkout path");

    expect(await readFile(join(path, "output.cache"), "utf8")).toBe("preserve ignored output");
    await rm(join(path, "output.cache"));
    await r.run("worktree", "remove", path);
    await rm(dirname(path), { recursive: true });
  });

  it("does not recursively delete unexpected files beside the checkout", async () => {
    const r = await repo();

    const reviewer: Reviewer = async ({ cwd }) => {
      await writeFile(join(dirname(cwd), "unrelated"), "keep this file");

      return "done";
    };

    const got = await execute(r.root, ["review", "repository", "--at", r.base], reviewer);
    expect(got.status).toBe(1);
    expect(got.value.cleanupFailure).toContain("temporary directory cleanup failed");
    const directory = got.value.cleanupFailure?.match(/\((\/tmp\/but-why-[^)]+)\)/)?.[1];

    if (directory === undefined) throw new Error("Expected retained temporary directory");

    expect(await readFile(join(directory, "unrelated"), "utf8")).toBe("keep this file");
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves and reports a dirty task-owned checkout", async () => {
    const r = await repo();
    const at = r.base;

    const reviewer: Reviewer = async ({ cwd }) => {
      await writeFile(join(cwd, "intrusion"), "dirty");

      return "done";
    };

    const got = await execute(r.root, ["review", "repository", "--at", at], reviewer);
    expect(got.status).toBe(1);
    expect(got.value.cleanupFailure).toContain("Checkout integrity changed");
    const path = got.value.cleanupFailure?.match(/Preserved checkout (.*?):/)?.[1];

    if (path === undefined) throw new Error("Expected preserved checkout path");
    expect(await readFile(join(path, "intrusion"), "utf8")).toBe("dirty");
    await rm(join(path, ".."), { recursive: true, force: true });
  });
});
