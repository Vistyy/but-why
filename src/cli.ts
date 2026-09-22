import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const run = (cwd: string, args: string[], timeout = 30_000): Promise<string> =>
  new Promise((ok, fail) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (s: string) => {
      out += s;
    });
    child.stderr.setEncoding("utf8").on("data", (s: string) => {
      err += s;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? ok(out.trimEnd())
        : fail(new Error(err.trim() || `git ${args[0]} failed (${code})`));
    });
  });
const exactCommit = async (cwd: string, ref: string) => {
  const sha = await run(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (sha !== ref) throw new Error(`Expected an exact commit SHA: ${ref}`);
  return sha;
};
const files = async (directory: string, origin: string) => {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const seen = new Set<string>();
  return Promise.all(
    names.map(async (name) => {
      const stem = name.slice(0, -3);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(stem) || seen.has(stem))
        throw new Error(`Invalid or duplicate ${origin} rule name: ${name}`);
      seen.add(stem);
      return {
        identity: `${origin}/${stem}`,
        provenance: join(directory, name),
        text: await readFile(join(directory, name), "utf8"),
      };
    }),
  );
};
async function rules(cwd: string, commit: string) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  let globalDir = join(agentDir, "but-why", "rules");
  try {
    const config = JSON.parse(
      await readFile(join(homedir(), ".config/but-why/config.json"), "utf8"),
    );
    if (typeof config.rulesDirectory === "string") globalDir = resolve(config.rulesDirectory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(`Invalid But Why global config: ${String(e)}`);
  }
  const global = await files(globalDir, "global");
  const project = await files(join(cwd, ".but-why/rules"), "project");
  if (!global.length && !project.length)
    throw new Error("No But Why rules found (global rules or .but-why/rules/*.md required)");
  return [...global, ...project];
}
const parse = (args: string[]) => {
  const mode = args.shift();
  if (!mode || !["change", "files", "repository"].includes(mode))
    throw new Error(
      "Usage: by review change --base SHA --head SHA | files --at SHA <paths...> | repository --at SHA",
    );
  const options: Record<string, string> = {};
  const paths: string[] = [];
  while (args.length) {
    const item = args.shift()!;
    if (item.startsWith("--")) {
      if (!(item === "--base" || item === "--head" || item === "--at") || options[item])
        throw new Error(`Invalid option: ${item}`);
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
      options[item] = value;
    } else paths.push(item);
  }
  if (
    (mode === "change" && (!options["--base"] || !options["--head"] || paths.length)) ||
    (mode !== "change" && (!options["--at"] || (mode === "repository" && paths.length))) ||
    (mode === "files" && !paths.length)
  )
    throw new Error("Invalid arguments for review mode");
  return { mode, options, paths };
};
export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  let temporary: string | undefined;
  let worktree: string | undefined;
  let repository = process.cwd();
  try {
    if (args.shift() !== "review")
      throw new Error("Usage: by review <change|files|repository> ...");
    const { mode, options, paths } = parse(args);
    repository = await run(repository, ["rev-parse", "--show-toplevel"]);
    let commit: string;
    let base: string | undefined;
    if (mode === "change") {
      base = await exactCommit(repository, options["--base"]!);
      commit = await exactCommit(repository, options["--head"]!);
    } else commit = await exactCommit(repository, options["--at"]!);
    if (mode === "files")
      for (const path of paths)
        if (path.startsWith("/") || path.split("/").includes(".."))
          throw new Error(`Invalid repository path: ${path}`);
    const selected =
      mode === "change"
        ? await run(repository, ["diff", "--name-only", "-z", `${base}...${commit}`])
        : mode === "files"
          ? paths.join("\n")
          : "(entire repository)";
    const ruleSet = await rules(repository, mode === "change" ? base! : commit);
    temporary = await mkdtemp(join(process.env.TMPDIR || "/tmp", "but-why-"));
    worktree = join(temporary, "review");
    await run(repository, ["worktree", "add", "--detach", worktree, commit]);
    const scope =
      mode === "change"
        ? `Change ${base}..${commit}\nChanged paths:\n${selected}`
        : mode === "files"
          ? `Files at ${commit}:\n${selected}`
          : `Repository at ${commit}`;
    const prompt = `Review the pinned code. Do not edit files or run the full test suite. Focused probes are allowed. Return unedited review prose.\n${scope}\nRules:\n${ruleSet.map((r) => `### ${r.identity} (${r.provenance})\n${r.text}`).join("\n")}`;
    const adapter = process.env.BUT_WHY_REVIEW_ADAPTER;
    let output: string;
    if (adapter) {
      const module = await import(pathToFileURL(resolve(adapter)).href);
      output = await module.review({ cwd: worktree, prompt, timeoutMs: 120_000 });
    } else {
      const pi = await import("@earendil-works/pi-coding-agent");
      const { session } = await pi.createAgentSession({
        cwd: worktree,
        sessionManager: pi.SessionManager.inMemory(),
        resourceLoader: new pi.DefaultResourceLoader({
          cwd: worktree,
          agentDir: join(temporary, "empty-agent"),
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt:
            "You are an independent code reviewer. Follow only the supplied review instructions.",
        }),
        tools: ["read", "grep", "find", "ls", "bash"],
      });
      await session.prompt(prompt);
      output = session.getLastAssistantText() ?? "";
    }
    console.log(
      JSON.stringify(
        {
          commits: base ? { base, head: commit } : { at: commit },
          mode,
          scope: selected,
          rules: ruleSet.map(({ identity, provenance }) => ({ identity, provenance })),
          reviews: [{ output, failure: null }],
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (worktree) {
      try {
        await run(repository, ["worktree", "remove", worktree]);
        worktree = undefined;
      } catch (error) {
        console.error(`Checkout cleanup failed; preserved at ${worktree}: ${String(error)}`);
      }
    }
    if (temporary && !worktree) await rm(temporary, { recursive: true, force: true });
  }
}
