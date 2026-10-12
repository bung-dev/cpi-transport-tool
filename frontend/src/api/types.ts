// 백엔드 model/*.java의 테넌트 및 이관 응답 계약.
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
  sourceTenant?: TenantRef;
  targetTenant?: TenantRef;
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
  sourceTenantId?: string;
  targetTenantId?: string;
  packageId: string;
  artifactIds?: string[];
  dryRun?: boolean;
  deploy?: boolean;
}

export type TenantSource = 'env' | 'registered';
export interface Tenant { id: string; name: string; source: TenantSource; apiHost: string; createdAt: string | null }
export type TenantStore = 'OK' | 'NOT_CONFIGURED' | 'UNREADABLE';
export interface TenantsResponse { store: TenantStore; tenants: Tenant[] }
export type TenantCheck = 'OK' | 'TOKEN_FAILED' | 'API_FORBIDDEN' | 'UNREACHABLE' | 'ERROR';
export interface TenantStatusItem { id: string; name: string; source: TenantSource; apiHost: string; check: TenantCheck }
export interface TenantStatusResponse { readOnly: boolean; tenants: TenantStatusItem[] }
export interface TenantRef { id: string; name: string }
