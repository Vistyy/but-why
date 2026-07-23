import type { TaskContextSnapshotV1 } from "../change/validationRun/taskContextSnapshot.js";

export const encodeSqliteTaskContextSnapshot = (snapshot: TaskContextSnapshotV1): string =>
  JSON.stringify({
    version: 1,
    title: snapshot.title,
    description: snapshot.description,
    comments: [...snapshot.comments],
  });

export const decodeSqliteTaskContextSnapshot = (encoded: string): TaskContextSnapshotV1 => {
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
    !("comments" in value) ||
    !Array.isArray(value.comments) ||
    !value.comments.every((comment) => typeof comment === "string")
  ) {
    throw new Error("Stored Task Context Snapshot is invalid");
  }

  return {
    version: 1,
    title: value.title,
    description: value.description,
    comments: value.comments,
  };
};
