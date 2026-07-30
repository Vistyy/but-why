import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export const collapseHome = (executablePath: string): string => {
  const absolutePath = resolve(executablePath);
  const homePath = homedir();

  if (absolutePath === homePath) return "~";
  if (absolutePath.startsWith(`${homePath}${sep}`)) {
    return `~${absolutePath.slice(homePath.length)}`;
  }
  return absolutePath;
};
