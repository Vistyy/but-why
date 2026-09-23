import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";

export interface ModelSlug {
  readonly provider: string;
  readonly id: string;
  readonly value: string;
}

export interface SelectedModel {
  readonly slug: ModelSlug;
  readonly model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
  readonly runtime: ModelRuntime;
}

export type ThinkingLevel = Parameters<typeof clampThinkingLevel>[1];

export class ModelSelectionError extends Data.TaggedError("ModelSelectionError")<{
  readonly message: string;
}> {}

function failure(message: string): ModelSelectionError {
  return new ModelSelectionError({ message });
}

export function parseThinkingLevel(
  value: string | undefined,
): Effect.Effect<ThinkingLevel, ModelSelectionError> {
  const requested = value ?? "medium";

  switch (requested) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return Effect.succeed(requested);
    default:
      return Effect.fail(
        failure("Thinking level must be off, minimal, low, medium, high, xhigh, or max"),
      );
  }
}

export function effectiveThinkingLevel(
  selected: SelectedModel,
  requested: ThinkingLevel,
): ThinkingLevel {
  return clampThinkingLevel(selected.model, requested);
}

export function parseModelSlug(
  value: string | undefined,
): Effect.Effect<ModelSlug, ModelSelectionError> {
  if (value === undefined)
    return Effect.fail(failure("Choose a reviewer model with --model or config.json model"));

  const slash = value.indexOf("/");
  const provider = value.slice(0, slash);
  const id = value.slice(slash + 1);

  if (
    slash < 1 ||
    id.length === 0 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(provider) ||
    /\s|\0/u.test(value)
  )
    return Effect.fail(failure("Reviewer model must be an exact provider/model-id"));

  return Effect.succeed({ provider, id, value });
}

export function resolveReviewModel(
  slug: ModelSlug,
): Effect.Effect<SelectedModel, ModelSelectionError> {
  return Effect.gen(function* () {
    const runtime = yield* Effect.tryPromise({
      try: (signal) => ModelRuntime.create({ signal, allowModelNetwork: false }),
      catch: () => failure("Cannot load Pi's model catalog or credentials"),
    });

    const model = runtime.getModel(slug.provider, slug.id);

    if (model === undefined) return yield* failure(`Unknown reviewer model: ${slug.value}`);

    const available = yield* Effect.tryPromise({
      try: (signal) => runtime.getAvailable(slug.provider, { signal }),
      catch: () => failure(`Cannot check reviewer model availability: ${slug.value}`),
    });

    if (
      !available.some(
        (candidate) => candidate.provider === slug.provider && candidate.id === slug.id,
      )
    )
      return yield* failure(`Reviewer model is not authenticated or available: ${slug.value}`);

    return { slug, model, runtime };
  });
}
