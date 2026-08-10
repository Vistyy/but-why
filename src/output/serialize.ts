import type { StructuredObject } from "./structured.js";

export const serializeOutput = (value: StructuredObject): string => `${JSON.stringify(value)}\n`;
