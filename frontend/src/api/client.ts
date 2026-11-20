import { ApiRequestError, networkError, parseErrorBody, unknownError } from './errors';
import type { ArtifactSummary, TransportRequest, TransportResponse, Tenant, TenantsResponse, TenantStatusResponse } from './types';
import type { TransportTemplate, TemplateInput, AuditCategory, AuditEntry } from './types';
import type { DashboardResponse, Settings } from './types';

// REQ-002 AC-4, REQ-012 AC-2: 같은 출처의 상대 경로만 쓴다. 기준 URL이나 환경 변수 값은 없다.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(networkError());
  }
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      // 본문을 못 읽어도 상태 코드로 알 수 없는 오류를 만든다.
    }
    throw new ApiRequestError(parseErrorBody(res.status, text), res.status);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiRequestError(unknownError(res.status));
  }
}

export function getPackages(tenantId?: string): Promise<ArtifactSummary[]> {
  return request(`/packages${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);
}

export function getArtifacts(packageId: string, tenantId?: string): Promise<ArtifactSummary[]> {
  return request(`/packages/${encodeURIComponent(packageId)}/artifacts${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);
}

export function getTargetPackageStatus(tenantId: string, packageIds: string[]): Promise<{ packageId: string; exists: boolean }[]> {
  return request(`/packages/target-status?tenantId=${encodeURIComponent(tenantId)}&packageIds=${packageIds.map(encodeURIComponent).join(',')}`);
}

export function postTransport(body: TransportRequest): Promise<TransportResponse> {
  return request('/transport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getHistory(): Promise<TransportResponse[]> {
  return request('/transport/history');
}

export function getDashboard(templateId?: string): Promise<DashboardResponse> {
  return request(`/dashboard${templateId ? `?templateId=${encodeURIComponent(templateId)}` : ''}`);
}

export function getTenants(): Promise<TenantsResponse> { return request('/tenants'); }
export function getTenantStatus(refresh = false): Promise<TenantStatusResponse> {
  return request(refresh ? '/tenants/status?refresh=true' : '/tenants/status');
}
export function registerTenant(name: string, serviceKey: Record<string, unknown>): Promise<Tenant> {
  return request('/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, serviceKey }) });
}
export function updateTenant(id: string, fields: { name?: string; serviceKey?: Record<string, unknown> }): Promise<Tenant> {
  return request(`/tenants/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
}
export function deleteTenant(id: string, deleteTemplates = false): Promise<void> {
  return request(`/tenants/${encodeURIComponent(id)}${deleteTemplates ? '?deleteTemplates=true' : ''}`, { method: 'DELETE' });
}

export function getTemplates(): Promise<TransportTemplate[]> { return request('/templates'); }
export function saveTemplate(body: TemplateInput, id?: string): Promise<TransportTemplate> {
  return request(id ? `/templates/${encodeURIComponent(id)}` : '/templates', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
export function deleteTemplate(id: string): Promise<void> { return request(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export function getAudit(category: AuditCategory | 'all'): Promise<AuditEntry[]> { return request(`/audit?category=${category}`); }

export function getSettings(): Promise<Settings> {
  return request('/settings');
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return request('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
