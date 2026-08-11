export const parseRemoteChangeBaseRef = (
  baseRef: string,
): { readonly remoteName: string; readonly branchName: string } | undefined => {
  const match = /^refs\/remotes\/([^/]+)\/(.+)$/u.exec(baseRef);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { remoteName: match[1], branchName: match[2] };
};
