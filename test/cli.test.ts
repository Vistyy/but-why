import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Reviewer, runCli } from "../src/cli.js";

const roots: string[] = [];
async function repo() {
  const root = await mkdtemp(join(tmpdir(), "by-test-"));
  roots.push(root);
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  await mkdir(join(root, "agent"), { recursive: true });
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
  return { root, run, base };
}
async function execute(root: string, args: string[], reviewer: Reviewer) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const status = await runCli(args, reviewer, root);
  const value = JSON.parse(String(log.mock.calls[0]?.[0]));
  log.mockRestore();
  return { status, value };
}
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.PI_CODING_AGENT_DIR;
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
    expect(got.value.reviews[0].output).toContain("PINNED BASE POLICY");
    expect(
      got.value.reviews[0].output.slice(got.value.reviews[0].output.indexOf("Rule project/check")),
    ).toContain("PINNED BASE POLICY");
    expect(got.value.reviews[0].output).toContain("code.ts");
    expect(got.value.reviews[0].output).toContain("export const next = 2");
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
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      if (prompt.includes("project/a")) throw new Error("one failed");
      return "completed";
    };
    const got = await execute(r.root, ["review", "repository", "--at", at], reviewer);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(got.status).toBe(1);
    expect(got.value.reviews.filter((x: { output: string | null }) => x.output).length).toBe(3);
    expect(
      got.value.reviews.some((x: { failure: string | null }) => x.failure === "one failed"),
    ).toBe(true);
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
    const path = String(got.value.cleanupFailure).match(/Preserved checkout (.*?):/)?.[1];
    if (!path) throw new Error("Expected preserved checkout path");
    expect(await readFile(join(path, "intrusion"), "utf8")).toBe("dirty");
    await rm(join(path, ".."), { recursive: true, force: true });
  });
});
