// 백엔드 model/*.java의 테넌트 및 이관 응답 계약.
export interface ArtifactSummary {
  id: string;
  name: string;
  version: string;
}

export type ConfigurationStatus = 'PLANNED' | 'BUNDLED' | 'COPIED' | 'SKIPPED_EMPTY' | 'FAILED';
export type ArtifactStatus = 'SUCCESS' | 'FAILED';
export type TransportAction = 'CREATED' | 'UPDATED' | 'NONE';
export type DeployStatus = 'STARTED' | 'ERROR' | 'TIMEOUT' | 'NOT_REQUESTED' | 'SKIPPED_DRY_RUN';

export interface ConfigurationItem {
  key: string;
  value: string | null;
  dataType: string | null;
  status: ConfigurationStatus;
}

export interface ArtifactError {
  code: string;
  message: string;
  detail?: string | null;
  detailHttpStatus?: number | null;
}

export interface ArtifactResult {
  packageId?: string;
  artifactId: string;
  status: ArtifactStatus;
  action: TransportAction;
  configurations: ConfigurationItem[];
  deployStatus: DeployStatus;
  error: ArtifactError | null;
}

export interface TransportSummary {
  total: number;
  succeeded: number;
  failed: number;
}

export type TargetPackageStatus = 'NOT_CHECKED' | 'EXISTING' | 'CREATED' | 'CREATE_FAILED' | 'NOT_FOUND' | 'CHECK_FAILED';

export interface TransportPackage {
  packageId: string;
  packageName: string | null;
  targetPackage: TargetPackageStatus | null;
}

export interface TransportResponse {
  sourceTenant?: TenantRef;
  targetTenant?: TenantRef;
  /** 템플릿으로 실행한 경우 실행 당시의 템플릿 id·이름. 템플릿 없이 실행했으면 필드가 없다(REQ-424·425). */
  template?: { id: string; name: string };
  transportId: string;
  packages: TransportPackage[];
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
  packages: { packageId: string; artifactIds?: string[] }[];
  createPackages?: string[];
  dryRun?: boolean;
  deploy?: boolean;
  /** 템플릿으로 시작했고 경로를 바꾸지 않았을 때만 보낸다(REQ-423). */
  templateId?: string;
}

export type TenantSource = 'env' | 'registered';
export interface Tenant { id: string; name: string; source: TenantSource; apiHost: string; createdAt: string | null }
export type TenantStore = 'OK' | 'NOT_CONFIGURED' | 'UNREADABLE';
export interface TenantsResponse { store: TenantStore; tenants: Tenant[] }
export type TenantCheck = 'OK' | 'TOKEN_FAILED' | 'API_FORBIDDEN' | 'UNREACHABLE' | 'ERROR';
export interface TenantStatusItem { id: string; name: string; source: TenantSource; apiHost: string; check: TenantCheck }
export interface TenantStatusResponse { readOnly: boolean; tenants: TenantStatusItem[] }
export interface TenantRef { id: string; name: string }

export interface TemplateInput { name: string; sourceTenantId: string; targetTenantId: string }
export interface TransportTemplate extends TemplateInput {
  id: string; createdAt: string; updatedAt: string; usable: boolean;
  unusableReason?: 'SOURCE_TENANT_MISSING' | 'TARGET_TENANT_MISSING';
}
export interface Settings {
  previewConcurrency: number;
  transportConcurrency: number;
}

export type AuditCategory = 'tenant' | 'template' | 'transport' | 'settings';
export interface AuditEntry {
  id: string; time: string; category: AuditCategory;
  action: 'created' | 'updated' | 'deleted' | 'preview' | 'transport';
  objectId: string; objectName: string; detail: string;
}

export interface DashboardNode { id: string; name: string; origin: TenantSource }
export interface DashboardEdge { sourceTenantId: string; targetTenantId: string; templateIds: string[] }
export interface DashboardQueueItem {
  packageId: string;
  atTenantId: string;
  nextTemplateId: string;
  nextTargetTenantId: string;
  arrivedTransportId: string;
  arrivedAt: string;
  artifactCount: number;
}
export interface DashboardResponse {
  nodes: DashboardNode[];
  edges: DashboardEdge[];
  queue: DashboardQueueItem[];
  today: { previews: number; transports: number; succeeded: number; failed: number };
}
