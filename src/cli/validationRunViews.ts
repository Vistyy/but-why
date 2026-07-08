import type { StructuredObject } from "../output/structured.js";
import type { TaskRecord } from "../task/task.js";
import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
  ValidationRunRecord,
} from "../validationRun/validationRun.js";

export const taskBriefView = (task: TaskRecord): StructuredObject => ({
  id: task.id,
  title: task.title,
  state: task.state,
});

export const validationRunBriefView = (run: ValidationRunRecord): StructuredObject => ({
  id: run.id,
  taskValidationNumber: run.taskValidationNumber,
  status: run.status,
  branch: run.branch,
  commit: run.commitSha,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

export const validationRunDetailView = (run: ValidationRunRecord): StructuredObject => ({
  id: run.id,
  taskId: run.taskId,
  taskValidationNumber: run.taskValidationNumber,
  status: run.status,
  branch: run.branch,
  commit: run.commitSha,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

type ValidationRunSummaryViewInput = {
  readonly id: string;
  readonly taskValidationNumber: number;
  readonly status: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly findingCount: number;
  readonly toolingFailureCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const validationRunSummaryView = (run: ValidationRunSummaryViewInput): StructuredObject => ({
  id: run.id,
  taskValidationNumber: run.taskValidationNumber,
  status: run.status,
  branch: run.branch,
  commit: run.commitSha,
  findingCount: run.findingCount,
  toolingFailureCount: run.toolingFailureCount,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

export const validationRunFindingView = (
  finding: ValidationRunFindingRecord,
): StructuredObject => ({
  id: finding.id,
  validationRunId: finding.validationRunId,
  phase: finding.phase,
  producer: finding.producer,
  source: `${finding.phase}/${finding.producer}`,
  title: finding.title,
  description: finding.description,
  ...(finding.severity === undefined ? {} : { severity: finding.severity }),
  evidence: finding.evidence,
  files: finding.files,
  artifactRefs: finding.artifactRefs,
  createdAt: finding.createdAt,
  updatedAt: finding.updatedAt,
});

export const validationRunArtifactView = (
  artifact: ValidationRunArtifactRecord,
): StructuredObject => ({
  ref: artifact.ref,
  validationRunId: artifact.validationRunId,
  phase: artifact.phase,
  producer: artifact.producer,
  path: artifact.path,
  createdAt: artifact.createdAt,
});
