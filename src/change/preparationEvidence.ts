export const boundedEvidence = (value: string): string =>
  value.length <= 1000
    ? value
    : `${value.slice(0, 1000)}\n... (truncated, ${value.length} chars total)`;
