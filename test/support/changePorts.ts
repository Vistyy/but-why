import { Effect } from "effect";
import type {
  CandidatePublicationPort,
  ChangeAuthorityPort,
  ChangeDeliveryPort,
  ChangeReadPort,
  ChangeReviewerSessionPort,
  ChangeReviewerTranscriptPort,
} from "../../src/change/changePorts.js";
import {
  openSqliteCandidatePublicationPort,
  openSqliteChangeAuthorityPort,
  openSqliteChangeDeliveryPort,
  openSqliteChangeReadPort,
  openSqliteChangeReviewerSessionPort,
  openSqliteChangeReviewerTranscriptPort,
} from "../../src/sqlite/sqliteChangePersistence.js";

export const openSqliteChangeTestDependencies = () =>
  Effect.all({
    authority: openSqliteChangeAuthorityPort(),
    delivery: openSqliteChangeDeliveryPort(),
    reads: openSqliteChangeReadPort(),
    reviewerSessions: openSqliteChangeReviewerSessionPort(),
    reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
    publication: openSqliteCandidatePublicationPort(),
  });

export type ChangeTestDependencies = {
  readonly authority: ChangeAuthorityPort;
  readonly delivery: ChangeDeliveryPort;
  readonly reads: ChangeReadPort;
  readonly reviewerSessions: ChangeReviewerSessionPort;
  readonly reviewerTranscripts: ChangeReviewerTranscriptPort;
  readonly publication: CandidatePublicationPort;
};
