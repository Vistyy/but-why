import { describe, expect, it } from "vitest";

import { parsePublicTaskId, publicTaskId, taskSlugForId } from "../../src/task/taskId.js";

describe("Task identity seam", () => {
  it("accepts only derived public Task IDs through one bounded parser", () => {
    expect(parsePublicTaskId("BY-1")).toEqual({ ok: true, taskId: publicTaskId("BY-1") });
    expect(parsePublicTaskId("linear/ENG-123:acceptance")).toEqual({
      ok: false,
      code: "task_id_invalid_shape",
    });
    expect(parsePublicTaskId("BY-9007199254740992")).toEqual({
      ok: false,
      code: "task_id_invalid_shape",
    });

    expect(parsePublicTaskId("")).toEqual({ ok: false, code: "empty_task_id" });
    expect(parsePublicTaskId(" BY-1")).toEqual({ ok: false, code: "task_id_has_whitespace" });
    expect(parsePublicTaskId("BY-1\n")).toEqual({ ok: false, code: "task_id_has_whitespace" });
    expect(parsePublicTaskId("BY-\u00001")).toEqual({ ok: false, code: "task_id_has_control" });
    expect(parsePublicTaskId("BY-\u00851")).toEqual({ ok: false, code: "task_id_has_control" });
    expect(parsePublicTaskId("A".repeat(257))).toEqual({
      ok: false,
      code: "task_id_too_long",
      maxLength: 256,
    });
  });

  it("derives deterministic safe slugs from public Task IDs", () => {
    const first = taskSlugForId(publicTaskId("BY-1"));
    const second = taskSlugForId(publicTaskId("BY-2"));

    expect(first).toMatch(/^by-1-[0-9a-f]{12}$/);
    expect(second).toMatch(/^by-2-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
    expect(taskSlugForId(publicTaskId("BY-1"))).toBe(first);
  });

  it("bounds readable slug parts while preserving hash suffixes", () => {
    const slug = taskSlugForId(publicTaskId(`${"A".repeat(200)}-1`));
    const suffix = slug.match(/[0-9a-f]{12}$/)?.[0];

    expect(slug.length).toBeLessThanOrEqual(61);
    expect(suffix).toBeDefined();
    expect(slug.endsWith(`-${suffix}`)).toBe(true);
  });
});
