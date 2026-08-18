import { Schema } from "effect";

import {
  type ValidationInputSnapshot,
  validationInputSnapshotSchema,
} from "../change/candidateValidation/validationInputSnapshot.js";

export const encodeSqliteValidationInputSnapshot = (
  policy: ValidationInputSnapshot,
): string => {
  const json = JSON.stringify(policy);
  decodePolicySnapshot(json);
  return json;
};

const decodePolicySnapshot = Schema.decodeUnknownSync(
  Schema.parseJson(validationInputSnapshotSchema),
  { onExcessProperty: "error" },
);

export const decodeSqliteValidationInputSnapshot = (
  value: string,
): ValidationInputSnapshot => decodePolicySnapshot(value);
