import { createHash } from "node:crypto";

export type PublicTaskId = string & { readonly __publicTaskId: unique symbol };
export type TaskSlug = string & { readonly __taskSlug: unique symbol };

export type TaskIdParseErrorCode =
  | "empty_task_id"
  | "task_id_has_whitespace"
  | "task_id_has_control"
  | "task_id_invalid_shape"
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
const publicTaskIdShapePattern = /^[A-Z][A-Z0-9]*-([1-9][0-9]*)$/;
const unsafeSlugCharacterPattern = /[^a-z0-9]+/g;

export const hasPublicTaskIdShape = (value: string): boolean => {
  const match = publicTaskIdShapePattern.exec(value);
  if (match?.[1] === undefined) return false;
  const internalId = Number(match[1]);
  return Number.isSafeInteger(internalId) && internalId >= 1;
};

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

  if (!hasPublicTaskIdShape(value)) {
    return { ok: false, code: "task_id_invalid_shape" };
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

export const publicTaskIdFromInternal = (internalId: number, idPrefix: string): PublicTaskId => {
  if (!Number.isSafeInteger(internalId) || internalId < 1) {
    throw new Error("Invalid internal Task identity");
  }
  return brandPublicTaskId(`${idPrefix}-${internalId}`);
};

export type TaskIdentityCodec = {
  readonly toInternal: (taskId: PublicTaskId | string) => number;
  readonly toPublic: (internalId: number) => PublicTaskId;
};

export const taskIdentityCodec = (idPrefix: string): TaskIdentityCodec => ({
  toInternal: (taskId) => internalTaskId(taskId, idPrefix),
  toPublic: (internalId) => publicTaskIdFromInternal(internalId, idPrefix),
});

export const internalTaskId = (value: PublicTaskId | string, idPrefix: string): number => {
  const match = new RegExp(`^${idPrefix}-([1-9][0-9]*)$`, "u").exec(value);
  const id = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Task ID does not belong to this repository");
  return id;
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
