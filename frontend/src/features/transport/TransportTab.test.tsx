import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

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
