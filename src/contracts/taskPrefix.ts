export const taskPrefixPattern = /^[A-Z][A-Z0-9]{1,9}$/u;

export const isTaskPrefix = (value: string): boolean => taskPrefixPattern.test(value);
