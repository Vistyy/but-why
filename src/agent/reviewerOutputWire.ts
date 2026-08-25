export const reviewerOutputTag = "reviewer-output";

const taggedReviewerOutput = (stdout: string): string | undefined => {
  const pattern = new RegExp(`<${reviewerOutputTag}>([\\s\\S]*?)</${reviewerOutputTag}>`, "gu");
  return [...stdout.matchAll(pattern)].at(-1)?.[1];
};

export const parseTaggedReviewerOutput = (stdout: string): unknown => {
  const matched = taggedReviewerOutput(stdout);
  if (matched === undefined) return undefined;
  try {
    return JSON.parse(matched) as unknown;
  } catch {
    return matched;
  }
};

export const parseTaggedReviewerTextOutput = (stdout: string): unknown =>
  taggedReviewerOutput(stdout);

export const encodeReviewerWireValue = (value: unknown): string => JSON.stringify(value, null, 2);
