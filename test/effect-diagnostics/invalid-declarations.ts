import { Context, Schema } from "effect";

interface ClockShape {
  readonly now: number;
}

declare class DifferentClockService {}

export class ClockService extends Context.Tag("ClockService")<
  DifferentClockService,
  ClockShape
>() {}

export class User extends Schema.Class<User>("User")({
  name: Schema.String,
}) {
  constructor(readonly input: { readonly name: string }) {
    super(input);
  }
}
