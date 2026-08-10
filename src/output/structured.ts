export type StructuredPrimitive = string | number | boolean | null;
export type StructuredObject = { readonly [key: string]: StructuredValue };
export type StructuredArray = readonly StructuredValue[];
export type StructuredValue = StructuredPrimitive | StructuredObject | StructuredArray;
