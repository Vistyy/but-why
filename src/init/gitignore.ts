import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const butWhyGitignoreBlock = `# But Why?\n.but-why/state.sqlite\n.but-why/state.sqlite-*\n.but-why/artifacts/\n.sandcastle/worktrees/\n.sandcastle/logs/\n.sandcastle/patches/\n.sandcastle/.env`;

export const ensureGitignoreBlock = (path: string): boolean => {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const normalized = normalizeGitignore(original);

  if (normalized === original) {
    return false;
  }

  writeFileSync(path, normalized);
  return true;
};

const normalizeGitignore = (content: string): string => {
  const contentWithoutBlock = removeExistingBlocks(content).trimEnd();

  if (contentWithoutBlock.length === 0) {
    return `${butWhyGitignoreBlock}\n`;
  }

  return `${contentWithoutBlock}\n\n${butWhyGitignoreBlock}\n`;
};

const removeExistingBlocks = (content: string): string => {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const keptLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "# But Why?") {
      while (isManagedStateLine(lines[index + 1])) {
        index += 1;
      }

      if (lines[index + 1] === "" && keptLines.at(-1) === "") {
        index += 1;
      }

      continue;
    }

    keptLines.push(lines[index] ?? "");
  }

  return keptLines.join("\n");
};

const isManagedStateLine = (line: string | undefined): boolean =>
  line === ".but-why/state.sqlite" ||
  line === ".but-why/state.sqlite-*" ||
  line === ".but-why/artifacts/" ||
  line === ".sandcastle/worktrees/" ||
  line === ".sandcastle/logs/" ||
  line === ".sandcastle/patches/" ||
  line === ".sandcastle/.env";
