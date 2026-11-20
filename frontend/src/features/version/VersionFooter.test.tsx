import { screen, waitFor } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { NAV_NAMES, baseRoutes, navLink, renderAt } from '../../test/appRoutes';

// 20261120-versioning S2: REQ-004 화면 아래 버전 표시(모든 주 메뉴 탭의 footer)
afterEach(() => vi.unstubAllGlobals());

const BUILD = { version: '0.1.0', commit: 'abc1234', buildTime: '2026-11-20T10:00:00Z' };
const footer = () => screen.getByRole('contentinfo');
const versionCalls = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter(([u]) => String(u) === '/version');

function setup(version: Parameters<typeof mockApi>[0][string]) {
  const fn = mockApi(baseRoutes({
    'GET /version': version,
    'GET /settings': () => json({ previewConcurrency: 4, transportConcurrency: 4 }),
    'GET /transport/history': () => json([]),
    'GET /audit?category=all': () => json([]),
    'GET /packages?tenantId=DEV': () => json([]),
  }));
  return fn;
}

describe('REQ-004 화면 아래 버전 표시', () => {
  it('REQ-004: 화면 아래 footer에 "v<버전> · <커밋>"이 작은 보조 색 글씨로 보인다', async () => {
    setup(() => json(BUILD));
    renderAt('#/dashboard');
    await waitFor(() => expect(footer()).toHaveTextContent('v0.1.0 · abc1234'));
    expect(footer().textContent?.trim()).toBe('v0.1.0 · abc1234');
    expect(footer().className).toContain('text-ink-secondary');
    expect(footer().className).toContain('text-xs');
  });

  it('REQ-004: 모든 주 메뉴 탭에서 footer가 보이고, 탭을 옮겨도 /version을 다시 부르지 않는다', async () => {
    const fn = setup(() => json(BUILD));
    renderAt('#/dashboard');
    await waitFor(() => expect(footer()).toHaveTextContent('v0.1.0 · abc1234'));
    for (const name of NAV_NAMES) {
      await userEvent.click(navLink(name));
      expect(navLink(name)).toHaveAttribute('aria-current', 'page');
      expect(footer()).toHaveTextContent('v0.1.0 · abc1234');
    }
    expect(versionCalls(fn)).toHaveLength(1);
  });

  it('REQ-004: 빌드 정보가 없으면 "dev · unknown"(앞에 v 없음)', async () => {
    setup(() => json({ version: 'dev', commit: 'unknown', buildTime: null }));
    renderAt('#/dashboard');
    await waitFor(() => expect(footer()).toHaveTextContent('dev · unknown'));
    expect(footer().textContent?.trim()).toBe('dev · unknown');
  });

  it('REQ-004: 불러오는 중에는 footer 자리만 있고 글씨는 비어 있다', async () => {
    setup(() => new Promise<Response>(() => {}));
    renderAt('#/dashboard');
    await screen.findByRole('heading', { level: 2, name: '대시보드' });
    expect(footer().textContent?.trim()).toBe('');
  });

  it.each([
    ['서버 오류', () => json({ code: 'INTERNAL', message: 'x' }, 500)],
    ['네트워크 실패', () => { throw new TypeError('Failed to fetch'); }],
  ] as const)('REQ-004 실패: %s면 footer에 "버전 정보 없음", 오류 알림은 없고 화면은 그대로 동작한다', async (_, handler) => {
    setup(handler);
    renderAt('#/dashboard');
    await waitFor(() => expect(footer()).toHaveTextContent('버전 정보 없음'));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(navLink('설정'));
    expect(await screen.findByRole('heading', { level: 2, name: '설정' })).toBeInTheDocument();
    expect(footer()).toHaveTextContent('버전 정보 없음');
  });
});
