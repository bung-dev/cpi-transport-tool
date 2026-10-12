import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import { TenantProvider } from './TenantContext';
import { TenantTab } from './TenantTab';
import type { Tenant, TenantStore } from '../../api/types';
const REGISTERED: Tenant = { id: 't-new', name: '새 테넌트', apiHost: 'localhost', source: 'registered', createdAt: null };
const KEY = { oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: 'test-dummy-client', clientsecret: 'test-dummy-value' } };
afterEach(() => vi.unstubAllGlobals());
function fixed(store: TenantStore = 'OK') {
  return render(<TestTenantProvider value={{ tenants: { state: 'success', data: { store, tenants: [...TENANTS_OK.tenants, REGISTERED] } } }}><TenantTab /></TestTenantProvider>);
}
function live(extra: Parameters<typeof mockApi>[0] = {}) {
  let added = false;
  const bodies: unknown[] = [];
  const fn = mockApi({
    'GET /tenants': () => json({ store: 'OK', tenants: added ? [...TENANTS_OK.tenants, REGISTERED] : TENANTS_OK.tenants }),
    'GET /tenants/status': () => json({ ...TENANT_STATUS_OK, tenants: [...TENANT_STATUS_OK.tenants, { ...REGISTERED, check: 'OK' }] }),
    'POST /tenants': init => { bodies.push(JSON.parse(init?.body as string)); added = true; return json(REGISTERED, 201); }, ...extra,
  });
  render(<TenantProvider openTenantsTab={() => {}}><TenantTab /></TenantProvider>);
  return { fn, bodies };
}
async function fill() {
  await screen.findByText('DEV');
  await userEvent.type(screen.getByLabelText('이름'), '새 테넌트');
  await userEvent.click(screen.getByLabelText('서비스 키 붙여넣기')); await userEvent.paste(JSON.stringify(KEY));
}
it('REQ-301 AC-8·AC-9: 목록 이름, 호스트, 출처와 env 수정 삭제 없음', () => {
  fixed(); const env = screen.getByText('DEV').closest('li')!;
  expect(within(env).getByText('localhost')).toBeInTheDocument(); expect(within(env).getByText('환경 변수')).toBeInTheDocument();
  expect(within(env).queryByRole('button')).toBeNull();
  const row = screen.getByText('새 테넌트').closest('li')!;
  expect(within(row).getByText('등록')).toBeInTheDocument(); expect(within(row).getByRole('button', { name: '수정' })).toBeInTheDocument();
});
it.each([
  ['OK', '연결됨', 'success'], ['TOKEN_FAILED', '인증 실패', 'danger'], ['API_FORBIDDEN', '권한 없음', 'danger'],
  ['UNREACHABLE', '연결 안 됨', 'danger'], ['ERROR', '오류', 'danger'],
] as const)('REQ-301 AC-8·AC-9: 상태 %s의 글자와 톤', (check, label, tone) => {
  render(<TestTenantProvider value={{ status: { state: 'success', data: { readOnly: false, tenants: [{ ...TENANT_STATUS_OK.tenants[0], check }] } } }}><TenantTab /></TestTenantProvider>);
  expect(screen.getByText(label).className).toContain(`bg-${tone}-bg`);
});
it('REQ-301 AC-8·AC-9: 응답 대기는 확인 중, 요청 실패는 확인 실패 danger', () => {
  const view = render(<TestTenantProvider value={{ status: { state: 'loading' } }}><TenantTab /></TestTenantProvider>);
  expect(screen.getAllByText('확인 중')[0].className).toContain('bg-neutral-bg');
  view.rerender(<TestTenantProvider value={{ status: { state: 'error', error: { title: 'failed' } } }}><TenantTab /></TestTenantProvider>);
  expect(screen.getAllByText('확인 실패')[0].className).toContain('bg-danger-bg');
});
it('REQ-301 AC-8·AC-9 / REQ-302 AC-7 / REQ-305 AC-3: 붙여넣기 등록 뒤 비움과 두 API 재조회, 입력 키 부재', async () => {
  const { fn, bodies } = live(); await fill(); await userEvent.click(screen.getByRole('button', { name: '등록' }));
  await screen.findByText('새 테넌트'); expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: KEY }]);
  expect(screen.getByLabelText('이름')).toHaveValue(''); expect(screen.getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
  expect(document.body.textContent).not.toContain('test-dummy-value'); expect(screen.queryByDisplayValue(/test-dummy/)).toBeNull();
  expect(fn.mock.calls.filter(([url, init]) => url === '/tenants' && !init?.method)).toHaveLength(2);
  expect(fn.mock.calls.filter(([url]) => url === '/tenants/status')).toHaveLength(2);
});
it('REQ-301 AC-8·AC-9: 파일 우선 등록과 파일 입력 비움', async () => {
  const { bodies } = live(); await fill();
  const fileKey = { oauth: { clientsecret: 'test-dummy-file' } };
  const file = new File([JSON.stringify(fileKey)], 'dummy.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(fileKey) });
  await userEvent.upload(screen.getByLabelText('서비스 키 파일'), file);
  await userEvent.click(screen.getByRole('button', { name: '등록' })); await screen.findByText('새 테넌트');
  expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: fileKey }]); expect(screen.getByLabelText('서비스 키 파일')).toHaveValue('');
});
it.each(['{bad', '[]', 'null', '42'])('REQ-301 AC-8·AC-9: 잘못된 JSON %s 전송 없음', async text => {
  const { fn } = live(); await screen.findByText('DEV'); await userEvent.type(screen.getByLabelText('이름'), '새 이름');
  await userEvent.click(screen.getByLabelText('서비스 키 붙여넣기')); await userEvent.paste(text);
  await userEvent.click(screen.getByRole('button', { name: '등록' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 키 JSON 형식이 아닙니다');
  expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it.each([
  ['INVALID_SERVICE_KEY', '서비스 키가 올바르지 않습니다'], ['TENANT_NAME_DUPLICATE', '같은 이름의 테넌트가 이미 있습니다'],
  ['TENANT_STORE_NOT_CONFIGURED', '테넌트 저장소가 설정되지 않았습니다'], ['TENANT_STORE_UNREADABLE', '테넌트 저장 파일을 읽지 못했습니다'],
])('REQ-301 AC-8·AC-9: 서버 오류 %s 제목과 message', async (error, title) => {
  live({ 'POST /tenants': () => json({ error, message: 'fixed server message' }, 409) }); await fill();
  await userEvent.click(screen.getByRole('button', { name: '등록' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(title); expect(screen.getByRole('alert')).toHaveTextContent('fixed server message');
});
it.each(['name', 'serviceKey'])('REQ-301 AC-8·AC-9: 수정은 빈 입력과 준 %s 필드만 PUT', async field => {
  let body: unknown;
  mockApi({ 'PUT /tenants/t-new': init => { body = JSON.parse(init?.body as string); return json(REGISTERED); } }); fixed();
  await userEvent.click(screen.getByRole('button', { name: '수정' })); const form = screen.getByText('새 테넌트').closest('li')!;
  expect(within(form).getByLabelText('이름')).toHaveValue(''); expect(within(form).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
  if (field === 'name') await userEvent.type(within(form).getByLabelText('이름'), '바꾼 이름');
  else { await userEvent.click(within(form).getByLabelText('서비스 키 붙여넣기')); await userEvent.paste(JSON.stringify(KEY)); }
  await userEvent.click(within(form).getByRole('button', { name: '저장' }));
  await waitFor(() => expect(body).toEqual(field === 'name' ? { name: '바꾼 이름' } : { serviceKey: KEY }));
});
it('REQ-301 AC-8·AC-9: 삭제 포털, Esc·취소·포커스 복귀와 확인 후 DELETE 및 재조회', async () => {
  const reload = vi.fn(async () => {}); const fn = mockApi({ 'DELETE /tenants/t-new': () => new Response(null, { status: 204 }) });
  const { container } = render(<TestTenantProvider value={{ reload, tenants: { state: 'success', data: { store: 'OK', tenants: [REGISTERED] } } }}><TenantTab /></TestTenantProvider>);
  const opener = screen.getByRole('button', { name: '삭제' }); await userEvent.click(opener);
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true'); expect(container.contains(screen.getByRole('dialog'))).toBe(false);
  expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}'); expect(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' })).toHaveFocus();
  await userEvent.keyboard('{Escape}'); expect(opener).toHaveFocus();
  await userEvent.click(opener); await userEvent.click(screen.getByRole('button', { name: '취소' })); expect(opener).toHaveFocus(); expect(fn).not.toHaveBeenCalled();
  await userEvent.click(opener); await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(reload).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith('/tenants/t-new', { method: 'DELETE' });
});
it.each([
  ['NOT_CONFIGURED', '테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다'],
  ['UNREADABLE', '테넌트 저장 파일을 읽지 못했습니다. 저장소 키를 확인하세요'],
] as const)('REQ-301 AC-8·AC-9: 저장소 %s 안내와 폼 비활성', (store, text) => {
  fixed(store); expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByLabelText('이름')).toBeDisabled(); expect(screen.getByLabelText('서비스 키 붙여넣기')).toBeDisabled();
  expect(screen.getByLabelText('서비스 키 파일')).toBeDisabled(); expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
});
it('REQ-301 AC-8·AC-9: 목록 로딩과 오류 재시도', async () => {
  const reload = vi.fn(async () => {});
  const v = render(<TestTenantProvider value={{ tenants: { state: 'loading' } }}><TenantTab /></TestTenantProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중');
  v.rerender(<TestTenantProvider value={{ reload, tenants: { state: 'error', error: { title: '목록 실패' } } }}><TenantTab /></TestTenantProvider>);
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' })); expect(reload).toHaveBeenCalledTimes(1);
});
