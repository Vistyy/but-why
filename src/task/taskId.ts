export type PublicTaskId = string & { readonly __publicTaskId: unique symbol };

const publicTaskIdShapePattern = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;

export const hasPublicTaskIdShape = (value: string): boolean =>
  publicTaskIdShapePattern.test(value);

export const publicTaskId = (value: string): PublicTaskId => value as PublicTaskId;
