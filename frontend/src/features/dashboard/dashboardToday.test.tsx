import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { EMPTY_DASHBOARD, baseRoutes, navLink, renderAt } from '../../test/appRoutes';

// 20261120-r1-wording S2 REQ-805: 대시보드 "오늘 요약" 숫자 → 조건이 붙은 이관 이력.
afterEach(() => vi.unstubAllGlobals());

const TODAY = { previews: 4, transports: 3, succeeded: 2, failed: 1 };
const todayRegion = () => screen.findByRole('region', { name: '오늘 요약' });

describe('REQ-805 오늘 숫자 → 이력', () => {
  it.each([
    ['미리보기 4건 이력 보기', '#/history?date=today&mode=preview'],
    ['실제 이관 3건 이력 보기', '#/history?date=today&mode=real'],
    ['성공 2건 이력 보기', '#/history?date=today&mode=real&result=succeeded'],
    ['실패 1건 이력 보기', '#/history?date=today&mode=real&result=failed'],
  ])('REQ-805: "%s" 링크는 %s로 간다', async (name, hash) => {
    mockApi(baseRoutes({ 'GET /dashboard': () => json({ ...EMPTY_DASHBOARD, today: TODAY }) }));
    renderAt('#/dashboard');
    const link = within(await todayRegion()).getByRole('link', { name });
    expect(link).toHaveAttribute('href', hash);
  });

  it('REQ-805: 숫자를 누르면 이관 이력 화면이 같은 조건으로 열리고 주 메뉴는 이관 이력이 현재다', async () => {
    const fn = mockApi(baseRoutes({
      'GET /dashboard': () => json({ ...EMPTY_DASHBOARD, today: TODAY }),
      'GET /transport/history?date=today&mode=real&result=failed': () => json([]),
    }));
    renderAt('#/dashboard');
    await userEvent.click(within(await todayRegion()).getByRole('link', { name: '실패 1건 이력 보기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/history?date=today&mode=real&result=failed'));
    expect(await screen.findByRole('heading', { level: 2, name: '이관 이력' })).toBeInTheDocument();
    expect(navLink('이관 이력')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u).endsWith('/transport/history?date=today&mode=real&result=failed'))).toBe(true));
  });

  it('REQ-805: 숫자가 0이어도 링크이고 이동할 수 있다', async () => {
    mockApi(baseRoutes());
    renderAt('#/dashboard');
    const region = await todayRegion();
    for (const label of ['미리보기', '실제 이관', '성공', '실패']) {
      expect(within(region).getByRole('link', { name: `${label} 0건 이력 보기` })).toBeInTheDocument();
    }
  });

  it('REQ-805: 보이는 모양(라벨·숫자, 실패 색)은 그대로이고 숫자 링크는 focus·hover 표시가 있다', async () => {
    mockApi(baseRoutes({ 'GET /dashboard': () => json({ ...EMPTY_DASHBOARD, today: TODAY }) }));
    renderAt('#/dashboard');
    const region = await todayRegion();
    await waitFor(() => expect(region).toHaveTextContent(/미리보기\s*4/));
    expect(region).toHaveTextContent(/실제 이관\s*3/);
    expect(region).toHaveTextContent(/성공\s*2/);
    expect(region).toHaveTextContent(/실패\s*1/);
    const failed = within(region).getByRole('link', { name: '실패 1건 이력 보기' });
    expect(within(failed).getByText('1').className).toContain('text-danger-fg');
    expect(within(failed).getByText('1').className).toContain('text-3xl');
    expect(failed.className).toMatch(/hover:/);
    // 전역 :focus-visible 외곽선을 지우지 않는다(ADR-012)
    expect(failed.className).not.toMatch(/outline-none|focus:outline-0/);
  });

  it('REQ-805 실패: 대시보드를 읽지 못하면 숫자 링크가 없다', async () => {
    mockApi(baseRoutes({ 'GET /dashboard': () => json({ error: 'INTERNAL_ERROR', message: 'boom' }, 500) }));
    renderAt('#/dashboard');
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: /건 이력 보기$/ })).toBeNull();
  });
});
