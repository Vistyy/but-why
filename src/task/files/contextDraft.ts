import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import type { TaskContext } from "../task.js";
import { taskSlugForId, type PublicTaskId } from "../taskId.js";

export type ParsedTaskContextDraft = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
};

export type TaskContextDraftReadError =
  | {
      readonly code: "task_context_draft_not_found";
      readonly path: string;
    }
  | {
      readonly code: "task_context_draft_unreadable";
      readonly path: string;
    }
  | {
      readonly code: "invalid_task_context_draft";
      readonly path: string;
    };

export const writeTaskContextDraft = (
  draftsPath: string,
  taskId: PublicTaskId,
  context: TaskContext,
): string => {
  mkdirSync(draftsPath, { recursive: true });

  const path = taskContextDraftPath(draftsPath, taskId);
  writeFileSync(path, `# ${context.title}\n\n${context.description}`, "utf8");

  return path;
};

export const readTaskContextDraft = (
  draftsPath: string,
  taskId: PublicTaskId,
):
  | { readonly ok: true; readonly draft: ParsedTaskContextDraft }
  | { readonly ok: false; readonly error: TaskContextDraftReadError } => {
  const path = taskContextDraftPath(draftsPath, taskId);
  let content: string;

  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, error: { code: "task_context_draft_not_found", path } };
    }

    return { ok: false, error: { code: "task_context_draft_unreadable", path } };
  }

  const draft = parseTaskContextDraft(content, path);

  return draft === undefined
    ? { ok: false, error: { code: "invalid_task_context_draft", path } }
    : { ok: true, draft };
};

export const removeTaskContextDraft = (path: string): boolean => {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
};

const taskContextDraftPath = (draftsPath: string, taskId: PublicTaskId): string =>
  join(draftsPath, `${taskSlugForId(taskId)}.md`);

const parseTaskContextDraft = (
  content: string,
  path: string,
): ParsedTaskContextDraft | undefined => {
  const firstLineEnd = content.indexOf("\n");

  if (firstLineEnd < 0) {
    return undefined;
  }

  const firstLine = content.slice(0, firstLineEnd).replace(/\r$/, "");

  if (!firstLine.startsWith("# ")) {
    return undefined;
  }

  const title = firstLine.slice(2).trim();
  let description = content.slice(firstLineEnd + 1);

  if (description.startsWith("\n")) {
    description = description.slice(1);
  } else if (description.startsWith("\r\n")) {
    description = description.slice(2);
  }

  if (title.length === 0 || description.trim().length === 0) {
    return undefined;
  }

  return { path, title, description };
};

type NodeError = Error & {
  readonly code?: string;
};

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
