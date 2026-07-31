import { encodeJson } from "./json.js";
import type { OutputFormat, StructuredObject } from "./structured.js";
import { encodeToon } from "./toon.js";

const terminateStructuredDocument = (encoded: string): string => `${encoded.replace(/\n+$/, "")}\n`;

export const serializeOutput = (value: StructuredObject, format: OutputFormat): string => {
  switch (format) {
    case "json":
      return terminateStructuredDocument(encodeJson(value));
    case "toon":
      return terminateStructuredDocument(encodeToon(value));
  }
};
