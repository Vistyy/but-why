import { usageError, type CliUsageErrorResult } from "./cliResults.js";
import { outputFormats, type OutputFormat } from "./output/structured.js";

type OutputSelectionUsageError = CliUsageErrorResult;

export type OutputSelectionResult =
  | {
      readonly ok: true;
      readonly args: readonly string[];
      readonly outputFormat: OutputFormat;
    }
  | {
      readonly ok: false;
      readonly result: OutputSelectionUsageError;
    };

const outputSelectors = new Set(["--output", "-o"]);

export const selectOutput = (args: readonly string[]): OutputSelectionResult => {
  const selectorIndexes = args.flatMap((arg, index) => (outputSelectors.has(arg) ? [index] : []));

  if (selectorIndexes.length > 1) {
    return {
      ok: false,
      result: usageError({
        code: "duplicate_output_selector",
        message: "Only one output selector is allowed.",
        help: ["Use either --output <format> or -o <format>, not both."],
      }),
    };
  }

  if (selectorIndexes.length === 0) {
    return { ok: true, args, outputFormat: "toon" };
  }

  const selectorIndex = selectorIndexes[0] ?? 0;
  const selector = args[selectorIndex] ?? "--output";
  const format = args[selectorIndex + 1];

  if (format === undefined) {
    return invalidOutputFormat(`Missing output format after ${selector}.`);
  }

  if (!isOutputFormat(format)) {
    return invalidOutputFormat(`Invalid output format: ${format}`);
  }

  return {
    ok: true,
    args: [...args.slice(0, selectorIndex), ...args.slice(selectorIndex + 2)],
    outputFormat: format,
  };
};

export const outputFormatForArgs = (args: readonly string[]): OutputFormat => {
  const outputSelection = selectOutput(args);

  return outputSelection.ok ? outputSelection.outputFormat : "toon";
};

const isOutputFormat = (value: string): value is OutputFormat =>
  outputFormats.some((format) => format === value);

const invalidOutputFormat = (message: string): OutputSelectionResult => ({
  ok: false,
  result: usageError({
    code: "invalid_output_format",
    message,
    details: { valid: outputFormats },
    help: ["Use --output toon or --output json."],
  }),
});
