export type PublicTaskId = string & { readonly __publicTaskId: unique symbol };

const publicTaskIdShapePattern = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;

export const hasPublicTaskIdShape = (value: string): boolean =>
  publicTaskIdShapePattern.test(value);

export const isTaskIdForPrefix = (value: string, taskPrefix: string): boolean =>
  new RegExp(`^${escapeRegExp(taskPrefix)}-[1-9][0-9]*$`).test(value);

export const publicTaskId = (value: string): PublicTaskId => value as PublicTaskId;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
