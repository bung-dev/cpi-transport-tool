import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';
import type { Tenant } from '../../api/types';
import { PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import { PackagePicker } from './PackagePicker';
import { RunPanel } from './RunPanel';

// REQ-312: 테넌트 목록이 성공적으로 읽혔고 0개일 때만 "등록" 안내를 한다(직전 D-150).
const REGISTER = '먼저 테넌트를 등록하세요';
const SELECT_SOURCE = '원본 테넌트를 선택하세요';
const SELECT_TARGET = '대상 테넌트를 선택하세요';
const one: Tenant = { id: 'ONE', name: 'ONE', apiHost: 'api.localhost', source: 'registered', createdAt: null };

afterEach(() => vi.unstubAllGlobals());

function setup(tenants: () => Response | Promise<Response>) {
  const fn = mockApi({
    'GET /tenants': tenants,
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages?tenantId=ONE': () => json(PACKAGES),
  });
  render(<App />);
  return fn;
}
const empty = () => json({ store: 'OK', tenants: [] });
const card = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('div.rounded-lg') as HTMLElement;
const tenantCard = () => card('테넌트');
const noOldTexts = () => {
  expect(screen.queryByText(SELECT_SOURCE)).toBeNull();
  expect(screen.queryByText(SELECT_TARGET)).toBeNull();
};

it('REQ-312 AC-1: 목록이 비어 있으면 실행 카드와 패키지 영역 안내가 모두 "먼저 테넌트를 등록하세요"이고 옛 두 문구는 없다', async () => {
  setup(empty);
  await screen.findByText('등록된 테넌트가 없습니다');
  // 실행 카드의 비활성 이유 + 패키지 카드의 EmptyState = 정확히 두 곳
  expect(screen.getAllByText(REGISTER)).toHaveLength(2);
  expect(within(card('패키지')).getByText(REGISTER)).toBeInTheDocument();
  expect(within(card('실행')).getByText(REGISTER)).toBeInTheDocument();
  noOldTexts();
});

it('REQ-312 AC-2: 0개일 때 미리보기·실제 이관은 비활성이고 안내와 버튼이 남으며 버튼으로 테넌트 탭이 열린다', async () => {
  setup(empty);
  expect(await screen.findByText('등록된 테넌트가 없습니다')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  expect(screen.getByRole('button', { name: 'PRD로 이관' })).toBeDisabled();
  const go = screen.getByRole('button', { name: '테넌트 탭으로 이동' });
  expect(go).toBeEnabled();
  await userEvent.click(go);
  expect(screen.getByRole('tab', { name: '테넌트' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { level: 2, name: '테넌트' })).toBeInTheDocument();
});

it('REQ-312 AC-3: 테넌트가 0개에서 1개가 되면 등록 안내가 사라지고 기존 문구 규칙(원본 → 대상 → 같음)이 적용된다', () => {
  const view = (tenants: Tenant[], ids: { sourceTenantId: string | null; targetTenantId: string | null }) => (
    <TestTenantProvider value={{ tenants: { state: 'success', data: { store: 'OK', tenants } }, ...ids }}>
      <PackagePicker selectedId={null} onSelect={() => {}} />
      <RunPanel packageId={null} artifactIds={[]} onResult={() => {}} />
    </TestTenantProvider>
  );
  const { rerender } = render(view([], { sourceTenantId: null, targetTenantId: null }));
  expect(screen.getAllByText(REGISTER)).toHaveLength(2);
  noOldTexts();
  // 경계: 1개가 생겼지만 원본·대상은 아직 없다 → 옛 문구(두 곳 모두 원본 안내)
  rerender(view([one], { sourceTenantId: null, targetTenantId: null }));
  expect(screen.queryByText(REGISTER)).toBeNull();
  expect(screen.getAllByText(SELECT_SOURCE)).toHaveLength(2);
  rerender(view([one], { sourceTenantId: 'ONE', targetTenantId: null }));
  expect(screen.getByText(SELECT_TARGET)).toBeInTheDocument();
  expect(screen.queryByText(REGISTER)).toBeNull();
  rerender(view([one], { sourceTenantId: 'ONE', targetTenantId: 'ONE' }));
  expect(screen.getByText('원본과 대상이 같습니다')).toBeInTheDocument();
  expect(screen.queryByText(REGISTER)).toBeNull();
});

it('REQ-312 AC-4: 목록을 읽는 중에는 스켈레톤과 옛 문구를 쓰고 등록 안내는 없다', async () => {
  let release!: (r: Response) => void;
  setup(() => new Promise<Response>(resolve => { release = resolve; }));
  await waitFor(() => expect(within(tenantCard()).getByRole('status')).toHaveTextContent('불러오는 중'));
  expect(screen.getAllByText(SELECT_SOURCE)).toHaveLength(2);
  expect(screen.queryByText(REGISTER)).toBeNull();
  expect(screen.queryByText('등록된 테넌트가 없습니다')).toBeNull();
  expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
  release(empty());
  await screen.findByText('등록된 테넌트가 없습니다');
  expect(screen.getAllByText(REGISTER)).toHaveLength(2);
});

it('REQ-312 AC-4·AC-5: 목록 읽기에 실패하면 오류 안내와 다시 시도 버튼, 옛 문구가 보이고 등록 안내는 없다. 다시 시도가 빈 목록이면 등록 안내가 된다', async () => {
  let fail = true;
  setup(() => fail ? json({ error: 'TENANT_STORE_UNREADABLE', message: '읽을 수 없음' }, 500) : empty());
  expect(await within(tenantCard()).findByText('테넌트 저장 파일을 읽지 못했습니다')).toBeInTheDocument();
  const retry = within(tenantCard()).getByRole('button', { name: '다시 시도' });
  expect(screen.getAllByText(SELECT_SOURCE)).toHaveLength(2);
  expect(screen.queryByText(REGISTER)).toBeNull();
  expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
  fail = false;
  await userEvent.click(retry);
  await screen.findByText('등록된 테넌트가 없습니다');
  expect(screen.getAllByText(REGISTER)).toHaveLength(2);
  noOldTexts();
});
