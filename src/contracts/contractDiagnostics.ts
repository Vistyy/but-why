import { inspect } from "node:util";

import { ParseResult } from "effect";

export type ContractDiagnostic = {
  readonly path: readonly (string | number)[];
  readonly expected: string;
  readonly actual: unknown;
  readonly message: string;
};

export const contractDiagnostics = (
  error: ParseResult.ParseError,
  input: unknown,
): readonly ContractDiagnostic[] => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error);
  const missingExpected = missingExpectedShapes(error.issue);

  return issues
    .filter(
      (issue) =>
        !issues.some(
          (other) =>
            other.path.length > issue.path.length && pathStartsWith(other.path, issue.path),
        ),
    )
    .map((issue) => {
      const path = issue.path.map((part) => (typeof part === "number" ? part : String(part)));

      return {
        path,
        expected: expectedShape(issue.message, missingExpected.get(pathKey(path))),
        actual: valueAtPath(input, path),
        message: shortMessage(issue._tag, issue.message),
      };
    })
    .filter(
      (diagnostic, index, diagnostics) =>
        diagnostics.findIndex(
          (candidate) =>
            pathKey(candidate.path) === pathKey(diagnostic.path) &&
            candidate.expected === diagnostic.expected &&
            candidate.message === diagnostic.message,
        ) === index,
    );
};

export const formatContractDiagnostics = (diagnostics: readonly ContractDiagnostic[]): string =>
  diagnostics
    .map((diagnostic) => {
      const path = diagnostic.path.length === 0 ? "$" : diagnostic.path.join(".");
      return `${path}: ${diagnostic.message} Expected ${diagnostic.expected}; actual ${formatActual(diagnostic.actual)}.`;
    })
    .join(" ");

const expectedShape = (message: string, missingExpected: string | undefined): string => {
  const expectedActual = /^Expected (.+), actual /u.exec(message);

  if (expectedActual?.[1] !== undefined) {
    return expectedActual[1];
  }

  const unexpected = /expected: (.+)$/u.exec(message);

  if (unexpected?.[1] !== undefined) {
    return unexpected[1];
  }

  const expected = /^Expected (.+)$/u.exec(message);

  if (expected?.[1] !== undefined) {
    return expected[1];
  }

  return missingExpected ?? "a required value matching the contract";
};

const shortMessage = (tag: string, message: string): string => {
  if (tag === "Missing") {
    return "Required value is missing.";
  }

  if (tag === "Unexpected") {
    return "Unknown key.";
  }

  const short = message.replace(/, actual .+$/u, "");
  return short.endsWith(".") ? short : `${short}.`;
};

const missingExpectedShapes = (issue: ParseResult.ParseIssue): ReadonlyMap<string, string> => {
  const expected = new Map<string, string>();

  const visit = (current: ParseResult.ParseIssue, path: readonly PropertyKey[]): void => {
    switch (current._tag) {
      case "Pointer":
        visit(current.issue, [...path, ...pathParts(current.path)]);
        break;
      case "Composite":
        for (const child of issueParts(current.issues)) {
          visit(child, path);
        }
        break;
      case "Refinement":
      case "Transformation":
        visit(current.issue, path);
        break;
      case "Missing":
        expected.set(pathKey(path), propertyExpectedShape(String(current.ast)));
        break;
      case "Forbidden":
      case "Type":
      case "Unexpected":
        break;
    }
  };

  visit(issue, []);
  return expected;
};

const pathParts = (path: ParseResult.Path): readonly PropertyKey[] =>
  Array.isArray(path) ? path : [path as PropertyKey];

const issueParts = (
  issues: ParseResult.SingleOrNonEmpty<ParseResult.ParseIssue>,
): readonly ParseResult.ParseIssue[] =>
  Array.isArray(issues)
    ? (issues as readonly ParseResult.ParseIssue[])
    : [issues as ParseResult.ParseIssue];

const propertyExpectedShape = (ast: string): string => {
  const separator = ast.indexOf(": ");
  return separator === -1 ? ast : ast.slice(separator + 2);
};

const pathKey = (path: readonly PropertyKey[]): string =>
  path
    .map((part) => {
      const value = String(part);
      return `${typeof part}:${value.length}:${value}`;
    })
    .join("|");

const pathStartsWith = (
  path: ReadonlyArray<PropertyKey>,
  prefix: ReadonlyArray<PropertyKey>,
): boolean => prefix.every((part, index) => path[index] === part);

const valueAtPath = (input: unknown, path: readonly (string | number)[]): unknown => {
  let value = input;

  for (const part of path) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    value = (value as Record<PropertyKey, unknown>)[part];
  }

  return value;
};

const formatActual = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }

  return inspect(value, { breakLength: Number.POSITIVE_INFINITY, depth: 4 });
};
