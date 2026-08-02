import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
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
    try {
      runtime.restore(extensionContext);
    } catch {
      // Advisor restoration is fail-open and must not block the Implementer.
    }
  });
  pi.on("turn_end", (event, extensionContext) => {
    void runtime.handleTurnEnd(event, extensionContext);
  });
}

const acceptanceContextSchema = Type.Union([
  Type.Null(),
  Type.Object({
    version: Type.Literal(1),
    title: Type.String(),
    description: Type.String(),
    comments: Type.Array(Type.String()),
    resolutions: Type.Optional(Type.Array(Type.String())),
  }),
]);

const implementationDecisionSchema = Type.Object({
  id: Type.String(),
  changeId: Type.String(),
  sequence: Type.Number(),
  recordedAt: Type.String(),
  choice: Type.String(),
  rationale: Type.String(),
  content: Type.Optional(Type.String()),
});

const launchContextSchema = Type.Object({
  changeId: Type.String({ minLength: 1 }),
  acceptanceContext: acceptanceContextSchema,
  implementationDecisions: Type.Array(implementationDecisionSchema),
});

type LaunchContext = Static<typeof launchContextSchema>;

const parseLaunchContext = (source: string | undefined): LaunchContext | undefined => {
  if (source === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(source);
    return Value.Check(launchContextSchema, value) ? (value as LaunchContext) : undefined;
  } catch {
    return undefined;
  }
};
