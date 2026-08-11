export const reviewerOutputTag = "reviewer-output";

export const parseTaggedReviewerOutput = (stdout: string): unknown => {
  const pattern = new RegExp(`<${reviewerOutputTag}>([\\s\\S]*?)</${reviewerOutputTag}>`, "gu");
  const matched = [...stdout.matchAll(pattern)].at(-1)?.[1];
  if (matched === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(matched) as unknown;
    return parsed;
  } catch {
    return matched;
  }
};

export const encodeReviewerWireValue = (value: unknown): string => JSON.stringify(value, null, 2);
