import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import type { TaskContext } from "../task.js";
import { type PublicTaskId, taskSlugForId } from "../taskId.js";

export type ParsedTaskContextDraft = {
  readonly path: string;
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
): { readonly path: string; readonly content: string } => {
  mkdirSync(draftsPath, { recursive: true });

  const path = taskContextDraftPath(draftsPath, taskId);
  const content = context.description;
  writeFileSync(path, content, "utf8");

  return { path, content };
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

  return content.trim().length === 0
    ? { ok: false, error: { code: "invalid_task_context_draft", path } }
    : { ok: true, draft: { path, description: content } };
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

type NodeError = Error & {
  readonly code?: string;
};

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
