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
import { agentInvocationView } from "./agentInvocationView.js";

const validationRunFindingView = (finding: ValidationRunFindingRecord): StructuredObject => ({
  validationRunId: finding.validationRunId,
  phase: finding.phase,
  producer: finding.producer,
  source: `${finding.phase}/${finding.producer}`,
  title: finding.title,
  description: finding.description,
  evidence: finding.evidence,
  files: finding.files,
  artifactRefs: finding.artifactRefs,
});

export const candidateValidationRunInspectionView = (
  inspection: CandidateValidationRunInspection,
): StructuredObject => ({
  validationRun: {
    id: inspection.validationRun.id,
    candidateId: inspection.validationRun.candidateId,
    state: inspection.validationRun.state,
    outcome: inspection.validationRun.outcome,
  },
  change: candidateValidationChangeView(inspection.change),
  candidate: candidateView(inspection.candidate),
  workspace: {
    cleanup: inspection.validationRun.cleanup.state,
    blockingReason: inspection.validationRun.cleanup.blockingReason,
  },
  validationInput: structuredValue(inspection.validationRun.validationInput),
  phases: [
    { phase: validationPhase.prepare, results: inspection.prepareResults },
    { phase: validationPhase.checks, results: inspection.checkResults },
    { phase: validationPhase.acceptanceReview, results: inspection.acceptanceResults },
    { phase: validationPhase.specialistReview, results: inspection.specialistResults },
  ],
  findings: inspection.findings.map(validationRunFindingView),
  toolingFailures: inspection.toolingFailures,
  agentInvocations: structuredValue(inspection.agentInvocations.map(agentInvocationView)),
  artifacts: inspection.artifacts.map(candidateValidationArtifactView),
  stallDetection:
    inspection.stallDetection === null ? null : structuredValue(inspection.stallDetection),
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
  reviewerConfiguration: structuredValue(change.policy.reviewerConfiguration),
});

const candidateView = (candidate: CandidateRecord): StructuredObject => ({
  id: candidate.id,
  changeId: candidate.changeId,
  changeBaseSha: candidate.changeBaseSha,
  headSha: candidate.headSha,
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
});

const candidateValidationArtifactPreviewView = (
  preview: CandidateValidationArtifactPreview,
): StructuredObject => ({
  ...preview,
});

const candidateValidationArtifactDetailCommand = (
  artifact: Pick<CandidateValidationArtifactRecord, "validationRunId" | "ref">,
): string => `by validation-run artifact ${artifact.validationRunId} ${artifact.ref}`;
