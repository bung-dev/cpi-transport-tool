// 백엔드 응답 계약 (model/*.java @250367e). 백엔드는 이 run에서 바꾸지 않는다.
export interface ArtifactSummary {
  id: string;
  name: string;
  version: string;
}

export type TargetType = 'externalParam' | 'header' | 'property';
export type ReplacementStatus =
  | 'APPLIED'
  | 'PLANNED'
  | 'VALUE_MISMATCH'
  | 'KEY_NOT_FOUND'
  | 'SENSITIVE_SKIPPED'
  | 'FAILED';
export type ArtifactStatus = 'SUCCESS' | 'FAILED';
export type TransportAction = 'CREATED' | 'UPDATED' | 'NONE';
export type DeployStatus = 'STARTED' | 'ERROR' | 'TIMEOUT' | 'NOT_REQUESTED' | 'SKIPPED_DRY_RUN';

export interface Replacement {
  targetType: TargetType;
  key: string;
  status: ReplacementStatus;
  before: string | null;
  after: string | null;
  occurrences: number;
}

export interface UnmappedKey {
  targetType: TargetType;
  key: string;
}

export interface ArtifactError {
  code: string;
  message: string;
}

export interface ArtifactResult {
  artifactId: string;
  status: ArtifactStatus;
  action: TransportAction;
  replacements: Replacement[];
  unmappedKeys: UnmappedKey[];
  deployStatus: DeployStatus;
  error: ArtifactError | null;
}

export interface TransportSummary {
  total: number;
  succeeded: number;
  failed: number;
}

export interface TransportResponse {
  transportId: string;
  packageId: string;
  dryRun: boolean;
  deploy: boolean;
  startedAt: string;
  finishedAt: string;
  summary: TransportSummary;
  results: ArtifactResult[];
}

export interface TransportRequest {
  packageId: string;
  artifactIds?: string[];
  dryRun?: boolean;
  deploy?: boolean;
}
