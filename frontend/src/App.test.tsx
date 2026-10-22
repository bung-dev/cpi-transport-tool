import { TENANTS_OK, TENANT_STATUS_OK } from './test/tenantFixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from './api/types';
import { PACKAGES, json, mockApi } from './test/mockFetch';
import App from './App';

const HISTORY_ENTRY: TransportResponse = {
  transportId: 't-hist-1',
  packageId: 'PkgTransportDemo',
  dryRun: true,
  deploy: false,
  startedAt: '2026-09-29T07:05:05.351940500Z',
  finishedAt: '2026-09-29T07:05:06Z',
  summary: { total: 1, succeeded: 1, failed: 0 },
  results: [
    {
      artifactId: 'IF_Order_Sync',
      status: 'SUCCESS',
      action: 'NONE',
      deployStatus: 'NOT_REQUESTED',
      error: null,
      replacements: [],
      unmappedKeys: [],
    },
  ],
};

describe('App', () => {
  beforeEach(() => {
    mockApi({
      'GET /tenants': () => json(TENANTS_OK),
      'GET /tenants/status': () => json(TENANT_STATUS_OK),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json([]),
      'GET /transport/history': () => json([HISTORY_ENTRY]),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('REQ-001 AC-2: App이 렌더링된다', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'CPI Transport Tool' })).toBeInTheDocument();
  });

  it('REQ-009 AC-1: 탭은 tablist/tab/aria-selected를 쓰고 기본은 이관', () => {
    render(<App />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['이관', '이력', '테넌트']);
    expect(screen.getByRole('tab', { name: '이관' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'false');
  });

  it('REQ-009 AC-1: 탭을 누르면 패널이 전환되고 이전 패널은 언마운트된다', async () => {
    render(<App />);
    expect(await screen.findByLabelText('패키지 검색')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByLabelText('패키지 검색')).toBeNull();
  });

  it('REQ-009 AC-3: 본문은 max-w 가운데 정렬, min-w-0, 좌우 padding 16px 이상', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-[1200px]');
    expect(main.className).toContain('mx-auto');
    expect(main.className).toContain('min-w-0');
    expect(main.className).toContain('px-4');
  });

  it('REQ-102 AC-1: 상단 바는 높이 56px·canvas 배경·아래 hairline·sticky top-0이고 안에 h1 제품명과 탭 목록이 있다', () => {
    render(<App />);
    const bar = screen.getByRole('banner');
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('top-0');
    expect(bar.className).toContain('h-14');
    expect(bar.className).toContain('bg-canvas');
    expect(bar.className).toContain('border-b border-hairline');
    expect(within(bar).getByRole('heading', { level: 1, name: 'CPI Transport Tool' })).toBeInTheDocument();
    expect(within(bar).getByRole('tablist')).toBeInTheDocument();
    expect(bar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('tablist')).toBeNull();
  });

  it('REQ-102 AC-3: body 배경은 surface 토큰이고 App 최상위·상단 바·카드는 그에 맞는 배경이다', () => {
    const css = readFileSync(join(__dirname, 'index.css'), 'utf8');
    const body = css.match(/\nbody\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toContain('background-color: var(--color-surface)');
    expect(css).toContain('--color-surface: #f7f7f5;');
    const { container } = render(<App />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-surface');
    expect(screen.getByRole('banner').className).toContain('bg-canvas');
  });

  it('REQ-102 AC-4: 본문 상자(main)가 최대 폭 1200px·가운데 정렬·안쪽 여백 16/24px를 같은 요소에 갖고 상단 바 안쪽 상자도 같은 정의다', () => {
    render(<App />);
    const main = screen.getByRole('main');
    for (const c of ['max-w-[1200px]', 'mx-auto', 'px-4', 'md:px-6', 'min-w-0']) {
      expect(main.className, c).toContain(c);
    }
    const inner = screen.getByRole('banner').firstElementChild as HTMLElement;
    for (const c of ['max-w-[1200px]', 'mx-auto', 'px-4', 'md:px-6']) {
      expect(inner.className, c).toContain(c);
    }
    // 여백을 main 바깥 래퍼에 두지 않는다(내용 폭 1200 구조 금지, D-025)
    expect((main.parentElement as HTMLElement).className).not.toContain('max-w-');
  });

  it('REQ-102 AC-5: 이관 탭 맨 위에 제목 "패키지 이관"(h2)과 설명이 있고 카드 제목은 h3이다', async () => {
    render(<App />);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByRole('heading')[0]).toHaveTextContent('패키지 이관');
    expect(within(panel).getByRole('heading', { level: 2, name: '패키지 이관' })).toBeInTheDocument();
    expect(
      within(panel).getByText('DEV 테넌트의 패키지를 PRD 테넌트로 이관합니다. 미리보기로 변경 내용을 먼저 확인할 수 있습니다.'),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 3, name: '패키지' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 3, name: '실행' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    expect(await screen.findByRole('heading', { level: 3, name: '아티팩트' })).toBeInTheDocument();
  });

  it('REQ-102 AC-5: 이력 탭 목록에는 제목 "이관 이력"(h2)·설명·새로고침이 있고 상세에서는 새로고침만 없다', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    const refresh = await screen.findByRole('button', { name: '새로고침' });
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { level: 2, name: '이관 이력' })).toBeInTheDocument();
    expect(within(panel).getByText('지난 이관 기록을 확인합니다.')).toBeInTheDocument();
    expect(refresh).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 't-hist-1' }));
    expect(within(panel).getByRole('heading', { level: 2, name: '이관 이력' })).toBeInTheDocument();
    expect(within(panel).getByText('지난 이관 기록을 확인합니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull();
    expect(screen.getByRole('button', { name: '목록으로' })).toBeInTheDocument();
  });

  it('REQ-102 AC-5: 제목 수준을 건너뛰지 않는다(h1 → h2 → h3 이관 결과 → h4 아티팩트 ID → h5 소제목)', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await userEvent.click(await screen.findByRole('button', { name: 't-hist-1' }));
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `제목 ${i}`).toBeLessThanOrEqual(1);
    expect(screen.getByRole('heading', { level: 3, name: '이관 결과' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'IF_Order_Sync' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: '치환 항목' })).toBeInTheDocument();
  });

  it('REQ-101 AC-4: 페이지 제목은 24px·굵기 600·음수 자간 클래스이고 이력 표의 packageId·transportId 값은 고정폭이다', async () => {
    render(<App />);
    const title = screen.getByRole('heading', { level: 2, name: '패키지 이관' });
    expect(title.className).toContain('text-2xl');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('tracking-tight');
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    const idButton = await screen.findByRole('button', { name: 't-hist-1' });
    expect(idButton.className).toContain('font-mono');
    expect(screen.getByRole('cell', { name: 'PkgTransportDemo' }).className).toContain('font-mono');
  });

  it('REQ-101 AC-6: 이력 표의 transportId 버튼은 색 전환 150ms가 있고 포커스 외곽선을 지우지 않는다', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    const idButton = await screen.findByRole('button', { name: 't-hist-1' });
    expect(idButton.className).toContain('transition-colors');
    expect(idButton.className).toContain('duration-150');
    expect(idButton.className).not.toMatch(/outline-(none|0|hidden)/);
  });
});
