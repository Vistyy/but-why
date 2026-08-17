const publicChangeIdShapePattern = /^[A-Z][A-Z0-9]*-C([1-9][0-9]*)$/u;

export const hasPublicChangeIdShape = (value: string): boolean => {
  const match = publicChangeIdShapePattern.exec(value);
  if (match?.[1] === undefined) return false;
  const internalId = Number(match[1]);
  return Number.isSafeInteger(internalId) && internalId >= 1;
};

export const isPublicChangeIdForPrefix = (value: string, idPrefix: string): boolean =>
  value.startsWith(`${idPrefix}-C`) && hasPublicChangeIdShape(value);

export const publicChangeId = (idPrefix: string, internalId: number): string => {
  if (!Number.isSafeInteger(internalId) || internalId < 1) {
    throw new Error("Invalid internal Change identity");
  }
  return `${idPrefix}-C${internalId}`;
};

export type ChangeIdentityCodec = {
  readonly toInternal: (changeId: string) => number;
  readonly toPublic: (internalId: number) => string;
};

export const changeIdentityCodec = (idPrefix: string): ChangeIdentityCodec => ({
  toInternal: (changeId) => internalChangeId(changeId, idPrefix),
  toPublic: (internalId) => publicChangeId(idPrefix, internalId),
});

export const internalChangeId = (value: string, idPrefix: string): number => {
  const match = new RegExp(`^${idPrefix}-C([1-9][0-9]*)$`, "u").exec(value);
  const id = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Change ID does not belong to this repository");
  }
  return id;
};
