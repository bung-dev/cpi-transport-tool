import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

// 확인 대화상자 요약은 라벨(dt)과 값(dd)으로 나뉘어 있다(REQ-107 AC-4).
const summaryValue = (dialog: HTMLElement, label: string) => within(dialog).getByText(label).nextElementSibling;

afterEach(() => vi.unstubAllGlobals());

describe('이관 탭 통합', () => {
  it('REQ-005 AC-4: 선택 후 실행하면 응답이 같은 탭 아래 이관 결과로 표시된다', async () => {
    const result = {
      transportId: 't-9',
      packageId: 'PkgTransportDemo',
      dryRun: true,
      deploy: false,
      startedAt: '2026-09-29T07:05:05.351940500Z',
      finishedAt: '2026-09-29T07:05:06Z',
      summary: { total: 1, succeeded: 1, failed: 0 },
      results: [],
    };
    const fn = mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
      'POST /transport': () => json(result),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /IF_Customer_Push/ }));
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    expect(await screen.findByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '이관 결과' })).getByText('이관 ID').nextElementSibling).toHaveTextContent('t-9');
    const post = fn.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      packageId: 'PkgTransportDemo',
      artifactIds: ['IF_Customer_Push'],
      dryRun: true,
      deploy: false,
    });
  });

  it('REQ-104 AC-1: DOM 순서는 패키지 → 아티팩트 → 실행 → 결과다', async () => {
    const result = {
      transportId: 't-1',
      packageId: 'PkgTransportDemo',
      dryRun: true,
      deploy: false,
      startedAt: '2026-09-29T07:05:05Z',
      finishedAt: '2026-09-29T07:05:06Z',
      summary: { total: 0, succeeded: 0, failed: 0 },
      results: [],
    };
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
      'POST /transport': () => json(result),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    const resultHeading = await screen.findByRole('heading', { name: '이관 결과' });
    const order = ['패키지', '아티팩트', '실행'].map((name) => screen.getByRole('heading', { name }));
    order.push(resultHeading);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy();
    }
  });

  it('REQ-104 AC-1: 1024px 이상 2단(왼쪽 열에 패키지·아티팩트, 오른쪽 360px 열에 실행·sticky, top 56px 이상), 미만은 1단, 결과는 전체 폭이다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    await screen.findByLabelText('패키지 검색');
    const card = (name: string) =>
      screen.getByRole('heading', { name }).closest('div[class*="rounded-lg"]') as HTMLElement;
    const left = card('패키지').parentElement as HTMLElement;
    expect(card('아티팩트').parentElement).toBe(left);
    const right = card('실행').parentElement as HTMLElement;
    expect(right).not.toBe(left);
    const grid = left.parentElement as HTMLElement;
    expect(right.parentElement).toBe(grid);
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('lg:grid-cols-[minmax(0,1fr)_360px]');
    expect(grid.className).toContain('lg:items-start');
    expect(right.className).toContain('lg:sticky');
    const top = right.className.match(/lg:top-\[(\d+)px\]/);
    expect(Number(top?.[1])).toBeGreaterThanOrEqual(56);
    expect(left.className).toContain('flex-col');
    // 1024px 미만 1단의 순서는 DOM 순서(패키지 열 → 실행 열)이고 결과는 grid 밖의 전체 폭 요소다
    expect(grid.firstElementChild).toBe(left);
    expect(grid.lastElementChild).toBe(right);
  });

});

// REQ-105 AC-6·AC-7: 드라이런 결과 → "이 구성으로 실제 이관", 결과 스크롤
const RESULT_BASE = {
  packageId: 'PkgTransportDemo',
  deploy: false,
  startedAt: '2026-09-29T07:05:05Z',
  finishedAt: '2026-09-29T07:05:06Z',
  summary: { total: 0, succeeded: 0, failed: 0 },
  results: [],
};
const posts = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1]?.body as string));

