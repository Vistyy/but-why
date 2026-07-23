import { describe, expect, it } from "vitest";

import { parseCliTaskIdArg } from "../../src/cliTaskId.js";

const parse = (args: readonly string[]) =>
  parseCliTaskIdArg(args, {
    missingHelp: "Run `by task show <task-id>`.",
    extraHelp: "Run `by task show <task-id>`.",
  });

describe("CLI Task ID arguments", () => {
  it.each([
    ["missing", [], "missing_task_id"],
    ["leading whitespace", [" BY-1"], "invalid_task_id"],
    ["line break", ["BY-1\n"], "invalid_task_id"],
    ["control character", ["BY-\u00001"], "invalid_task_id"],
  ] as const)("rejects %s Task IDs", (_name, args, code) => {
    const result = parse(args);

    expect(result).toMatchObject({
      ok: false,
      result: { exitCode: 2, stdout: { error: { code } } },
    });
  });
});
