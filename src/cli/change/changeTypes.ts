// fallow-ignore-file duplicate-export -- command descriptor types are consumed by dynamic handlers

import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import type { CancellationUseCases } from "../../change/cancelChange.js";
import type { InteractiveSessionHost } from "../../change/interactiveSession/interactiveSessionHost.js";
import type { TextInputStdin } from "../input/textInput.js";
export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly writeStderr?: (message: string) => void;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly cancellationUseCases?: CancellationUseCases;
};
