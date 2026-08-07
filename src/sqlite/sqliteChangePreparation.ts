import type { ChangePrepareFailure } from "../change/change.js";
import { decodeChangePrepareFailureValue } from "./sqlitePersistenceDecoders.js";

export const encodeSqliteChangePrepareFailure = (failure: ChangePrepareFailure): string =>
  JSON.stringify(failure);

export const decodeSqliteChangePrepareFailure = (encoded: string): ChangePrepareFailure =>
  decodeChangePrepareFailureValue(encoded);
