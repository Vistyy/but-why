import { Schema } from "effect";

import type { GitHubPullRequest } from "../change/ownedPullRequestGateway.js";

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));
const safePositiveIntegerSchema = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0),
);
const httpUrlSchema = Schema.String.pipe(
  Schema.filter((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }),
);

const pullRequestFactsSchema = Schema.Struct({
  number: safePositiveIntegerSchema,
  state: Schema.Literal("open", "closed"),
  base: Schema.Struct({
    ref: nonEmptyStringSchema,
    repo: Schema.Struct({
      owner: Schema.Struct({ login: nonEmptyStringSchema }),
      name: nonEmptyStringSchema,
    }),
  }),
  head: Schema.Struct({
    ref: nonEmptyStringSchema,
    sha: nonEmptyStringSchema,
  }),
});

const pullRequestUrlSchema = Schema.Union(
  Schema.Struct({ html_url: httpUrlSchema }),
  Schema.Struct({ url: httpUrlSchema }),
);

const pullRequestMergedSchema = Schema.Union(
  Schema.Struct({ merged: Schema.Boolean }),
  Schema.Struct({ merged_at: Schema.Null }),
  Schema.Struct({ merged_at: nonEmptyStringSchema }),
);

const graphqlErrorsSchema = Schema.Array(Schema.Struct({}));

const remoteBranchQuerySchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          defaultBranchRef: Schema.optional(
            Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.String) })),
          ),
          ref: Schema.optional(
            Schema.NullOr(
              Schema.Struct({
                id: Schema.optional(Schema.String),
                name: Schema.optional(Schema.String),
                target: Schema.optional(
                  Schema.NullOr(Schema.Struct({ oid: Schema.optional(Schema.String) })),
                ),
              }),
            ),
          ),
        }),
      ),
    ),
  }),
  errors: Schema.optional(graphqlErrorsSchema),
});

const publicationRemoteBranchQuerySchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      ref: Schema.NullOr(
        Schema.Struct({
          name: Schema.String,
          prefix: Schema.String,
          target: Schema.Struct({ oid: Schema.String }),
        }),
      ),
    }),
  }),
  errors: Schema.optional(graphqlErrorsSchema),
});

const remoteBranchDeletionSchema = Schema.Struct({
  data: Schema.Struct({
    updateRefs: Schema.Struct({
      clientMutationId: Schema.NullOr(Schema.String),
    }),
  }),
  errors: Schema.optional(graphqlErrorsSchema),
});

export type RemoteBranchQueryResponse = Schema.Schema.Type<typeof remoteBranchQuerySchema>;
export type PublicationRemoteBranchQueryResponse = Schema.Schema.Type<
  typeof publicationRemoteBranchQuerySchema
>;

const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
};

const decode = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown): A | undefined => {
  const result = Schema.decodeUnknownEither(schema)(value);
  return result._tag === "Right" ? result.right : undefined;
};

const decodePullRequest = (value: unknown): GitHubPullRequest | undefined => {
  const facts = decode(pullRequestFactsSchema, value);
  const urlValue = decode(pullRequestUrlSchema, value);
  const mergedValue = decode(pullRequestMergedSchema, value);
  if (facts === undefined || urlValue === undefined || mergedValue === undefined) return undefined;

  const url = "html_url" in urlValue ? urlValue.html_url : urlValue.url;
  const merged = "merged" in mergedValue ? mergedValue.merged : mergedValue.merged_at !== null;
  return {
    number: facts.number,
    url,
    repository: { owner: facts.base.repo.owner.login, repo: facts.base.repo.name },
    state: facts.state,
    merged,
    baseBranch: facts.base.ref,
    headBranch: facts.head.ref,
    headSha: facts.head.sha,
  };
};

export const decodeGitHubPullRequest = (source: string): GitHubPullRequest | undefined =>
  decodePullRequest(parseJson(source));

export const decodeGitHubPullRequestList = (
  source: string,
): readonly GitHubPullRequest[] | undefined => {
  const values = decode(Schema.Array(Schema.Unknown), parseJson(source));
  if (values === undefined) return undefined;
  const pullRequests = values.map(decodePullRequest);
  return pullRequests.every((pullRequest) => pullRequest !== undefined) ? pullRequests : undefined;
};

export const decodeRemoteBranchQuery = (source: string): RemoteBranchQueryResponse | undefined =>
  decode(remoteBranchQuerySchema, parseJson(source));

export const decodePublicationRemoteBranchQuery = (
  source: string,
): PublicationRemoteBranchQueryResponse | undefined =>
  decode(publicationRemoteBranchQuerySchema, parseJson(source));

export const isConfirmedRemoteBranchDeletion = (source: string): boolean => {
  const response = decode(remoteBranchDeletionSchema, parseJson(source));
  return response !== undefined && response.errors === undefined;
};
