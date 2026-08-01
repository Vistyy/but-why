import { describe, expect, it } from "vitest";

import { formatValidationPolicyFailure } from "../../src/change/submitChange.js";
import { MissingAgentModel, MissingAgentProfile } from "../../src/agent/agentProfileErrors.js";
import { submitResult } from "../../src/cli/change/changeCli.js";

describe("Change Submit validation-policy errors", () => {
  it("formats scoped profile failures with actionable settings", () => {
    expect(
      formatValidationPolicyFailure(
        new MissingAgentProfile({ profileName: "reviewer", scope: "repo", selection: "explicit" }),
      ),
    ).toEqual({ message: 'Agent Profile "reviewer" in repo scope was not found.' });
    expect(
      formatValidationPolicyFailure(
        new MissingAgentModel({ profileName: "reviewer", scope: "global", agentRuntime: "pi" }),
      ),
    ).toEqual({
      message: 'Agent Profile "reviewer" in global scope has no Pi model in runtimeConfig.',
    });
    expect(
      formatValidationPolicyFailure(new MissingAgentProfile({ selection: "default" })),
    ).toEqual({ message: "Global Config needs a default Agent Profile for reviewer selection." });
  });

  it("preserves config paths and diagnostics in structured CLI output", () => {
    const result = submitResult(
      {
        ok: false,
        code: "validation_policy_invalid",
        message: "Global Config is invalid.",
        details: {
          path: "/tmp/global-config.json",
          diagnostics: [
            {
              path: ["agentProfiles"],
              expected: "an object",
              actual: undefined,
              message: "Required value is missing.",
            },
          ],
        },
      },
      "change-1",
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "validation_policy_invalid",
          message: "Global Config is invalid.",
          path: "/tmp/global-config.json",
          diagnostics: [
            {
              path: ["agentProfiles"],
              expected: "an object",
              actual: "<missing>",
              message: "Required value is missing.",
            },
          ],
        },
        help: ["Fix Repo Config or Global Config, then retry Change Submit."],
      },
    });
  });
});
