const changeBranchPrefix = "but-why/";
const headsPrefix = "refs/heads/";

export const changeBranchRefForSlug = (slug: string): string =>
  `${headsPrefix}${changeBranchPrefix}${slug}`;

export const changeBranchNameForRef = (branchRef: string): string | undefined => {
  if (!branchRef.startsWith(`${headsPrefix}${changeBranchPrefix}`)) return undefined;
  const branchName = branchRef.slice(headsPrefix.length);
  return branchName.length > changeBranchPrefix.length ? branchName : undefined;
};

export const branchNameForRef = (branchRef: string): string | undefined =>
  branchRef.startsWith(headsPrefix) && branchRef.length > headsPrefix.length
    ? branchRef.slice(headsPrefix.length)
    : undefined;
