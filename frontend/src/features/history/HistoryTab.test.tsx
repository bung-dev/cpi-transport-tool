import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import App from '../../App';
import { PACKAGES, json, mockApi } from '../../test/mockFetch';
import { formatTime } from '../../lib/formatTime';
import { HistoryTab } from './HistoryTab';

afterEach(() => vi.unstubAllGlobals());

function entry(id: string, over: Partial<TransportResponse> = {}): TransportResponse {
  return {
    transportId: id,
    packageId: 'PkgTransportDemo',
    dryRun: true,
    deploy: false,
    startedAt: '2026-09-29T07:05:05.351940500Z',
    finishedAt: '2026-09-29T07:05:06Z',
    summary: { total: 2, succeeded: 1, failed: 1 },
    results: [],
    ...over,
  };
}

describe('이력 탭', () => {
  it('REQ-007 AC-1: API 순서 그대로 행을 보이고 열은 시작 시각·패키지·모드·배포·결과·이관 ID', async () => {
    mockApi({
      'GET /transport/history': () =>
        json([entry('t-new', { dryRun: false, deploy: true, packageId: 'PkgB' }), entry('t-old')]),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '시작 시각',
      '패키지',
      '모드',
      '배포',
      '결과',
      '이관 ID',
    ]);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const cells = within(rows[0]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual([formatTime('2026-09-29T07:05:05.351940500Z'), 'PkgB', '실제 이관', '배포', '성공 1 / 전체 2실패 1', 't-new']);
    expect(within(rows[1]).getByRole('button', { name: 't-old' })).toBeInTheDocument();
  });

  it('REQ-106 AC-1: 모드는 neutral "드라이런"/accent "실제 이관" 배지, 배포는 info "배포" 배지 또는 ink-tertiary "배포 안 함"', async () => {
    mockApi({
      'GET /transport/history': () => json([entry('t-real', { dryRun: false, deploy: true }), entry('t-dry', { dryRun: true, deploy: false })]),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    const [real, dry] = screen.getAllByRole('row').slice(1).map((r) => within(r));
    expect(real.getByText('실제 이관').className).toContain('bg-accent-bg');
    expect(real.getByText('배포').className).toContain('bg-info-bg');
    expect(real.queryByText('배포 안 함')).toBeNull();
    expect(dry.getByText('드라이런').className).toContain('bg-neutral-bg');
    expect(dry.getByText('배포 안 함').className).toContain('text-ink-tertiary');
    expect(dry.queryByText('배포', { selector: 'span.rounded-full' })).toBeNull();
  });

  it('REQ-106 AC-1: 결과는 "성공 s / 전체 t"이고 실패가 1 이상일 때만 danger "실패 f" 배지를 더하며 패키지·이관 ID는 고정폭이다', async () => {
    mockApi({
      'GET /transport/history': () =>
        json([entry('t-bad', { summary: { total: 3, succeeded: 1, failed: 2 } }), entry('t-ok', { summary: { total: 2, succeeded: 2, failed: 0 } })]),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    expect(screen.getByText('성공 1 / 전체 3')).toBeInTheDocument();
    expect(screen.getByText('실패 2').className).toContain('bg-danger-bg');
    expect(screen.getByText('성공 2 / 전체 2')).toBeInTheDocument();
    expect(screen.getAllByText(/^실패 \d+$/)).toHaveLength(1);
    expect(screen.getAllByText('PkgTransportDemo')[0].className).toContain('font-mono');
    expect(screen.getByRole('button', { name: 't-bad' }).className).toContain('font-mono');
  });

  it('REQ-106 AC-2: 이관 ID 버튼은 primary 글자에 hover 밑줄이고 행 어디를 눌러도 상세가 열리며 행에 cursor-pointer가 있고 행에 tabindex가 없다', async () => {
    mockApi({ 'GET /transport/history': () => json([entry('t-1'), entry('t-2', { packageId: 'PkgZ' })]) });
    render(<HistoryTab />);
    const btn = await screen.findByRole('button', { name: 't-2' });
    expect(btn.className).toContain('text-primary');
    expect(btn.className).toContain('hover:underline');
    expect(btn.className).not.toMatch(/(^|\s)underline(\s|$)/);
    const rows = screen.getAllByRole('row').slice(1);
    for (const r of rows) {
      expect(r.className).toContain('cursor-pointer');
      expect(r).not.toHaveAttribute('tabindex');
    }
    expect(screen.getAllByRole('button').filter((b) => b.textContent?.startsWith('t-'))).toHaveLength(2);
    await userEvent.click(within(rows[1]).getByText('PkgZ'));
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(within(region).getByText('이관 ID').nextElementSibling).toHaveTextContent('t-2');
  });

  it('REQ-106 AC-3: 상세는 페이지 머리(새로고침 없음) 아래에 화살표 아이콘이 있는 ghost "목록으로"와 결과 화면이다', async () => {
    mockApi({ 'GET /transport/history': () => json([entry('t-1')]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-1' }));
    expect(screen.getByRole('heading', { level: 2, name: '이관 이력' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull();
    const back = screen.getByRole('button', { name: '목록으로' });
    expect(back.className).toContain('bg-transparent');
    expect(back.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('region', { name: '이관 결과' })).toBeInTheDocument();
  });

  it('REQ-106 AC-4: 조회 중에는 표 자리에 스켈레톤 행과 role=status "불러오는 중"을 보이고 새로고침은 비활성이다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ 'GET /transport/history': () => new Promise<Response>((r) => (release = r)) });
    render(<HistoryTab />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('불러오는 중');
    expect(status.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('button', { name: '새로고침' })).toBeDisabled();
    release(json([entry('t-1')]));
    await screen.findByRole('table');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled();
  });

  it('REQ-106 AC-4: 빈 목록은 EmptyState로 "이관 이력이 없습니다"와 설명 "이관을 실행하면 여기에 기록됩니다."를 보이고 새로고침은 아이콘이 있는 secondary 버튼이다', async () => {
    mockApi({ 'GET /transport/history': () => json([]) });
    render(<HistoryTab />);
    const title = await screen.findByText('이관 이력이 없습니다');
    expect(screen.getByText('이관을 실행하면 여기에 기록됩니다.')).toBeInTheDocument();
    expect((title.parentElement as HTMLElement).className).toContain('text-center');
    expect(title.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const refresh = screen.getByRole('button', { name: '새로고침' });
    expect(refresh.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(refresh.className).toContain('border-hairline-strong');
  });

  it('REQ-007 AC-2: transportId 버튼으로 상세(REQ-006 결과 화면)를 열고 추가 fetch 없이 목록으로 돌아온다', async () => {
    const fn = mockApi({ 'GET /transport/history': () => json([entry('t-1'), entry('t-2', { packageId: 'PkgZ' })]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-2' }));
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(within(region).getByText('이관 ID').nextElementSibling).toHaveTextContent('t-2');
    expect(within(region).getByText('패키지 ID').nextElementSibling).toHaveTextContent('PkgZ');
    expect(fn).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('REQ-007 AC-3: 이력이 없으면 안내 문구를 보인다', async () => {
    mockApi({ 'GET /transport/history': () => json([]) });
    render(<HistoryTab />);
    expect(await screen.findByText('이관 이력이 없습니다')).toBeInTheDocument();
  });

  it('REQ-007 AC-3: 새로고침은 재조회하고 요청 중에는 비활성', async () => {
    let n = 0;
    let release: (r: Response) => void = () => {};
    const fn = mockApi({
      'GET /transport/history': () => (++n === 1 ? json([entry('t-1')]) : new Promise<Response>((r) => (release = r))),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '새로고침' })).toBeDisabled();
    release(json([entry('t-3')]));
    expect(await screen.findByRole('button', { name: 't-3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled();
  });

  it('REQ-007 AC-3: 탭을 다시 열 때마다 재조회한다', async () => {
    const fn = mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /transport/history': () => json([entry('t-1')]),
    });
    render(<App />);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('tab', { name: '이관' }));
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await screen.findByRole('table');
    await waitFor(() =>
      expect(fn.mock.calls.filter((c) => String(c[0]) === '/transport/history')).toHaveLength(2),
    );
  });

  it('REQ-009 AC-2: 상세를 열면 목록으로 버튼에, 돌아오면 연 행의 transportId 버튼에 포커스가 가고 새로고침은 포커스를 옮기지 않는다', async () => {
    mockApi({ 'GET /transport/history': () => json([entry('t-1'), entry('t-2')]) });
    render(<HistoryTab />);
    const rowBtn = await screen.findByRole('button', { name: 't-2' });
    expect(document.activeElement).toBe(document.body);
    rowBtn.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '목록으로' }));
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 't-2' }));
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: 't-2' });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 't-2' }));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 't-1' }));
  });

  it('REQ-009 AC-2: 목록으로 복귀한 뒤 새로고침으로 목록이 다시 그려져도 포커스는 새로고침 버튼에 남고 행 버튼으로 옮겨 가지 않는다', async () => {
    mockApi({ 'GET /transport/history': () => json([entry('t-1'), entry('t-2')]) });
    render(<HistoryTab />);
    (await screen.findByRole('button', { name: 't-2' })).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 't-2' }));
    const refresh = screen.getByRole('button', { name: '새로고침' });
    await userEvent.click(refresh);
    await screen.findByRole('button', { name: 't-2' });
    await waitFor(() => expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '새로고침' })).toBe(refresh);
    expect(document.activeElement).toBe(refresh);
  });

  it('REQ-009 AC-2: 행을 열고 목록으로 돌아온 뒤 다른 탭을 거쳐 이력 탭을 다시 열면 어떤 행 버튼에도 포커스가 가지 않는다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /transport/history': () => json([entry('t-1'), entry('t-2')]),
    });
    render(<App />);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await userEvent.click(await screen.findByRole('button', { name: 't-1' }));
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    await userEvent.click(screen.getByRole('tab', { name: '이관' }));
    const historyTab = screen.getByRole('tab', { name: '이력' });
    await userEvent.click(historyTab);
    await screen.findByRole('button', { name: 't-1' });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 't-1' }));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 't-2' }));
    expect(document.activeElement).toBe(historyTab);
  });

  it('REQ-009 AC-2: 새로고침 중 브라우저가 포커스를 잃어도(disabled blur) 응답이 끝나면 새로고침 버튼으로 되돌린다', async () => {
    let n = 0;
    let release: (r: Response) => void = () => {};
    mockApi({
      'GET /transport/history': () =>
        ++n === 1 ? json([entry('t-1')]) : new Promise<Response>((r) => (release = r)),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    const refresh = screen.getByRole('button', { name: '새로고침' });
    await userEvent.click(refresh);
    expect(refresh).toBeDisabled();
    // 실제 브라우저는 disabled가 된 버튼에서 포커스를 body로 떨어뜨린다(jsdom은 흉내 내지 않음).
    // jsdom은 disabled 요소의 blur()를 무시하므로 임시 요소로 포커스를 옮긴 뒤 지운다.
    const sink = document.createElement('button');
    document.body.append(sink);
    sink.focus();
    sink.remove();
    expect(document.activeElement).toBe(document.body);
    release(json([entry('t-3')]));
    await screen.findByRole('button', { name: 't-3' });
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(document.activeElement).toBe(refresh);
  });

  it('REQ-008 AC-3: 조회 오류는 role=alert와 다시 시도로 보인다', async () => {
    mockApi({ 'GET /transport/history': () => json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) });
    render(<HistoryTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('CPI에 연결할 수 없습니다');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
