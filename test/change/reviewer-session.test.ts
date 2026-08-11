import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ReviewerSessionIdentity,
  reviewerSessionFingerprint,
  reviewerSessionsOwnerRoot,
  reviewerSessionsPath,
  reviewerSessionsProducerRoot,
} from "../../src/agent/reviewerSession/reviewerSession.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const identity = (changeId: string, producer: string): ReviewerSessionIdentity => ({
  owner: { kind: "change", id: changeId },
  producer,
  agentProfile: {
    agentProfile: "strict",
    scope: "repo",
    profile: {
      agentRuntime: "pi",
      runtimeConfig: { model: "openai-codex/gpt-5.5", thinking: "high" },
    },
  },
  instructions: "Repository Acceptance instructions",
  resources: {},
});

describe("Reviewer Session storage", () => {
  it("computes one canonical per-producer session path", () => {
    const root = createTestWorkspace();
    const path = reviewerSessionsPath(root, "change-1", "acceptance");

    expect(path).toBe(join(root, "change-1", "acceptance", "reviewer-sessions"));
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o700).toBe(0o700);
  });

  it("keeps the producer and change cleanup roots aligned with the canonical path", () => {
    const root = createTestWorkspace();
    const changeId = "change-1";

    expect(reviewerSessionsProducerRoot(root, changeId, "standards")).toBe(
      join(root, changeId, "standards"),
    );
    expect(reviewerSessionsOwnerRoot(root, changeId)).toBe(join(root, changeId));
  });

  it("derives a stable fingerprint from the runtime Reviewer Session identity", () => {
    const first = reviewerSessionFingerprint(identity("change-1", "acceptance"));
    const same = reviewerSessionFingerprint(identity("change-1", "acceptance"));
    const changedInstructions = reviewerSessionFingerprint({
      ...identity("change-1", "acceptance"),
      instructions: "Changed Acceptance instructions",
    });
    const otherProducer = reviewerSessionFingerprint(identity("change-1", "standards"));
    const otherChange = reviewerSessionFingerprint(identity("change-2", "acceptance"));

    expect(first).toBe("4dc33727b47c71e5c5b5d453288d20206fa8752de0c716880f6ec762574911f3");
    expect(same).toBe(first);
    expect(changedInstructions).not.toBe(first);
    expect(otherProducer).not.toBe(first);
    expect(otherChange).not.toBe(first);
  });
});
