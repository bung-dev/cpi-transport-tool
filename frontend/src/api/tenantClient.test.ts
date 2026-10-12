import { afterEach, expect, it, vi } from 'vitest';
import { deleteTenant, getTenants, getTenantStatus, registerTenant, updateTenant } from './client';
import { mockApi, json } from '../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../test/tenantFixtures';
afterEach(() => vi.unstubAllGlobals());
it('REQ-301 AC-8: 테넌트 API 메서드와 경로, 객체 본문 및 204 응답', async () => {
  const bodies: unknown[] = [];
  const fn = mockApi({
    'GET /tenants': () => json(TENANTS_OK),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /tenants/status?refresh=true': () => json(TENANT_STATUS_OK),
    'POST /tenants': init => { bodies.push(JSON.parse(init?.body as string)); return json(TENANTS_OK.tenants[0], 201); },
    'PUT /tenants/a%2Fb': init => { bodies.push(JSON.parse(init?.body as string)); return json(TENANTS_OK.tenants[0]); },
    'DELETE /tenants/a%2Fb': () => new Response(null, { status: 204 }),
  });
  expect(await getTenants()).toEqual(TENANTS_OK);
  expect(await getTenantStatus()).toEqual(TENANT_STATUS_OK);
  await getTenantStatus(true);
  await registerTenant('새 테넌트', { oauth: { clientsecret: 'test-dummy-value' } });
  await updateTenant('a/b', { name: '새 이름' });
  expect(await deleteTenant('a/b')).toBeUndefined();
  expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: { oauth: { clientsecret: 'test-dummy-value' } } }, { name: '새 이름' }]);
  expect(fn.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['/tenants', 'GET'], ['/tenants/status', 'GET'], ['/tenants/status?refresh=true', 'GET'],
    ['/tenants', 'POST'], ['/tenants/a%2Fb', 'PUT'], ['/tenants/a%2Fb', 'DELETE'],
  ]);
  expect(fn.mock.calls[3][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
});
