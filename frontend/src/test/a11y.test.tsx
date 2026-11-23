import { TENANTS_OK, TENANT_STATUS_OK } from './tenantFixtures';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from './userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi } from './mockFetch';
import { navLink, renderAt } from './appRoutes';
import { artifactGrid, artifactRow, stepButton, toArtifacts } from './wizard';

// 접근성 조건(REQ-108 AC-2·AC-3)을 화면 전체(이관 탭 결과 표시 상태, 이력 탭, 확인 대화상자)에서 확인한다.
// jsdom은 배치를 계산하지 않으므로 REQ-108 AC-1·AC-4(가로 스크롤, 상단 바 한 줄)는 브라우저에서 확인한다.
afterEach(() => vi.unstubAllGlobals());

const art = (artifactId: string, over: Partial<ArtifactResult>): ArtifactResult => ({
  artifactId,
  status: 'SUCCESS',
  action: 'NONE',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  configurations: [],
  ...over,
});
const RESULT: TransportResponse = {
  transportId: 't-a11y',
  packages: [{ packageId: 'PkgTransportDemo', packageName: 'Transport Demo', targetPackage: 'NOT_CHECKED' }],
  dryRun: true,
  deploy: false,
  startedAt: '2026-09-29T07:05:05Z',
  finishedAt: '2026-09-29T07:05:06Z',
  summary: { total: 3, succeeded: 2, failed: 1 },
  results: [
    art('A_Mismatch', {
      configurations: [{ key: 'K', value: null, dataType: 'xsd:string', status: 'FAILED' }],
    }),
    art('B_Failed', { status: 'FAILED', error: { code: 'ERR_B', message: 'failed b' } }),
    art('C_Clean', {}),
  ],
};

function setupApp(historyError = false) {
  let historyCalls = 0;
  mockApi({
      'GET /tenants': () => json(TENANTS_OK),
      'GET /tenants/status': () => json(TENANT_STATUS_OK),
      'GET /templates': () => json([]),
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo': () => json([{ packageId: 'PkgTransportDemo', exists: true }]),
    'GET /transport/history': () =>
      historyError && ++historyCalls === 1 ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json([RESULT]),
    'POST /transport': (init) => json({ ...RESULT, dryRun: JSON.parse(init?.body as string).dryRun }),
  });
  return renderAt('#/transport');
}

// 키보드 접근 테스트는 병렬 전체 실행에서 호출마다 setTimeout 양보(delay 기본 0)가 쌓여 느려진다. 동작은 같고 양보만 없애려고 delay: null 인스턴스를 쓴다
const keyboardUser = () => userEvent.setup({ delay: null });
type User = ReturnType<typeof keyboardUser>;

/** Tab 키만으로 도달하는 요소를 처음부터 끝까지 모은다(포커스가 이미 본 요소로 돌아오거나 문서 밖으로 나가면 멈춘다). */
async function tabOrder(user: User): Promise<HTMLElement[]> {
  const seen: HTMLElement[] = [];
  for (let i = 0; i < 150; i++) {
    await user.tab();
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || seen.includes(el)) break;
    seen.push(el);
  }
  return seen;
}

async function openResultState(user: User = userEvent.setup()) {
  setupApp();
  await user.click(await screen.findByRole('button', { name: '템플릿 없이 진행' }));
  await user.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
  await user.click(screen.getByRole('button', { name: '다음' }));
  await screen.findByRole('grid', { name: '이관할 아티팩트' });
  await user.click(artifactRow('IF_Order_Sync'));
  await user.click(screen.getByRole('button', { name: '미리보기 실행' }));
  await screen.findByRole('heading', { name: '이관 결과' });
}

