export type SessionEvent = {
  readonly type: string;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
};

export type RuntimeCase = {
  readonly blocked: boolean;
  readonly providerCalls: number;
  readonly events: readonly SessionEvent[];
  readonly messages: readonly unknown[];
  readonly idle: boolean;
  readonly continuationState: (Record<string, unknown> & { readonly paused?: boolean }) | undefined;
  readonly extensionErrors: readonly unknown[];
};

export const changeId = "BY-C1";
export const maxRuntimeCaseBytes = 1_000_000;
export const runtimeCaseModes = {
  blocked: "blocked",
  normal: "normal",
} as const;
