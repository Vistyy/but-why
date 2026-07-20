import { outputFormats } from "./output/structured.js";

const outputFormatPair = outputFormats.join(" or ");
const outputFormatList = outputFormats.join(", ");

export type HelpFlagView = {
  readonly flag: string;
  readonly description: string;
};

const globalOutputFlags = [
  {
    flag: "--output <format>",
    description: `Set the stdout format to ${outputFormatPair}. The default is toon.`,
  },
  {
    flag: "-o <format>",
    description: `Alias for --output <format>. Valid formats: ${outputFormatList}.`,
  },
] as const satisfies readonly HelpFlagView[];

const helpFlag = {
  flag: "--help",
  description: "Show help for this command.",
} as const satisfies HelpFlagView;

const globalHelpFlags = [...globalOutputFlags, helpFlag] as const;

export const withGlobalHelpFlags = (
  localFlags: readonly HelpFlagView[] = [],
): readonly HelpFlagView[] => [...localFlags, ...globalHelpFlags];