describe('키보드 접근 (REQ-108 AC-2)', () => {
  it('REQ-108 AC-2: 새 이관(결과 단계)의 모든 컨트롤이 Tab 순서에 있고 네이티브 활성 컨트롤이다', async () => {
    const user = keyboardUser();
    await openResultState(user);
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    const order = await tabOrder(user);
    const reached = (el: HTMLElement) => order.includes(el);

    // 주 메뉴(REQ-410): 링크마다 Tab 정지이고 상단 검색 버튼도 Tab 순서에 있다
    for (const name of ['대시보드', '새 이관', '템플릿', '이관 이력', '테넌트', '감사 이력'] as const) expect(reached(navLink(name)), name).toBe(true);
    expect(reached(within(screen.getByRole('banner')).getByRole('button', { name: /검색/ }))).toBe(true);
    // 단계 줄: 갈 수 있는 단계 버튼은 모두 Tab 순서에 있다
    for (const label of ['템플릿', '패키지', '아티팩트', '미리보기', '실제 이관'] as const) expect(reached(stepButton(label)), label).toBe(true);
    expect(reached(within(screen.getByRole('group', { name: '이관 경로' })).getByRole('button', { name: '경로 변경' }))).toBe(true);
    for (const name of ['모두 펼치기', '모두 접기', '이 구성으로 실제 이관']) {
      expect(reached(screen.getByRole('button', { name })), name).toBe(true);
    }
    expect(reached(screen.getByRole('switch', { name: '문제 항목만 보기' }))).toBe(true);
    for (const id of ['A_Mismatch', 'B_Failed', 'C_Clean']) expect(reached(screen.getByRole('button', { name: id })), id).toBe(true);

    // 도달한 요소는 모두 네이티브 a/button/input이고 tabindex 음수나 disabled가 아니다
    for (const el of order) {
      expect(['A', 'BUTTON', 'INPUT'], el.outerHTML.slice(0, 60)).toContain(el.tagName);
      expect(el).toBeEnabled();
      expect(el.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('REQ-108 AC-2 / ADR-012: 아티팩트 단계의 Tab 순서에는 표 행 하나와 표 버튼·이동 버튼이 있다', async () => {
    const user = keyboardUser();
    setupApp();
    await toArtifacts();
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    const order = await tabOrder(user);
    const inGrid = order.filter((el) => artifactGrid().contains(el));
    expect(inGrid).toHaveLength(1);
    expect(inGrid[0]).toHaveAttribute('aria-selected');
    for (const name of ['모두 선택', '모두 해제', '전체 선택', '선택 해제', '이전', '미리보기 실행']) expect(order, name).toContain(screen.getByRole('button', { name }));
  });

  it('REQ-108 AC-2: Enter/Space(라디오 그룹은 화살표 키)로 조작된다', async () => {
    const user = keyboardUser();
    await openResultState(user);
    // 스위치: Space
    screen.getByRole('switch', { name: '문제 항목만 보기' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('switch', { name: '문제 항목만 보기' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'C_Clean' })).toBeNull();
    await user.keyboard(' ');
    // 버튼: Enter와 Space
    const toggle = screen.getByRole('button', { name: 'C_Clean' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 경로 선택 창의 라디오 그룹: 화살표 키
    within(screen.getByRole('group', { name: '이관 경로' })).getByRole('button', { name: '경로 변경' }).focus();
    await user.keyboard('{Enter}');
    const routeDialog = screen.getByRole('dialog', { name: '원본과 대상 선택' });
    const targets = within(within(routeDialog).getByRole('radiogroup', { name: '대상' })).getAllByRole('radio');
    targets[1].focus();
    await user.keyboard('{ArrowUp}');
    expect(targets[0]).toBeChecked();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '원본과 대상 선택' })).toBeNull();
    // 주 메뉴 링크: Enter
    navLink('이관 이력').focus();
    await user.keyboard('{Enter}');
    expect(navLink('이관 이력')).toHaveAttribute('aria-current', 'page');
  });

  it('REQ-108 AC-2: 이력 탭(목록·상세·오류)의 컨트롤이 Tab 순서에 있고 Enter/Space로 조작된다', async () => {
    const user = keyboardUser();
    setupApp(true);
    await user.click(navLink('이관 이력'));
    // 오류 상태: 다시 시도
    const retry = await screen.findByRole('button', { name: '다시 시도' });
    expect((await tabOrder(user)).includes(retry)).toBe(true);
    retry.focus();
    await user.keyboard('{Enter}');
    const idBtn = await screen.findByRole('button', { name: 't-a11y' });
    // 목록: 새로고침, 행마다 이관 ID 버튼 하나(행에는 tabindex 없음)
    (document.activeElement as HTMLElement | null)?.blur();
    const order = await tabOrder(user);
    expect(order).toContain(screen.getByRole('button', { name: '새로고침' }));
    expect(order).toContain(idBtn);
    for (const row of screen.getAllByRole('row').slice(1)) expect(row).not.toHaveAttribute('tabindex');
    // 상세: 목록으로
    idBtn.focus();
    await user.keyboard(' ');
    const back = screen.getByRole('button', { name: '목록으로' });
    expect(back).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled());
  });

  it('REQ-108 AC-2: 확인 대화상자의 버튼이 Tab 순서에 있고 Enter/Space로 조작된다', async () => {
    const user = keyboardUser();
    await openResultState(user);
    screen.getByRole('button', { name: '이 구성으로 실제 이관' }).focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
    // 배포 스위치: Space
    within(dialog).getByRole('switch', { name: '배포' }).focus();
    await user.keyboard(' ');
    expect(within(dialog).getByRole('switch', { name: '배포' })).toBeChecked();
    // 대상 패키지 확인(REQ-622)이 끝나야 "실행"이 켜진다
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '실행' })).toBeEnabled());
    const order = await tabOrder(user);
    expect(order).toContain(within(dialog).getByRole('button', { name: '취소' }));
    expect(order).toContain(within(dialog).getByRole('button', { name: '실행' }));
    within(dialog).getByRole('button', { name: '취소' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('접근 가능한 이름과 색 외 구분 (REQ-108 AC-3)', () => {
  it('REQ-108 AC-3: 모든 입력·라디오·체크박스·스위치에 접근 가능한 이름이 있고 모든 버튼에 보이는 글자가 있다(아이콘만 있는 버튼 0개)', async () => {
    await openResultState();
    await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' })); // 대화상자까지 연다
    const controls = Array.from(document.querySelectorAll<HTMLElement>('input, [role="switch"], [role="radio"], [role="checkbox"]'));
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const c of controls) expect(c, c.outerHTML.slice(0, 80)).toHaveAccessibleName();
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'));
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) expect((b.textContent ?? '').trim().length, b.outerHTML.slice(0, 80)).toBeGreaterThan(0);
  });

  it('REQ-108 AC-3: 이력 탭의 입력·버튼도 이름과 글자가 있다', async () => {
    setupApp();
    await userEvent.click(navLink('이관 이력'));
    await screen.findByRole('table');
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 't-a11y' }));
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0);
    for (const c of Array.from(document.querySelectorAll<HTMLElement>('input, [role="switch"]'))) expect(c).toHaveAccessibleName();
  });

  it('REQ-108 AC-3: 색만으로 구분하지 않는다 — 선택된 행은 선택된 라디오·체크박스가, 상태 배지는 글자가, 실패 카드는 배지 글자가 함께 있다', async () => {
    await openResultState();
    // 배경색이 있는 상태 배지(둥근 pill)는 모두 글자가 있다
    const badges = Array.from(document.querySelectorAll<HTMLElement>('span[class*="rounded-full"][class*="-bg"]'));
    expect(badges.length).toBeGreaterThan(5);
    for (const b of badges) expect((b.textContent ?? '').trim().length, b.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    // 실패 카드: 왼쪽 띠(색)와 함께 "상태 FAILED" 배지 글자가 있다
    const failedCard = screen.getByRole('button', { name: 'B_Failed' }).closest('div[class*="rounded-lg"]') as HTMLElement;
    expect(failedCard.querySelector('[data-failed-band]')).not.toBeNull();
    expect(within(failedCard).getByText('FAILED')).toBeInTheDocument();
    expect(within(failedCard).getByText('상태')).toBeInTheDocument();
  });

  it('REQ-108 AC-3 / REQ-422·620: 선택된 아티팩트 행은 aria-selected와 보이는 선택 표시([data-check-mark])가 있고, 선택된 패키지 행에는 체크된 체크박스가 있다', async () => {
    setupApp();
    await toArtifacts();
    await userEvent.click(artifactRow('IF_Customer_Push'));
    expect(artifactRow('IF_Order_Sync')).toHaveAttribute('aria-selected', 'true');
    expect(artifactRow('IF_Order_Sync').querySelector('[data-check-mark]')).not.toBeNull();
    expect(artifactRow('IF_Customer_Push')).toHaveAttribute('aria-selected', 'false');
    expect(artifactRow('IF_Customer_Push').querySelector('[data-check-mark]')).toBeNull();
    await userEvent.click(stepButton('패키지'));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('label[class*="bg-primary-soft"]'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });
});
