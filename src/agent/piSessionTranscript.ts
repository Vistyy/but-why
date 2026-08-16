import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { decodePiJsonlObject, decodePiSessionHeader, isPiSessionRecord } from "./piJsonl.js";

export const findUniquePiSessionTranscript = (
  root: string,
  sessionId: string,
): string | undefined => {
  let rootStat: ReturnType<typeof statSync>;
  try {
    rootStat = statSync(root);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Reviewer Session storage root "${root}" is not a directory.`);
  }
  const matches = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(root, entry.name))
    .filter((path) => hasSessionHeader(path, sessionId));
  if (matches.length > 1) {
    throw new Error(`Multiple Reviewer Session transcripts have id "${sessionId}".`);
  }
  return matches[0];
};

const hasSessionHeader = (path: string, sessionId: string): boolean => {
  let firstLine: string | undefined;
  try {
    firstLine = readFileSync(path, "utf8").split("\n", 1)[0];
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw error;
  }
  if (firstLine === undefined) return false;
  try {
    const entry = decodePiJsonlObject(firstLine);
    if (!isPiSessionRecord(entry)) return false;
    return decodePiSessionHeader(entry)?.id === sessionId;
  } catch {
    return false;
  }
};

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
