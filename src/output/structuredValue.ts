import type { StructuredValue } from "./structured.js";

export const structuredValue = (value: unknown): StructuredValue =>
  JSON.parse(JSON.stringify(value)) as StructuredValue;
