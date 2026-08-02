import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createImplementationAdvisorRuntime,
  implementationAdvisorOutputSchema,
  implementationAdvisorToolNames,
  NOTE_TOOL,
} from "./runtime.js";

export {
  createAdvisorActivityScheduler,
  turnEvidence,
  validateAdvisorOutput,
} from "./runtime.js";
export {
  implementationAdvisorOutputSchema,
  implementationAdvisorToolNames,
  NOTE_TOOL,
};
export type { AdvisorEvidence, AdvisorNote } from "./runtime.js";

export default function implementationAdvisor(pi: ExtensionAPI): void {
  const model = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"]?.trim();
  const context = parseLaunchContext(process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"]);
  if (model === undefined || model === "" || context === undefined) return;

  const runtime = createImplementationAdvisorRuntime({
    model,
    thinking: process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_THINKING"],
    context,
    pi,
  });

  pi.on("session_start", (_event, extensionContext) => {
    runtime.restore(extensionContext);
  });
  pi.on("turn_end", (event, extensionContext) => runtime.handleTurnEnd(event, extensionContext));
}

type LaunchContext = {
  readonly changeId: string;
  readonly acceptanceContext: unknown;
  readonly implementationDecisions: readonly unknown[];
};

const parseLaunchContext = (source: string | undefined): LaunchContext | undefined => {
  if (source === undefined) return undefined;
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    return typeof value["changeId"] === "string" &&
      Array.isArray(value["implementationDecisions"])
      ? {
          changeId: value["changeId"],
          acceptanceContext: value["acceptanceContext"] ?? null,
          implementationDecisions: value["implementationDecisions"],
        }
      : undefined;
  } catch {
    return undefined;
  }
};
