export type InteractiveSessionHost = {
  readonly launch: (
    input: InteractiveSessionLaunchInput,
  ) => Promise<InteractiveSessionLaunchResult>;
};

export type InteractiveSessionLaunchInput = {
  readonly changeId: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly initialPrompt: string | undefined;
};

export type InteractiveSessionLaunchResult =
  | {
      readonly ok: true;
      readonly host: "herdr";
      readonly status: "started" | "already_active";
    }
  | {
      readonly ok: false;
      readonly code: "host_unavailable" | "launch_failed";
      readonly message: string;
    };
