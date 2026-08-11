import { Effect } from "effect";

export class BadService extends Effect.Service<BadService>()("BadService", {
  // @ts-expect-error - The fixture intentionally declares a primitive service.
  succeed: "value" as const,
}) {}
