import { openSqliteTaskStore } from "../../src/sqlite/sqliteTaskStore.js";
import type { TaskStore } from "../../src/task/taskStore.js";
import { createSqliteStateSession } from "./sqliteState.js";

export const createTaskStore = (taskPrefix = "BY"): TaskStore =>
  openSqliteTaskStore({ ...createSqliteStateSession(), taskPrefix });
