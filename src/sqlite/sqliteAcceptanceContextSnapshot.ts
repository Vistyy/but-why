import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";

export const encodeSqliteAcceptanceContextSnapshot = (
  snapshot: AcceptanceContextSnapshotV1,
): string =>
  JSON.stringify({
    version: 1,
    title: snapshot.title,
    description: snapshot.description,
    ...(snapshot.comments === undefined ? {} : { comments: [...snapshot.comments] }),
    ...(snapshot.resolutions === undefined ? {} : { resolutions: [...snapshot.resolutions] }),
  });

export const decodeSqliteAcceptanceContextSnapshot = (
  encoded: string,
): AcceptanceContextSnapshotV1 => {
  const value: unknown = JSON.parse(encoded);

  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !("description" in value) ||
    typeof value.description !== "string" ||
    ("comments" in value &&
      (!Array.isArray(value.comments) ||
        !value.comments.every((comment) => typeof comment === "string")))
  ) {
    throw new Error("Stored Acceptance Context Snapshot is invalid");
  }

  return {
    version: 1,
    title: value.title,
    description: value.description,
    ...("comments" in value ? { comments: value.comments as string[] } : {}),
    ...("resolutions" in value &&
    Array.isArray(value.resolutions) &&
    value.resolutions.every((resolution) => typeof resolution === "string")
      ? { resolutions: value.resolutions }
      : {}),
  };
};
