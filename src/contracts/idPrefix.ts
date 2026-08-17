export const idPrefixPattern = /^[A-Z][A-Z0-9]{1,9}$/u;

export const isIdPrefix = (value: string): boolean => idPrefixPattern.test(value);
