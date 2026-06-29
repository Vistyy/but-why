import { encode } from "@toon-format/toon";

export type ToonPrimitive = string | number | boolean | null;
export type ToonObject = { readonly [key: string]: ToonValue };
export type ToonArray = readonly ToonValue[];
export type ToonValue = ToonPrimitive | ToonObject | ToonArray;

export const encodeToon = (value: ToonObject): string => encode(value);
