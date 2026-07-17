import { createHash } from "node:crypto";

export type PublicTaskId = string & { readonly __publicTaskId: unique symbol };
export type TaskSlug = string & { readonly __taskSlug: unique symbol };

export type TaskIdParseErrorCode =
  | "empty_task_id"
  | "task_id_has_whitespace"
  | "task_id_has_control"
  | "task_id_too_long";

export type PublicTaskIdParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<TaskIdParseErrorCode, "task_id_too_long">;
    }
  | {
      readonly ok: false;
      readonly code: "task_id_too_long";
      readonly maxLength: number;
    };

const maxTaskIdLength = 256;
const maxTaskSlugReadableLength = 48;
const taskSlugHashLength = 12;
const publicTaskIdShapePattern = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const unsafeSlugCharacterPattern = /[^a-z0-9]+/g;

export const hasPublicTaskIdShape = (value: string): boolean =>
  publicTaskIdShapePattern.test(value);

export const parsePublicTaskId = (value: string): PublicTaskIdParseResult => {
  if (value.trim().length === 0) {
    return { ok: false, code: "empty_task_id" };
  }

  if (value.trim() !== value) {
    return { ok: false, code: "task_id_has_whitespace" };
  }

  if (hasControlCharacter(value)) {
    return { ok: false, code: "task_id_has_control" };
  }

  if (value.length > maxTaskIdLength) {
    return { ok: false, code: "task_id_too_long", maxLength: maxTaskIdLength };
  }

  return { ok: true, taskId: brandPublicTaskId(value) };
};

export const publicTaskId = (value: string): PublicTaskId => {
  const parsed = parsePublicTaskId(value);

  if (!parsed.ok) {
    throw new Error(`Invalid Task ID: ${value}`);
  }

  return parsed.taskId;
};

export const generatedPublicTaskId = (prefix: string, numericId: number): PublicTaskId =>
  publicTaskId(`${prefix}-${numericId}`);

export const storedPublicTaskId = (value: string): PublicTaskId => {
  const parsed = parsePublicTaskId(value);

  if (!parsed.ok) {
    throw new Error("Invalid stored Task ID");
  }

  return parsed.taskId;
};

export const taskSlugForId = (taskId: PublicTaskId): TaskSlug => {
  const parsed = parsePublicTaskId(taskId);

  if (!parsed.ok) {
    throw new Error(`Invalid Task ID: ${taskId}`);
  }

  const readablePart = readableSlugPart(parsed.taskId);
  const hash = createHash("sha256")
    .update(parsed.taskId, "utf8")
    .digest("hex")
    .slice(0, taskSlugHashLength);

  return `${readablePart}-${hash}` as TaskSlug;
};

const brandPublicTaskId = (value: string): PublicTaskId => value as PublicTaskId;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });

const readableSlugPart = (taskId: PublicTaskId): string => {
  const normalized = taskId
    .normalize("NFKD")
    .toLowerCase()
    .replace(unsafeSlugCharacterPattern, "-")
    .replace(/^-+|-+$/g, "");
  const readable = normalized.length === 0 ? "task" : normalized;
  const bounded = readable.slice(0, maxTaskSlugReadableLength).replace(/-+$/g, "");

  return bounded.length === 0 ? "task" : bounded;
};
