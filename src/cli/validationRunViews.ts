import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  CandidateValidationArtifactInspection,
  CandidateValidationArtifactPreview,
  CandidateValidationArtifactRecord,
  CandidateValidationRunInspection,
} from "../change/candidateValidation/inspectCandidateValidationRun.js";
import type { ChangeRecord } from "../change/change.js";
import type { StructuredObject } from "../output/structured.js";
import {
  validationPhase,
  type ValidationRunFindingRecord,
} from "../change/validationRun/validationRun.js";

const validationRunFindingView = (finding: ValidationRunFindingRecord): StructuredObject => ({
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

export const candidateValidationRunInspectionView = (
  inspection: CandidateValidationRunInspection,
): StructuredObject => ({
  validationRun: {
    id: inspection.validationRun.id,
    candidateId: inspection.validationRun.candidateId,
    state: inspection.validationRun.state,
    outcome: inspection.validationRun.outcome,
    createdAt: inspection.validationRun.createdAt,
    updatedAt: inspection.validationRun.updatedAt,
  },
  change: candidateValidationChangeView(inspection.change),
  candidate: candidateView(inspection.candidate),
  policy: inspection.validationRun.policy,
  phases: [
    { phase: validationPhase.prepare, rounds: inspection.prepareRounds },
    { phase: validationPhase.checks, rounds: inspection.checkRounds },
    { phase: validationPhase.acceptanceReview, rounds: inspection.acceptanceRounds },
    { phase: validationPhase.specialistReview, rounds: inspection.specialistRounds },
  ],
  findings: inspection.findings.map(validationRunFindingView),
  toolingFailures: inspection.toolingFailures,
  artifacts: inspection.artifacts.map(candidateValidationArtifactView),
});

export const candidateValidationArtifactContentView = (
  artifact: CandidateValidationArtifactRecord,
  content: string,
): StructuredObject => ({
  artifact: candidateValidationArtifactMetadataView(artifact),
  content,
});

const candidateValidationChangeView = (change: ChangeRecord): StructuredObject => ({
  id: change.id,
  branchRef: change.branchRef,
  baseRef: change.baseRef,
  taskId: change.taskId,
  state: change.state,
});

const candidateView = (candidate: CandidateRecord): StructuredObject => ({
  id: candidate.id,
  changeId: candidate.changeId,
  selectedBaseRef: candidate.selectedBaseRef,
  resolvedTargetSha: candidate.resolvedTargetSha,
  comparisonBaseSha: candidate.comparisonBaseSha,
  headSha: candidate.headSha,
  createdAt: candidate.createdAt,
});

const candidateValidationArtifactView = (
  artifact: CandidateValidationArtifactInspection,
): StructuredObject => ({
  ...candidateValidationArtifactMetadataView(artifact),
  preview: candidateValidationArtifactPreviewView(artifact, artifact.preview),
});

const candidateValidationArtifactMetadataView = (
  artifact: CandidateValidationArtifactRecord,
): StructuredObject => ({
  ref: artifact.ref,
  validationRunId: artifact.validationRunId,
  phase: artifact.phase,
  producer: artifact.producer,
  path: artifact.path,
  originalBytes: artifact.originalBytes,
  storedBytes: artifact.storedBytes,
  truncated: artifact.truncated,
  createdAt: artifact.createdAt,
});

const candidateValidationArtifactPreviewView = (
  artifact: CandidateValidationArtifactRecord,
  preview: CandidateValidationArtifactPreview,
): StructuredObject => ({
  ...preview,
  detailCommand: candidateValidationArtifactDetailCommand(artifact),
});

const candidateValidationArtifactDetailCommand = (
  artifact: Pick<CandidateValidationArtifactRecord, "validationRunId" | "ref">,
): string => `by validation-run artifact ${artifact.validationRunId} ${artifact.ref}`;
