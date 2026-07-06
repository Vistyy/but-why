import { describe, expect, it } from "vitest";

import { parsePublicTaskId, publicTaskId, taskSlugForId } from "../src/task/taskId.js";

describe("Task identity seam", () => {
  it("accepts local and opaque Task IDs through one bounded parser", () => {
    expect(parsePublicTaskId("BY-1")).toEqual({ ok: true, taskId: publicTaskId("BY-1") });
    expect(parsePublicTaskId("linear/ENG-123:acceptance")).toEqual({
      ok: true,
      taskId: publicTaskId("linear/ENG-123:acceptance"),
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

  it("derives deterministic safe slugs with readable parts and raw-ID hash suffixes", () => {
    const localSlug = taskSlugForId(publicTaskId("BY-1"));
    const remoteSlug = taskSlugForId(publicTaskId("linear/ENG-123:acceptance"));
    const collidingReadablePart = taskSlugForId(publicTaskId("linear ENG 123 acceptance"));

    expect(localSlug).toMatch(/^by-1-[0-9a-f]{12}$/);
    expect(remoteSlug).toMatch(/^linear-eng-123-acceptance-[0-9a-f]{12}$/);
    expect(collidingReadablePart).toMatch(/^linear-eng-123-acceptance-[0-9a-f]{12}$/);
    expect(remoteSlug).not.toBe(collidingReadablePart);
    expect(taskSlugForId(publicTaskId("BY-1"))).toBe(localSlug);
  });

  it("bounds readable slug parts while preserving hash suffixes", () => {
    const slug = taskSlugForId(publicTaskId(`Remote/${"VeryLongSegment".repeat(10)}`));
    const suffix = slug.match(/[0-9a-f]{12}$/)?.[0];

    expect(slug.length).toBeLessThanOrEqual(61);
    expect(suffix).toBeDefined();
    expect(slug.endsWith(`-${suffix}`)).toBe(true);
  });
});
