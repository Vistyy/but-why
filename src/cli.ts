import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { reviewWithPi } from "./piReviewer.js";

const MAX_GIT = 160_000;
const REVIEW_MS = 120_000;
const cleanError = (error: unknown) => (error instanceof Error ? error.message : String(error));
async function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGKILL");
    }, 30_000);
    child.stdout.setEncoding("utf8").on("data", (part: string) => {
      output += part;
      if (output.length > MAX_GIT) {
        stopped = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.setEncoding("utf8").on("data", (part: string) => {
      error = (error + part).slice(0, 2000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(new Error(`git ${args[0]}: ${cleanError(e)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stopped || code !== 0)
        fail(
          new Error(
            `git ${args[0]} failed: ${stopped ? "limit or timeout exceeded" : error.trim().slice(0, 500) || code}`,
          ),
        );
      else ok(output);
    });
  });
}
const shaPattern = /^[a-fA-F0-9]{40,64}$/;
async function commit(cwd: string, value: string): Promise<string> {
  if (!shaPattern.test(value)) throw new Error(`Expected full commit SHA: ${value.slice(0, 80)}`);
  const resolved = (await git(cwd, ["rev-parse", "--verify", `${value}^{commit}`])).trim();
  if (resolved !== value.toLowerCase())
    throw new Error(`Not an exact commit SHA: ${value.slice(0, 80)}`);
  return resolved;
}
function parse(input: string[]) {
  const [command, mode, ...rest] = input;
  if (command !== "review" || !["change", "files", "repository"].includes(mode ?? ""))
    throw new Error(
      "Usage: by review change --base SHA --head SHA | by review files --at SHA <paths...> | by review repository --at SHA",
    );
  const options: Record<string, string> = {};
  const paths: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const allowed = mode === "change" ? ["--base", "--head"] : ["--at"];
      if (!allowed.includes(arg) || options[arg]) throw new Error(`Invalid option: ${arg}`);
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg] = value;
    } else {
      if (arg.startsWith("-") || mode !== "files") throw new Error(`Unexpected argument: ${arg}`);
      paths.push(arg);
    }
  }
  if (
    mode === "change"
      ? !options["--base"] || !options["--head"]
      : !options["--at"] || (mode === "files" && !paths.length)
  )
    throw new Error("Missing review arguments");
  return { mode: mode as "change" | "files" | "repository", options, paths };
}
function required(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`Missing value for ${key}`);
  return value;
}
function validPath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
type Rule = { identity: string; provenance: string; text: string };
async function ruleSet(cwd: string, pinned: string): Promise<Rule[]> {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  let directory = join(agentDir, "but-why", "rules");
  try {
    const config = JSON.parse(
      await readFile(join(homedir(), ".config/but-why/config.json"), "utf8"),
    );
    if (config.rulesDirectory !== undefined) {
      if (typeof config.rulesDirectory !== "string" || !isAbsolute(config.rulesDirectory))
        throw new Error("rulesDirectory must be absolute");
      directory = resolve(config.rulesDirectory);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(`Invalid global config: ${cleanError(e)}`);
  }
  const rules: Rule[] = [];
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    names = [];
  }
  for (const name of names) {
    const stem = name.slice(0, -3);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(stem))
      throw new Error(`Invalid global rule name: ${name}`);
    const path = join(directory, name);
    if (!(await stat(path)).isFile()) throw new Error(`Not a regular rule: ${path}`);
    rules.push({
      identity: `global/${name.slice(0, -3)}`,
      provenance: path,
      text: await readFile(path, "utf8"),
    });
  }
  const entries = (await git(cwd, ["ls-tree", "-r", "-z", pinned, "--", ".but-why/rules"]))
    .split("\0")
    .filter(Boolean);
  for (const entry of entries) {
    const match = /^100(?:644|755) blob [a-f0-9]+\t(.+)$/u.exec(entry);
    if (!match) continue;
    const path = match[1];
    if (!path) continue;
    if (!/^\.but-why\/rules\/[^/]+\.md$/u.test(path)) continue;
    const stem = path.slice(".but-why/rules/".length, -3);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(stem))
      throw new Error(`Invalid project rule name: ${path}`);
    rules.push({
      identity: `project/${stem}`,
      provenance: `${pinned}:${path}`,
      text: await git(cwd, ["show", `${pinned}:${path}`]),
    });
  }
  if (!rules.length) throw new Error("No rules found (global or project .but-why/rules/*.md)");
  return rules;
}
export type Reviewer = (input: {
  cwd: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<string>;
type Review = {
  identity: string;
  provenance: string;
  output: string | null;
  failure: string | null;
};
async function inspect(cwd: string, sha: string): Promise<string> {
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const dirty = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return head === sha && dirty === "" ? "" : `HEAD=${head}, status=${dirty.slice(0, 500)}`;
}
async function reviews(
  rules: Rule[],
  cwd: string,
  scope: string,
  reviewer: Reviewer,
  signal: AbortSignal,
) {
  const results: Review[] = Array.from({ length: rules.length });
  let next = 0;
  let uncertain = false;
  await Promise.all(
    Array.from({ length: Math.min(3, rules.length) }, async () => {
      while (next < rules.length && !signal.aborted) {
        const index = next++;
        const rule = rules[index];
        if (!rule) continue;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        let settled = false;
        const task = Promise.resolve()
          .then(() =>
            reviewer({
              cwd,
              signal: controller.signal,
              prompt: `Review pinned code in this checkout. Do not edit files or run the full test suite; focused probes are allowed. Inspect related code as needed. Report every substantiated encounter with this rule in concise prose. Do not silently filter findings.\n\n${scope}\n\nRule ${rule.identity} (${rule.provenance}):\n${rule.text}`,
            }),
          )
          .then(
            (output) => {
              settled = true;
              return output;
            },
            (e: unknown) => {
              settled = true;
              throw e;
            },
          );
        let timer: NodeJS.Timeout | undefined;
        try {
          const interrupted = new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("Reviewer interrupted")),
              { once: true },
            ),
          );
          const output = await Promise.race([
            task,
            interrupted,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Reviewer timed out"));
              }, REVIEW_MS);
            }),
          ]);
          results[index] = {
            identity: rule.identity,
            provenance: rule.provenance,
            output,
            failure: null,
          };
        } catch (e) {
          controller.abort();
          if (!settled) {
            await Promise.race([
              task.catch(() => undefined),
              new Promise((done) => setTimeout(done, 2000)),
            ]);
            if (!settled) uncertain = true;
          }
          results[index] = {
            identity: rule.identity,
            provenance: rule.provenance,
            output: null,
            failure: cleanError(e).slice(0, 500),
          };
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        }
      }
    }),
  );
  for (let i = 0; i < rules.length; i++)
    if (!results[i]) {
      const rule = rules[i];
      if (rule)
        results[i] = {
          identity: rule.identity,
          provenance: rule.provenance,
          output: null,
          failure: "Interrupted before start",
        };
    }
  return { results, uncertain };
}
export async function runCli(
  args: string[] = process.argv.slice(2),
  reviewer: Reviewer = reviewWithPi,
  cwd = process.cwd(),
): Promise<number> {
  let result: Record<string, unknown> = { incomplete: true };
  let repository = cwd;
  let temporary: string | undefined;
  let worktree: string | undefined;
  let owned = false;
  let expected = "";
  let uncertain = false;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { mode, options, paths } = parse(args);
    repository = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const base =
      mode === "change" ? await commit(repository, required(options, "--base")) : undefined;
    expected = await commit(
      repository,
      mode === "change" ? required(options, "--head") : required(options, "--at"),
    );
    let scope: string;
    if (mode === "change") {
      const baseSha = base;
      if (!baseSha) throw new Error("Missing base commit");
      const changed = (
        await git(repository, ["diff", "--name-only", "--no-ext-diff", baseSha, expected, "--"])
      ).trim();
      const diff = await git(repository, ["diff", "--no-ext-diff", baseSha, expected, "--"]);
      scope = `Change ${base}..${expected}\nChanged paths:\n${changed || "(none)"}\nDiff:\n${diff || "(none)"}`;
    } else if (mode === "files") {
      const listed: string[] = [];
      for (const path of paths) {
        if (!validPath(path)) throw new Error(`Invalid repository path: ${path}`);
        const entry = await git(repository, ["ls-tree", "-z", expected, "--", path]);
        if (!entry.startsWith("100644 blob ") && !entry.startsWith("100755 blob "))
          throw new Error(`Not a regular file at ${expected}: ${path}`);
        const found = entry.split("\t")[1]?.split("\0")[0];
        if (found !== path || entry.split("\0").filter(Boolean).length !== 1)
          throw new Error(`Not an exact file at ${expected}: ${path}`);
        listed.push(path);
      }
      scope = `Files at ${expected}:\n${listed.join("\n")}\nInspect these files and related code.`;
    } else scope = `Repository at ${expected}: inspect the repository.`;
    const rules = await ruleSet(repository, base ?? expected);
    result = {
      mode,
      commits: base ? { base, head: expected } : { at: expected },
      scope,
      rules: rules.map(({ identity, provenance }) => ({ identity, provenance })),
      reviews: [],
      incomplete: true,
    };
    temporary = await mkdtemp(join(tmpdir(), "but-why-"));
    worktree = join(temporary, "review");
    await git(repository, ["worktree", "add", "--detach", worktree, expected]);
    owned = true;
    const before = await inspect(worktree, expected);
    if (before) throw new Error(`Checkout integrity before review: ${before}`);
    const reviewed = await reviews(rules, worktree, scope, reviewer, controller.signal);
    result.reviews = reviewed.results;
    uncertain = reviewed.uncertain;
    if (reviewed.results.some((r) => r.failure)) result.error = "One or more reviewers failed";
  } catch (e) {
    result.error = cleanError(e).slice(0, 1000);
  } finally {
    if (worktree) {
      let problem: string | undefined;
      let removed = false;
      if (!owned || uncertain)
        problem = uncertain ? "Reviewer may still be running" : "Worktree add outcome uncertain";
      if (!problem) {
        const dirty = await inspect(worktree, expected).catch(
          (e: unknown) => `Integrity check failed: ${cleanError(e)}`,
        );
        if (dirty) problem = `Checkout integrity changed: ${dirty}`;
      }
      if (!problem) {
        try {
          await git(repository, ["worktree", "remove", worktree]);
          try {
            await stat(worktree);
            problem = "Worktree still exists after removal";
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") removed = true;
            else problem = cleanError(e);
          }
          if (!problem && removed && temporary) await rm(temporary, { recursive: true });
        } catch (e) {
          problem = cleanError(e);
        }
      }
      if (problem)
        result.cleanupFailure = removed
          ? `Checkout removed but temporary directory cleanup failed (${temporary}): ${problem}`
          : `Preserved checkout ${worktree}: ${problem}`;
    } else if (temporary)
      await rm(temporary, { recursive: true }).catch((e: unknown) => {
        result.cleanupFailure = cleanError(e);
      });
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  if (controller.signal.aborted) result.error = "Interrupted";
  result.incomplete = Boolean(result.error || result.cleanupFailure);
  console.log(JSON.stringify(result));
  return result.incomplete ? 1 : 0;
}
