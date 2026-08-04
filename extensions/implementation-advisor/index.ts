import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ImplementationAdvisorViewer } from "./viewer.js";
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
  investigationEvidence,
  turnEvidence,
  validateAdvisorOutput,
} from "./runtime.js";
export {
  implementationAdvisorOutputSchema,
  implementationAdvisorToolNames,
  NOTE_TOOL,
};
export type {
  AdvisorEvidence,
  AdvisorNote,
  AdvisorViewerActivity,
  AdvisorViewerState,
  AdvisorViewerTranscriptEntry,
} from "./runtime.js";
export { AdvisorResultRejectedError, createAdvisorViewerState } from "./runtime.js";

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
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("advisor", {
      description: "Open the current Interactive Session's Implementation Advisor viewer.",
      handler: async (_args, commandContext) => {
        if (commandContext.mode !== "tui") return;
        try {
          runtime.restore(commandContext);
          await runtime.openViewer();
          await commandContext.ui.custom(
            (tui, theme, _keybindings, done) =>
              new ImplementationAdvisorViewer({
                getState: runtime.getViewerState,
                subscribe: runtime.subscribeViewer,
                close: () => done(undefined),
                requestRender: () => tui.requestRender(),
                theme,
                getRows: () => tui.terminal.rows,
              }),
            {
              overlay: true,
              overlayOptions: {
                width: "90%",
                maxHeight: "85%",
                anchor: "center",
                margin: 1,
              },
            },
          );
        } catch {
          commandContext.ui.notify("Implementation Advisor viewer is unavailable.", "warning");
        }
      },
    });
  }
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
    if (!Value.Check(launchContextSchema, value)) return undefined;
    const context = value as LaunchContext;
    return context.implementationDecisions.every(
      (decision) => decision.changeId === context.changeId,
    )
      ? context
      : undefined;
  } catch {
    return undefined;
  }
};
