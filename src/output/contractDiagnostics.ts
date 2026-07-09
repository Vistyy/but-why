import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { StructuredValue } from "./structured.js";

export const structuredContractDiagnostics = (
  diagnostics: readonly ContractDiagnostic[],
): StructuredValue =>
  diagnostics.map((diagnostic) => ({
    path: diagnostic.path,
    expected: diagnostic.expected,
    actual: structuredActual(diagnostic.actual),
    message: diagnostic.message,
  }));

const structuredActual = (value: unknown): StructuredValue => {
  if (value === undefined) {
    return "<missing>";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(structuredActual);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, structuredActual(nested)]),
    );
  }

  return String(value);
};
