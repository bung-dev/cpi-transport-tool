import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import { json, mockApi, PACKAGES } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TenantProvider, useTenants } from './TenantContext';
import { TestTenantProvider } from '../../test/tenantProvider';
import { TransportTab } from '../transport/TransportTab';
import { PackagePicker } from '../transport/PackagePicker';
import { RunPanel } from '../transport/RunPanel';
afterEach(() => vi.unstubAllGlobals());
function Probe() {
  const c = useTenants();
  return <><output>{String(c.readOnly)}|{c.sourceTenantId ?? '-'}|{c.targetTenantId ?? '-'}</output>
    <button onClick={() => void c.reload()}>reload</button><button onClick={() => void c.refreshStatus()}>refresh</button>
    <button onClick={() => c.setSourceTenantId('other')}>select</button></>;
}
it('REQ-302 AC-7: App 두 API는 최초 1회, 탭 전환은 재요청하지 않음', async () => {
  const fn = mockApi({ 'GET /tenants': () => json(TENANTS_OK), 'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages': () => json(PACKAGES), 'GET /transport/history': () => json([]) });
  render(<StrictMode><App /></StrictMode>);
  await screen.findByLabelText('패키지 검색');
  await userEvent.click(screen.getByRole('tab', { name: '테넌트' }));
  await screen.findByText('등록된 테넌트');
  await userEvent.click(screen.getByRole('tab', { name: '이력' }));
  await userEvent.click(screen.getByRole('tab', { name: '이관' }));
  expect(fn.mock.calls.filter(([url]) => url === '/tenants')).toHaveLength(1);
  expect(fn.mock.calls.filter(([url]) => url === '/tenants/status')).toHaveLength(1);
});
it('REQ-302 AC-7: provider 없음은 모름과 선택 없음, 함수는 요청하지 않음', async () => {
  const fn = mockApi({}); render(<Probe />);
  expect(screen.getByRole('status')).toHaveTextContent('undefined|-|-');
  await userEvent.click(screen.getByText('reload')); await userEvent.click(screen.getByText('refresh'));
  expect(fn).not.toHaveBeenCalled();
});
it('REQ-302 AC-7: 기본 선택, 삭제 뒤 선택 해제, 실패 때 readOnly 모름', async () => {
  let removed = false, fail = false;
  const fn = mockApi({ 'GET /tenants': () => json(removed ? { store: 'OK', tenants: [] } : TENANTS_OK),
    'GET /tenants/status': () => fail ? json({}, 500) : json(TENANT_STATUS_OK) });
  render(<TenantProvider openTenantsTab={() => {}}><Probe /></TenantProvider>);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('false|DEV|PRD'));
  removed = true; fail = true;
  await userEvent.click(screen.getByText('reload'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('undefined|-|-'));
  expect(fn).toHaveBeenCalledTimes(4);
});
it('REQ-302 AC-7: 초기 등록 없으면 선택 없음, refresh 중복 요청 억제', async () => {
  let release: (r: Response) => void = () => {};
  const fn = mockApi({ 'GET /tenants': () => json({ store: 'OK', tenants: [] }), 'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /tenants/status?refresh=true': () => new Promise<Response>(r => { release = r; }) });
  render(<TenantProvider openTenantsTab={() => {}}><Probe /></TenantProvider>);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('false|-|-'));
  await userEvent.click(screen.getByText('refresh')); await userEvent.click(screen.getByText('refresh'));
  expect(fn.mock.calls.filter(([url]) => url === '/tenants/status?refresh=true')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('undefined|-|-');
  await act(async () => release(json(TENANT_STATUS_OK)));
});
it('REQ-302 AC-7: 하위 컴포넌트는 테넌트 조회 API를 부르지 않음', async () => {
  const fn = mockApi({ 'GET /packages': () => json(PACKAGES) });
  render(<TestTenantProvider><TransportTab /></TestTenantProvider>);
  await screen.findByLabelText('패키지 검색');
  expect(fn.mock.calls.every(([url]) => !String(url).startsWith('/tenants'))).toBe(true);
});

it('REQ-302 AC-7: PackagePicker와 RunPanel 단독 렌더도 테넌트 요청 없음', async () => {
  const fn = mockApi({ 'GET /packages': () => json(PACKAGES) });
  render(<TestTenantProvider><PackagePicker selectedId={null} onSelect={() => {}} /><RunPanel packageId={null} artifactIds={[]} onResult={() => {}} /></TestTenantProvider>);
  await screen.findByLabelText('패키지 검색');
  expect(fn.mock.calls.every(([url]) => !String(url).startsWith('/tenants'))).toBe(true);
});
