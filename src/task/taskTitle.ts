export type TaskTitleValidationCode = "empty_title" | "invalid_task_title";

export type TaskTitleValidationResult =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly code: TaskTitleValidationCode };

export const normalizeTaskTitle = (title: string): TaskTitleValidationResult => {
  const normalized = title.trim();
  if (normalized.length === 0) return { ok: false, code: "empty_title" };
  if (/[\r\n]/u.test(normalized)) return { ok: false, code: "invalid_task_title" };
  return { ok: true, title: normalized };
};
