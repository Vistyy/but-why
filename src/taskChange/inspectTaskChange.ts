export type TaskChangeActivity = "blocked" | "validating" | "ready" | "implementing";

export type TaskChangeProjection = {
  readonly id: string;
  readonly activity?: TaskChangeActivity;
};
