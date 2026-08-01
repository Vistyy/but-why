// fallow-ignore-file duplicate-export -- command descriptor types are consumed by dynamic handlers

import type { CancellationUseCases } from "../../change/cancelChange.js";
import type { InteractiveSessionHost } from "../../change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { TextInputStdin } from "../input/textInput.js";
export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly writeStderr?: (message: string) => void;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
  readonly cancellationUseCases?: CancellationUseCases;
};
