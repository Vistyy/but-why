import { Schema } from "effect";

import { type ChangePrepareFailure, changePrepareFailureSchema } from "../change/change.js";

export const encodeSqliteChangePrepareFailure = (failure: ChangePrepareFailure): string =>
  JSON.stringify(failure);

const decodeChangePrepareFailure = Schema.decodeUnknownSync(
  Schema.parseJson(changePrepareFailureSchema),
);

export const decodeSqliteChangePrepareFailure = (encoded: string): ChangePrepareFailure =>
  decodeChangePrepareFailure(encoded);
