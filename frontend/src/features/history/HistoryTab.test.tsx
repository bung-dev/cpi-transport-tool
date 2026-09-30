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
  it('REQ-007 AC-1: API 순서 그대로 행을 보이고 열은 시작 시각·packageId·드라이런·배포·요약·transportId', async () => {
    mockApi({
      'GET /transport/history': () =>
        json([entry('t-new', { dryRun: false, deploy: true, packageId: 'PkgB' }), entry('t-old')]),
    });
    render(<HistoryTab />);
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '시작 시각',
      'packageId',
      '드라이런',
      '배포',
      '요약',
      'transportId',
    ]);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const cells = within(rows[0]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual([formatTime('2026-09-29T07:05:05.351940500Z'), 'PkgB', '아니오', '예', '1/2, 실패 1', 't-new']);
    expect(within(rows[1]).getByRole('button', { name: 't-old' })).toBeInTheDocument();
  });

  it('REQ-007 AC-2: transportId 버튼으로 상세(REQ-006 결과 화면)를 열고 추가 fetch 없이 목록으로 돌아온다', async () => {
    const fn = mockApi({ 'GET /transport/history': () => json([entry('t-1'), entry('t-2', { packageId: 'PkgZ' })]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-2' }));
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(region).toHaveTextContent('transportId: t-2');
    expect(region).toHaveTextContent('packageId: PkgZ');
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
    refresh.blur();
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
