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
    description: `Set stdout format: ${outputFormatPair}. Default: toon.`,
  },
  {
    flag: "-o <format>",
    description: `Alias for --output <format>. Valid values: ${outputFormatList}.`,
  },
] as const satisfies readonly HelpFlagView[];

const helpFlag = {
  flag: "--help",
  description: "Show this help",
} as const satisfies HelpFlagView;

const globalHelpFlags = [...globalOutputFlags, helpFlag] as const;

export const withGlobalHelpFlags = (
  localFlags: readonly HelpFlagView[] = [],
): readonly HelpFlagView[] => [...localFlags, ...globalHelpFlags];
