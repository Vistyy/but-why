import { Schema } from "effect";

import {
  type ValidationInputSnapshot,
  validationInputSnapshotSchema,
} from "../change/candidateValidation/validationInputSnapshot.js";

export const encodeSqliteValidationInputSnapshot = (
  validationInput: ValidationInputSnapshot,
): string => {
  const json = JSON.stringify(validationInput);
  decodeValidationInputSnapshot(json);
  return json;
};

const decodeValidationInputSnapshot = Schema.decodeUnknownSync(
  Schema.parseJson(validationInputSnapshotSchema),
  { onExcessProperty: "error" },
);

export const decodeSqliteValidationInputSnapshot = (value: string): ValidationInputSnapshot =>
  decodeValidationInputSnapshot(value);
