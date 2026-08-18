import { Schema } from "effect";

import type { ChangeReviewerConfiguration } from "./changeStartStore.js";
import {
  acceptanceReviewPolicySnapshotSchema,
  specialistReviewPolicySnapshotSchema,
} from "./candidateValidation/candidateValidationPolicySnapshot.js";

const changeReviewerConfigurationSchema = Schema.Struct({
  acceptanceReview: Schema.NullOr(acceptanceReviewPolicySnapshotSchema),
  specialistReviews: Schema.Array(specialistReviewPolicySnapshotSchema),
}).pipe(
  Schema.filter(
    (configuration) => {
      const ids = configuration.specialistReviews.map((review) => review.id);
      return new Set(ids).size === ids.length && ids.every((id) => id !== "acceptance");
    },
    { message: () => "Specialist IDs must be unique and must not use acceptance" },
  ),
);

const decodeConfiguration = Schema.decodeUnknownSync(changeReviewerConfigurationSchema, {
  onExcessProperty: "error",
});

export const decodeChangeReviewerConfiguration = (value: unknown): ChangeReviewerConfiguration =>
  decodeConfiguration(value);

export const decodeSqliteChangeReviewerConfiguration = (
  source: string,
): ChangeReviewerConfiguration => decodeChangeReviewerConfiguration(JSON.parse(source) as unknown);

export const encodeSqliteChangeReviewerConfiguration = (
  configuration: ChangeReviewerConfiguration,
): string => JSON.stringify(decodeChangeReviewerConfiguration(configuration));
