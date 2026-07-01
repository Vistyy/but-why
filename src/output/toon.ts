import { encode } from "@toon-format/toon";

import type { StructuredObject } from "./structured.js";

export const encodeToon = (value: StructuredObject): string => encode(value);
