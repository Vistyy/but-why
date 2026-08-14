import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  CandidateValidationArtifactInspection,
  CandidateValidationArtifactPreview,
  CandidateValidationArtifactRecord,
  CandidateValidationRunInspection,
} from "../change/candidateValidation/inspectCandidateValidationRun.js";
import type { ChangeRecord } from "../change/change.js";
import {
  type ValidationRunFindingRecord,
  validationPhase,
} from "../change/validationRun/validationRun.js";
import type { StructuredObject } from "../output/structured.js";
import { structuredValue } from "../output/structuredValue.js";

const validationRunFindingView = (finding: ValidationRunFindingRecord): StructuredObject => ({
  id: finding.id,
  validationRunId: finding.validationRunId,
  phase: finding.phase,
  producer: finding.producer,
  source: `${finding.phase}/${finding.producer}`,
  title: finding.title,
  description: finding.description,
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
  ...(inspection.change.reviewerConfiguration === null ||
  inspection.change.reviewerConfiguration === undefined
    ? { policy: structuredValue(inspection.validationRun.policy) }
    : { reviewerConfiguration: structuredValue(inspection.change.reviewerConfiguration) }),
  phases: [
    { phase: validationPhase.prepare, rounds: inspection.prepareRounds },
    { phase: validationPhase.checks, rounds: inspection.checkRounds },
    { phase: validationPhase.acceptanceReview, rounds: inspection.acceptanceRounds },
    { phase: validationPhase.specialistReview, rounds: inspection.specialistRounds },
  ],
  findings: inspection.findings.map(validationRunFindingView),
  toolingFailures: inspection.toolingFailures,
  ...(inspection.change.reviewerConfiguration === null ||
  inspection.change.reviewerConfiguration === undefined
    ? {}
    : { agentInvocations: structuredValue(inspection.agentInvocations) }),
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
  state: change.state,
  ...(change.reviewerConfiguration === null || change.reviewerConfiguration === undefined
    ? {}
    : { reviewerConfiguration: structuredValue(change.reviewerConfiguration) }),
});

const candidateView = (candidate: CandidateRecord): StructuredObject => ({
  id: candidate.id,
  changeId: candidate.changeId,
  changeBaseSha: candidate.changeBaseSha,
  headSha: candidate.headSha,
  createdAt: candidate.createdAt,
});

const candidateValidationArtifactView = (
  artifact: CandidateValidationArtifactInspection,
): StructuredObject => ({
  ...candidateValidationArtifactMetadataView(artifact),
  detailCommand: candidateValidationArtifactDetailCommand(artifact),
  ...(artifact.preview === undefined
    ? {}
    : { preview: candidateValidationArtifactPreviewView(artifact.preview) }),
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
  preview: CandidateValidationArtifactPreview,
): StructuredObject => ({
  ...preview,
});

const candidateValidationArtifactDetailCommand = (
  artifact: Pick<CandidateValidationArtifactRecord, "validationRunId" | "ref">,
): string => `by validation-run artifact ${artifact.validationRunId} ${artifact.ref}`;
