import { Effect } from "effect";
import {
  openSqliteCandidatePublicationPort,
  openSqliteChangeAuthorityPort,
  openSqliteChangeDeliveryPort,
  openSqliteChangeReadPort,
  openSqliteChangeReviewerSessionPort,
  openSqliteChangeReviewerTranscriptPort,
} from "../../src/sqlite/sqliteChangePersistence.js";

export const openSqliteChangeTestPorts = () =>
  Effect.all({
    authority: openSqliteChangeAuthorityPort(),
    delivery: openSqliteChangeDeliveryPort(),
    changes: openSqliteChangeReadPort(),
    reviewerSessions: openSqliteChangeReviewerSessionPort(),
    reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
    publication: openSqliteCandidatePublicationPort(),
  }).pipe(
    Effect.map(
      ({ authority, delivery, changes, reviewerSessions, reviewerTranscripts, publication }) => ({
        ...authority,
        ...delivery,
        ...changes,
        ...reviewerSessions,
        ...reviewerTranscripts,
        ...publication,
      }),
    ),
  );
