export const publicChangeId = (idPrefix: string, internalId: number): string => {
  if (!Number.isSafeInteger(internalId) || internalId < 1) {
    throw new Error("Invalid internal Change identity");
  }
  return `${idPrefix}-C${internalId}`;
};

export const internalChangeId = (value: string, idPrefix: string): number => {
  const match = new RegExp(`^${idPrefix}-C([1-9][0-9]*)$`, "u").exec(value);
  const id = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Change ID does not belong to this repository");
  }
  return id;
};
