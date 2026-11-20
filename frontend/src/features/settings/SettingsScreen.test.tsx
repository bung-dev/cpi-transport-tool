import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { baseRoutes, mainNav, navLink, renderAt } from '../../test/appRoutes';
import { TENANT_STATUS_OK } from '../../test/tenantFixtures';

// 20261119-transport-speedup S3: REQ-708 설정 탭(동시 처리 개수)
afterEach(() => vi.unstubAllGlobals());

const SAVED = '저장했습니다. 다음 이관부터 적용됩니다.';
const RANGE = '1~8 사이로 입력하세요';
const preview = () => screen.getByRole('spinbutton', { name: '미리보기 동시 처리 개수' });
const transport = () => screen.getByRole('spinbutton', { name: '실제 이관 동시 처리 개수' });
const save = () => screen.getByRole('button', { name: '저장' });

type Routes = Parameters<typeof mockApi>[0];
function setup(extra: Routes = {}) {
  const fn = mockApi(baseRoutes({
    'GET /settings': () => json({ previewConcurrency: 4, transportConcurrency: 4 }),
    'PUT /settings': (init) => json(JSON.parse(String(init?.body))),
    ...extra,
  }));
  renderAt('#/settings');
  return fn;
}
const puts = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter(([u, init]) => u === '/settings' && init?.method === 'PUT');

async function change(input: HTMLElement, value: string) {
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

describe('REQ-708 설정 탭', () => {
  it('REQ-708: 위쪽 탭 맨 끝이 "설정"(#/settings)이고 그 화면 제목은 "설정"이다', async () => {
    setup();
    const links = within(mainNav()).getAllByRole('link');
    expect(links[links.length - 1]).toHaveTextContent('설정');
    expect(navLink('설정')).toHaveAttribute('href', '#/settings');
    expect(navLink('설정')).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 2, name: '설정' })).toBeInTheDocument();
    await waitFor(() => expect(preview()).toHaveValue(4));
  });

  it('REQ-708: 불러오는 동안 로딩을 보이고, 불러오면 GET /settings 값과 칸마다 한 줄 설명을 보인다', async () => {
    let release: (r: Response) => void = () => undefined;
    const fn = setup({
      'GET /settings': () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    expect(await screen.findByText('불러오는 중')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    release(json({ previewConcurrency: 6, transportConcurrency: 2 }));
    await waitFor(() => expect(preview()).toHaveValue(6));
    expect(transport()).toHaveValue(2);
    for (const input of [preview(), transport()]) {
      expect(input).toHaveAttribute('min', '1');
      expect(input).toHaveAttribute('max', '8');
      const describedBy = input.getAttribute('aria-describedby') ?? '';
      const description = describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      expect(description).toContain('1이면 하나씩 차례로 처리');
    }
    expect(save()).toBeEnabled();
    expect(fn.mock.calls.filter(([u]) => u === '/settings')).toHaveLength(1);
  });

  it('REQ-708: 값을 바꿔 저장하면 PUT /settings 본문에 정수로 보내고 저장 알림을 보인다', async () => {
    const fn = setup();
    await waitFor(() => expect(preview()).toHaveValue(4));
    await change(preview(), '6');
    await change(transport(), '1');
    await userEvent.click(save());
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(puts(fn)).toHaveLength(1);
    expect(JSON.parse(String(puts(fn)[0][1]?.body))).toEqual({ previewConcurrency: 6, transportConcurrency: 1 });
    expect(preview()).toHaveValue(6);
    expect(transport()).toHaveValue(1);
  });

  it('REQ-708: 읽기 전용 모드에서도 저장할 수 있다', async () => {
    const fn = setup({ 'GET /tenants/status': () => json({ ...TENANT_STATUS_OK, readOnly: true }) });
    await waitFor(() => expect(preview()).toHaveValue(4));
    await change(transport(), '3');
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(puts(fn)).toHaveLength(1);
  });

  it.each([
    ['빈 칸', ''],
    ['0', '0'],
    ['9', '9'],
    ['소수', '2.5'],
  ])('REQ-708 실패: %s이면 저장 버튼이 비활성이고 그 칸 아래 "1~8 사이로 입력하세요"를 보인다', async (_label, value) => {
    const fn = setup();
    await waitFor(() => expect(preview()).toHaveValue(4));
    await change(preview(), value);
    expect(save()).toBeDisabled();
    expect(preview()).toHaveAttribute('aria-invalid', 'true');
    const describedBy = preview().getAttribute('aria-describedby') ?? '';
    const text = describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(text).toContain(RANGE);
    expect(transport()).not.toHaveAttribute('aria-invalid', 'true');
    expect(puts(fn)).toHaveLength(0);
    await change(preview(), '3');
    expect(save()).toBeEnabled();
    expect(screen.queryByText(RANGE)).toBeNull();
  });

  it('REQ-708 실패: 서버가 400이면 같은 문구 "1~8 사이로 입력하세요"를 보이고 입력 값은 남는다', async () => {
    setup({ 'PUT /settings': () => json({ error: 'INVALID_REQUEST', message: 'bad' }, 400) });
    await waitFor(() => expect(preview()).toHaveValue(4));
    await change(preview(), '5');
    await userEvent.click(save());
    expect(await screen.findByText(RANGE)).toBeInTheDocument();
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(preview()).toHaveValue(5);
  });

  it('REQ-708 실패: 불러오기 실패는 오류 알림과 "다시 시도"이고 다시 시도하면 다시 불러온다', async () => {
    let fail = true;
    const fn = setup({
      'GET /settings': () => (fail ? json({ error: 'INTERNAL_ERROR', message: 'x' }, 500) : json({ previewConcurrency: 3, transportConcurrency: 5 })),
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(preview()).toHaveValue(3));
    expect(transport()).toHaveValue(5);
    expect(fn.mock.calls.filter(([u, init]) => u === '/settings' && (init?.method ?? 'GET') === 'GET')).toHaveLength(2);
  });

  it.each([
    ['5xx', () => json({ error: 'INTERNAL_ERROR', message: 'x' }, 500)],
    ['네트워크', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('REQ-708 실패: 저장 실패(%s)는 오류 알림과 "다시 시도"이고 입력한 값은 남으며 다시 시도하면 다시 저장한다', async (_label, failure) => {
    let fail = true;
    const fn = setup({
      'PUT /settings': (init) => (fail ? failure() : json(JSON.parse(String(init?.body)))),
    });
    await waitFor(() => expect(preview()).toHaveValue(4));
    await change(preview(), '7');
    await change(transport(), '2');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(preview()).toHaveValue(7);
    expect(transport()).toHaveValue(2);
    fail = false;
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(puts(fn)).toHaveLength(2);
    expect(JSON.parse(String(puts(fn)[1][1]?.body))).toEqual({ previewConcurrency: 7, transportConcurrency: 2 });
  });
});
