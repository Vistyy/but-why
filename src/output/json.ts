import type { StructuredObject } from "./structured.js";

export const encodeJson = (value: StructuredObject): string => `${JSON.stringify(value)}\n`;
