import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import { json, mockApi, PACKAGES } from '../../test/mockFetch';
import { navLink, setHash } from '../../test/appRoutes';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TenantProvider, useTenants } from './TenantContext';
import { TestTenantProvider } from '../../test/tenantProvider';
import { TransportWizard } from '../transport/TransportWizard';
import { useWizard } from '../transport/useWizard';
afterEach(() => vi.unstubAllGlobals());
/** 새 이관 마법사(상태 + 화면)를 App 없이 그린다 */
function Wizard() {
  const w = useWizard();
  return <TransportWizard wizard={w} />;
}
function Probe() {
  const c = useTenants();
  return <><output>{String(c.readOnly)}|{c.sourceTenantId ?? '-'}|{c.targetTenantId ?? '-'}</output>
    <button onClick={() => void c.reload()}>reload</button><button onClick={() => void c.refreshStatus()}>refresh</button>
    <button onClick={() => c.setSourceTenantId('other')}>select</button></>;
}
it('REQ-302 AC-7: App 두 API는 최초 1회, 화면 전환은 재요청하지 않음', async () => {
  const fn = mockApi({ 'GET /tenants': () => json(TENANTS_OK), 'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages?tenantId=DEV': () => json(PACKAGES), 'GET /transport/history': () => json([]), 'GET /templates': () => json([]) });
  setHash('#/transport');
  render(<StrictMode><App /></StrictMode>);
  await screen.findByRole('navigation', { name: '이관 단계' });
  await userEvent.click(navLink('테넌트'));
  await screen.findByRole('row', { name: /DEV/ });
  await userEvent.click(navLink('이관 이력'));
  await userEvent.click(navLink('새 이관'));
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
it('REQ-302 AC-7: 하위 컴포넌트(새 이관 마법사 단독 렌더)는 테넌트 조회 API를 부르지 않음', async () => {
  const fn = mockApi({ 'GET /templates': () => json([]), 'GET /packages?tenantId=DEV': () => json(PACKAGES) });
  render(<TestTenantProvider><Wizard /></TestTenantProvider>);
  await userEvent.click(await screen.findByRole('button', { name: '템플릿 없이 진행' }));
  await screen.findByLabelText('패키지 검색');
  await userEvent.click(screen.getByRole('button', { name: '경로 변경' }));
  await screen.findByRole('dialog', { name: '원본과 대상 선택' });
  expect(fn.mock.calls.every(([url]) => !String(url).startsWith('/tenants'))).toBe(true);
});
