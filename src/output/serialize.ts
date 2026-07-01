import { encodeJson } from "./json.js";
import type { OutputFormat, StructuredObject } from "./structured.js";
import { encodeToon } from "./toon.js";

export const serializeOutput = (value: StructuredObject, format: OutputFormat): string => {
  switch (format) {
    case "json":
      return encodeJson(value);
    case "toon":
      return encodeToon(value);
  }
};
