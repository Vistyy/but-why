import type { ChangeCleanup, ChangeCloseReason, ChangeState } from "../change/change.js";

export const decodeStoredString = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`${field} is not a string`);
  return value;
};

export const decodeStoredNullableString = (value: unknown, field: string): string | null =>
  value === null ? null : decodeStoredString(value, field);

export const decodeStoredPositiveInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} is not a positive safe integer`);
  }
  return value as number;
};

export const decodeChangeState = (value: unknown): ChangeState => {
  if (value !== "open" && value !== "closed") throw new Error("Change state is unsupported");
  return value;
};

const decodeChangeCloseReason = (value: unknown): ChangeCloseReason | null => {
  if (value === null || value === "completed" || value === "cancelled") return value;
  throw new Error("Change close reason is unsupported");
};

export const decodeChangeLifecycle = (input: {
  readonly state: unknown;
  readonly closeReason: unknown;
}): { readonly state: ChangeState; readonly closeReason: ChangeCloseReason | null } => {
  const state = decodeChangeState(input.state);
  const closeReason = decodeChangeCloseReason(input.closeReason);
  if ((state === "open") !== (closeReason === null)) {
    throw new Error("Change lifecycle relationship is invalid");
  }
  return { state, closeReason };
};

export const decodeChangeCleanup = (state: unknown, blockingReason: unknown): ChangeCleanup => {
  if (state !== "complete" && state !== "pending") {
    throw new Error("Change cleanup state is unsupported");
  }
  const decodedBlockingReason = decodeStoredNullableString(
    blockingReason,
    "Change cleanup blocking reason",
  );
  if (state === "complete" && decodedBlockingReason !== null) {
    throw new Error("Change cleanup relationship is invalid");
  }
  return { state, blockingReason: decodedBlockingReason };
};