function setupFlow() {
  const fn = mockApi({
    'GET /packages': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    'GET /packages/PkgFaultDemo/artifacts': () => json(ARTIFACTS),
    'POST /transport': (init) => {
      const body = JSON.parse(init?.body as string);
      return json({ ...RESULT_BASE, transportId: body.dryRun ? 't-dry' : 't-real', dryRun: body.dryRun, deploy: body.deploy });
    },
  });
  render(<TransportTab />);
  return fn;
}
async function pickDemo(ids: string[] = []) {
  await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
  for (const id of ids) await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(id) }));
}
const openRealBtn = () => screen.getByRole('button', { name: '이 구성으로 실제 이관' });

describe('드라이런 결과에서 실제 이관 열기', () => {
  afterEach(() => vi.restoreAllMocks());

  it('REQ-105 AC-6: "이 구성으로 실제 이관" 버튼은 드라이런 결과에만 있고 실제 이관 결과에는 없다', async () => {
    setupFlow();
    await pickDemo();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    expect(openRealBtn()).toBeInTheDocument();
    expect(openRealBtn().className).toContain('bg-canvas');
    expect(openRealBtn().className).toContain('border-hairline-strong');
    await userEvent.click(openRealBtn());
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(screen.getByText('실제 이관', { selector: 'span.rounded-full' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });

  it('REQ-105 AC-6: 누르면 실행 모드가 실제 이관, 배포 스위치가 꺼짐이 되고 아티팩트 선택이 드라이런 요청의 선택으로 맞춰지며 대화상자가 그 내용으로 열린다', async () => {
    const fn = setupFlow();
    await pickDemo(['IF_Customer_Push']);
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    // 결과를 본 뒤 선택을 바꾸고 배포를 켜 둔 상태에서 눌러도 드라이런 요청의 선택·배포 꺼짐으로 맞춰진다
    await userEvent.click(screen.getByRole('checkbox', { name: /IF_Order_Sync/ }));
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    await userEvent.click(screen.getByRole('switch', { name: '배포' }));
    expect(screen.getByRole('switch', { name: '배포' })).toBeChecked();
    await userEvent.click(openRealBtn());
    const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
    expect(summaryValue(dialog, '대상 패키지')).toHaveTextContent('PkgTransportDemo');
    expect(summaryValue(dialog, '아티팩트 수')).toHaveTextContent('1');
    expect(summaryValue(dialog, '배포')).toHaveTextContent('아니오');
    expect(screen.getByRole('radio', { name: '실제 이관' })).toBeChecked();
    expect(screen.getByRole('switch', { name: '배포' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /IF_Customer_Push/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /IF_Order_Sync/ })).not.toBeChecked();
    expect(posts(fn)).toHaveLength(1);
  });

  it('REQ-105 AC-6 / REQ-109 AC-2: "실행"을 누르면 같은 packageId와 artifactIds, dryRun: false, deploy: false로 요청한다', async () => {
    const fn = setupFlow();
    await pickDemo(['IF_Customer_Push']);
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    await userEvent.click(openRealBtn());
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(posts(fn)).toHaveLength(2));
    expect(posts(fn)[0]).toEqual({ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'], dryRun: true, deploy: false });
    expect(posts(fn)[1]).toEqual({ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'], dryRun: false, deploy: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('REQ-105 AC-6: 드라이런 요청에 선택을 보내지 않았으면 0개 선택으로 맞춰지고 요청에도 artifactIds가 없다', async () => {
    const fn = setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    await userEvent.click(screen.getByRole('checkbox', { name: /IF_Order_Sync/ }));
    await userEvent.click(openRealBtn());
    expect(summaryValue(screen.getByRole('dialog'), '아티팩트 수')).toHaveTextContent('전체');
    expect(screen.getByRole('checkbox', { name: /IF_Order_Sync/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(posts(fn)).toHaveLength(2));
    expect(posts(fn)[1]).toEqual({ packageId: 'PkgTransportDemo', dryRun: false, deploy: false });
  });

  it('REQ-105 AC-6: "취소"하면 요청을 보내지 않고 실행 모드는 실제 이관으로 남으며, 이후 배포를 켜고 "PRD로 이관"을 누르면 그때의 스위치 값으로 간다', async () => {
    const fn = setupFlow();
    await pickDemo(['IF_Order_Sync']);
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    await userEvent.click(openRealBtn());
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts(fn)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: '실제 이관' })).toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: '배포' }));
    await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
    expect(summaryValue(screen.getByRole('dialog'), '배포')).toHaveTextContent('예');
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(posts(fn)).toHaveLength(2));
    expect(posts(fn)[1]).toMatchObject({ dryRun: false, deploy: true });
  });

  it('REQ-105 AC-6: 드라이런 결과 뒤에 패키지를 바꾸면 결과와 함께 버튼도 사라진다', async () => {
    setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    await userEvent.click(screen.getByRole('radio', { name: /Fault Demo/ }));
    expect(screen.queryByRole('heading', { name: '이관 결과' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });

  it('REQ-105 AC-7: 이 탭에서 응답을 받아 결과가 나타나면 결과 영역의 시작으로 부드럽게 스크롤하고 포커스는 옮기지 않는다', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    setupFlow();
    await pickDemo();
    const run = screen.getByRole('button', { name: '드라이런 실행' });
    await userEvent.click(run);
    const heading = await screen.findByRole('heading', { name: '이관 결과' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    const target = spy.mock.contexts[0] as HTMLElement;
    expect(target).toContainElement(heading);
    expect(target.className).toContain('scroll-mt-[76px]');
    expect(document.body.contains(document.activeElement) ? screen.getByRole('region', { name: '이관 결과' }).contains(document.activeElement) : false).toBe(false);
  });

  it('REQ-105 AC-7: prefers-reduced-motion: reduce이면 부드러운 스크롤 없이 바로 이동한다', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    expect(spy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('REQ-105 AC-7: 패키지를 바꿔 결과가 사라질 때는 스크롤하지 않는다', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    spy.mockClear();
    await userEvent.click(screen.getByRole('radio', { name: /Fault Demo/ }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('REQ-105 AC-7 / REQ-107 AC-5: 확인 대화상자가 닫히며 열었던 요소로 포커스를 돌려줄 때 스크롤하지 않는 옵션(preventScroll)을 쓴다', async () => {
    const focusCalls: Array<[HTMLElement, FocusOptions | undefined]> = [];
    const original = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      focusCalls.push([this, options]);
      return original.call(this, options);
    });
    setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    const run = screen.getByRole('button', { name: 'PRD로 이관' });
    await userEvent.click(run);
    focusCalls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const restore = focusCalls.find(([el]) => el === run);
    expect(restore).toBeDefined();
    expect(restore?.[1]).toEqual({ preventScroll: true });
  });

  it('REQ-107 AC-5: "이 구성으로 실제 이관"으로 연 대화상자가 닫혀 연 버튼이 사라지면 포커스가 실행 카드의 실행 버튼으로 가고 결과 시작은 스크롤로 밀리지 않는 옵션을 쓴다', async () => {
    const focusCalls: Array<[HTMLElement, FocusOptions | undefined]> = [];
    const original = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      focusCalls.push([this, options]);
      return original.call(this, options);
    });
    setupFlow();
    await pickDemo(['IF_Customer_Push']);
    await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
    await screen.findByRole('heading', { name: '이관 결과' });
    await userEvent.click(openRealBtn());
    focusCalls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull());
    const runBtn = screen.getByRole('button', { name: 'PRD로 이관' });
    expect(runBtn).toHaveFocus();
    expect(focusCalls.filter(([el]) => el === runBtn).pop()?.[1]).toEqual({ preventScroll: true });
  });

  it('REQ-107 AC-5: 실행 카드의 실행 버튼으로 연 대화상자를 취소하면 그 실행 버튼으로 돌아온다', async () => {
    setupFlow();
    await pickDemo();
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    const run = screen.getByRole('button', { name: 'PRD로 이관' });
    await userEvent.click(run);
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(run).toHaveFocus();
  });
});
