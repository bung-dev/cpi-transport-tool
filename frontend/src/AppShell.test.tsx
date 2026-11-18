import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from './test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, PACKAGES, packagesOf } from './test/mockFetch';
import { TENANT_STATUS_OK } from './test/tenantFixtures';
import { NAV_NAMES, ROUTES, baseRoutes, mainNav, navLink, renderAt, routeGroup, setHash } from './test/appRoutes';

afterEach(() => vi.unstubAllGlobals());

const HEADINGS: Record<string, string> = {
  '#/dashboard': '대시보드',
  '#/templates': '템플릿',
  '#/history': '이관 이력',
  '#/tenants': '테넌트',
  '#/audit': '감사 이력',
};
function screenRoutes() {
  return baseRoutes({
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /transport/history': () => json([]),
    'GET /audit?category=all': () => json([]),
  });
}

describe('REQ-410 앱 셸', () => {
  it('REQ-410: 상단에 앱 이름(h1), 경로 표시, 검색 버튼(⌘K 표기), 주 메뉴 6개가 순서대로 있고 기본 화면은 대시보드다', async () => {
    mockApi(screenRoutes());
    renderAt('');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('heading', { level: 1, name: 'CPI Transport Tool' })).toBeInTheDocument();
    expect(routeGroup()).toBeInTheDocument();
    const search = within(banner).getByRole('button', { name: /검색/ });
    expect(search.textContent).toContain('⌘K');
    expect(within(mainNav()).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(NAV_NAMES);
    for (const name of NAV_NAMES) expect(navLink(name)).toHaveAttribute('href', ROUTES[name]);
    expect(navLink('대시보드')).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 2, name: '대시보드' })).toBeInTheDocument();
    await within(routeGroup()).findByRole('button', { name: '원본 DEV 연결됨' });
  });

  it('REQ-410: 경로 표시는 원본 → 대상 순서와 각 연결 상태를 보인다', async () => {
    mockApi(screenRoutes());
    renderAt('');
    const group = routeGroup();
    const source = await within(group).findByRole('button', { name: '원본 DEV 연결됨' });
    const target = within(group).getByRole('button', { name: '대상 PRD 연결됨' });
    expect(source.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.textContent).toContain('→');
  });

  it.each(Object.entries(HEADINGS))('REQ-410: 해시 %s로 직접 들어오면 그 화면(%s)이 열리고 메뉴 표시가 맞다', async (hash, heading) => {
    mockApi(screenRoutes());
    renderAt(hash);
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    const active = within(mainNav()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(active.map((a) => a.getAttribute('href'))).toEqual([hash]);
  });

  it('REQ-410: 해시 #/transport는 새 이관 화면이다', async () => {
    mockApi(screenRoutes());
    renderAt('#/transport');
    expect(await screen.findByRole('navigation', { name: '이관 단계' })).toBeInTheDocument();
    expect(navLink('새 이관')).toHaveAttribute('aria-current', 'page');
  });

  it.each(['#/nope', '#templates', '#/'])('REQ-410: 모르는 해시 %s는 대시보드다', (hash) => {
    mockApi(screenRoutes());
    renderAt(hash);
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 2, name: '대시보드' })).toBeInTheDocument();
    expect(navLink('대시보드')).toHaveAttribute('aria-current', 'page');
  });

  it('REQ-410: 메뉴를 누르면 주소 해시가 바뀌고 그 화면이 열린다', async () => {
    mockApi(screenRoutes());
    renderAt('');
    await userEvent.click(navLink('템플릿'));
    expect(window.location.hash).toBe('#/templates');
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: '템플릿' })).toBeInTheDocument();
    expect(navLink('템플릿')).toHaveAttribute('aria-current', 'page');
    expect(navLink('대시보드')).not.toHaveAttribute('aria-current');
    await userEvent.click(navLink('감사 이력'));
    expect(window.location.hash).toBe('#/audit');
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: '감사 이력' })).toBeInTheDocument();
  });

  it('REQ-410: 주소 해시가 바깥에서 바뀌면(뒤로 가기 등) 화면이 따라 바뀐다', async () => {
    mockApi(screenRoutes());
    renderAt('#/templates');
    await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: '템플릿' });
    act(() => {
      setHash('#/tenants');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: '테넌트' })).toBeInTheDocument();
    expect(navLink('테넌트')).toHaveAttribute('aria-current', 'page');
  });

  it('REQ-410 / REQ-430: 앱을 열 때 셸과 대시보드는 테넌트 두 API와 대시보드·템플릿 조회 외의 요청을 보내지 않는다', async () => {
    const fn = mockApi(screenRoutes());
    renderAt('');
    await within(routeGroup()).findByRole('button', { name: '원본 DEV 연결됨' });
    await screen.findByRole('region', { name: '오늘 요약' });
    const urls = fn.mock.calls.map(([url]) => String(url));
    expect(urls.every((u) => ['/tenants', '/tenants/status', '/dashboard', '/templates'].includes(u)), urls.join(', ')).toBe(true);
  });

  it('REQ-410: 읽기 전용이 켜짐이면 상단에 "읽기 전용" 표시가 있다', async () => {
    mockApi({ ...screenRoutes(), 'GET /tenants/status': () => json({ ...TENANT_STATUS_OK, readOnly: true }) });
    renderAt('');
    expect(await within(screen.getByRole('banner')).findByText('읽기 전용')).toBeInTheDocument();
  });

  it('REQ-410 실패: 테넌트 상태 조회에 실패하면 경로 표시가 "상태 모름"이고 실제 이관은 막힌다', async () => {
    mockApi({
      ...screenRoutes(),
      'GET /tenants/status': () => json({}, 500),
      'POST /transport': () => json({ transportId: 't-1', packages: packagesOf('PkgTransportDemo'), dryRun: true, deploy: false,
        startedAt: '', finishedAt: '', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] }),
    });
    renderAt('#/transport');
    await waitFor(() => expect(routeGroup()).toHaveTextContent('상태 모름'));
    await userEvent.click(await screen.findByRole('button', { name: '템플릿 없이 진행' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeDisabled();
  });

  it('REQ-410: 화면을 바꿔도 테넌트 두 API는 다시 요청하지 않는다', async () => {
    const fn = mockApi(screenRoutes());
    renderAt('');
    await within(routeGroup()).findByRole('button', { name: '원본 DEV 연결됨' });
    for (const name of ['템플릿', '감사 이력', '테넌트', '대시보드'] as const) await userEvent.click(navLink(name));
    await screen.findByRole('heading', { level: 2, name: '대시보드' });
    expect(fn.mock.calls.filter(([url]) => url === '/tenants')).toHaveLength(1);
    expect(fn.mock.calls.filter(([url]) => url === '/tenants/status')).toHaveLength(1);
  });
});
