import { TENANTS_OK, TENANT_STATUS_OK } from './tenantFixtures';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../api/types';
import App from '../App';
import { ARTIFACTS, PACKAGES, json, mockApi } from './mockFetch';

// 접근성 조건(REQ-108 AC-2·AC-3)을 화면 전체(이관 탭 결과 표시 상태, 이력 탭, 확인 대화상자)에서 확인한다.
// jsdom은 배치를 계산하지 않으므로 REQ-108 AC-1·AC-4(가로 스크롤, 상단 바 한 줄)는 브라우저에서 확인한다.
afterEach(() => vi.unstubAllGlobals());

const art = (artifactId: string, over: Partial<ArtifactResult>): ArtifactResult => ({
  artifactId,
  status: 'SUCCESS',
  action: 'NONE',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  replacements: [],
  unmappedKeys: [],
  ...over,
});
const RESULT: TransportResponse = {
  transportId: 't-a11y',
  packageId: 'PkgTransportDemo',
  dryRun: true,
  deploy: false,
  startedAt: '2026-09-29T07:05:05Z',
  finishedAt: '2026-09-29T07:05:06Z',
  summary: { total: 3, succeeded: 2, failed: 1 },
  results: [
    art('A_Mismatch', {
      replacements: [{ targetType: 'header', key: 'K', status: 'KEY_NOT_FOUND', before: null, after: null, occurrences: 0 }],
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
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'GET /transport/history': () =>
      historyError && ++historyCalls === 1 ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json([RESULT]),
    'POST /transport': (init) => json({ ...RESULT, dryRun: JSON.parse(init?.body as string).dryRun }),
  });
  return render(<App />);
}

// AI-NOTE: 키보드 접근 테스트는 병렬 전체 실행에서 호출마다 setTimeout 양보(delay 기본 0)가 쌓여 느려진다. 동작은 같고 양보만 없애려고 delay: null 인스턴스를 쓴다 (근거: REQ-313 AC-1, run 20261020-defect-fix)
const keyboardUser = () => userEvent.setup({ delay: null });
type User = ReturnType<typeof keyboardUser>;
// AI-NOTE: 병렬 전체 실행에서 첫 렌더 뒤 데이터 대기가 findBy 기본 제한(1초)을 넘어 실패한 적이 있어, '키보드 접근 (REQ-108 AC-2)' 테스트 4개의 findBy에만 넉넉한 제한을 준다(다른 테스트는 기본 대기). 전역 asyncUtilTimeout은 바꾸지 않는다 (근거: REQ-313 AC-1, run 20261020-defect-fix)
const LOAD_WAIT = { timeout: 10_000 };
// AI-NOTE: 같은 이유로 키보드 접근 테스트 4개에만 테스트별 제한 시간(vitest 기본 5초)을 늘린다. 전역 testTimeout·maxWorkers는 바꾸지 않는다 (근거: REQ-313 AC-1, 부하 재현에서 5초 초과 확인)
const KEYBOARD_TEST_TIMEOUT = 30_000;

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

/** wait는 키보드 접근 테스트만 넘긴다. 생략하면 findBy 기본 대기(setup.ts의 asyncUtilTimeout)를 그대로 쓴다. */
async function openResultState(user: User = userEvent.setup(), wait?: { timeout: number }) {
  setupApp();
  await user.click(await screen.findByRole('radio', { name: /Transport Demo/ }, wait));
  await user.click(await screen.findByRole('checkbox', { name: /IF_Order_Sync/ }, wait));
  await user.click(screen.getByRole('button', { name: '미리보기 실행' }));
  await screen.findByRole('heading', { name: '이관 결과' }, wait);
}

describe('키보드 접근 (REQ-108 AC-2)', () => {
  it('REQ-108 AC-2: 이관 탭(결과 표시 상태)의 모든 컨트롤이 Tab 순서에 있고 네이티브 활성 컨트롤이다', async () => {
    const user = keyboardUser();
    await openResultState(user, LOAD_WAIT);
    await user.click(screen.getByRole('radio', { name: '실제 이관' })); // 배포 스위치를 보이게 한다
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    const order = await tabOrder(user);
    const reached = (el: HTMLElement) => order.includes(el);
    const anyOf = (els: HTMLElement[]) => els.some(reached);

    // 탭 목록: 선택된 탭만 Tab 정지이고 나머지는 화살표로 이동한다(ADR-012)
    expect(reached(screen.getByRole('tab', { name: '이관' }))).toBe(true);
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('tabindex', '-1');
    expect(reached(screen.getByLabelText('패키지 검색'))).toBe(true);
    // 라디오 그룹은 그룹당 Tab 정지 하나(선택된 라디오)이고 나머지는 화살표로 이동한다
    expect(anyOf(within(screen.getByRole('list', { name: '패키지 목록' })).getAllByRole('radio'))).toBe(true);
    for (const box of within(screen.getByRole('list', { name: '아티팩트 목록' })).getAllByRole('checkbox')) expect(reached(box)).toBe(true);
    for (const name of ['전체 선택', '선택 해제', 'PRD로 이관', '모두 펼치기', '모두 접기', '이 구성으로 실제 이관']) {
      expect(reached(screen.getByRole('button', { name })), name).toBe(true);
    }
    expect(anyOf(within(screen.getByRole('radiogroup', { name: '실행 모드' })).getAllByRole('radio'))).toBe(true);
    expect(reached(screen.getByRole('switch', { name: '배포' }))).toBe(true);
    expect(reached(screen.getByRole('switch', { name: '문제 항목만 보기' }))).toBe(true);
    for (const id of ['A_Mismatch', 'B_Failed', 'C_Clean']) expect(reached(screen.getByRole('button', { name: id })), id).toBe(true);

    // 도달한 요소는 모두 네이티브 button/input이고 tabindex 음수나 disabled가 아니다
    for (const el of order) {
      expect(['BUTTON', 'INPUT'], el.outerHTML.slice(0, 60)).toContain(el.tagName);
      expect(el).toBeEnabled();
      expect(el.tabIndex).toBeGreaterThanOrEqual(0);
    }
  }, KEYBOARD_TEST_TIMEOUT);

  it('REQ-108 AC-2: Enter/Space(라디오 그룹은 화살표 키)로 조작된다', async () => {
    const user = keyboardUser();
    await openResultState(user, LOAD_WAIT);
    // 라디오 그룹: 화살표 키
    screen.getByRole('radio', { name: '미리보기' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: '실제 이관' })).toBeChecked();
    // 스위치와 체크박스: Space
    screen.getByRole('switch', { name: '배포' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('switch', { name: '배포' })).toBeChecked();
    const boxes = within(screen.getByRole('list', { name: '아티팩트 목록' })).getAllByRole('checkbox');
    boxes[1].focus();
    await user.keyboard(' ');
    expect(boxes[1]).toBeChecked();
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
    screen.getByRole('button', { name: '선택 해제' }).focus();
    await user.keyboard('{Enter}');
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    // 탭 목록: 화살표 키
    screen.getByRole('tab', { name: '이관' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true');
  }, KEYBOARD_TEST_TIMEOUT);

  it('REQ-108 AC-2: 이력 탭(목록·상세·오류)의 컨트롤이 Tab 순서에 있고 Enter/Space로 조작된다', async () => {
    const user = keyboardUser();
    setupApp(true);
    await user.click(screen.getByRole('tab', { name: '이력' }));
    // 오류 상태: 다시 시도
    const retry = await screen.findByRole('button', { name: '다시 시도' }, LOAD_WAIT);
    expect((await tabOrder(user)).includes(retry)).toBe(true);
    retry.focus();
    await user.keyboard('{Enter}');
    const idBtn = await screen.findByRole('button', { name: 't-a11y' }, LOAD_WAIT);
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
  }, KEYBOARD_TEST_TIMEOUT);

  it('REQ-108 AC-2: 확인 대화상자의 버튼이 Tab 순서에 있고 Enter/Space로 조작된다', async () => {
    const user = keyboardUser();
    await openResultState(user, LOAD_WAIT);
    await user.click(screen.getByRole('radio', { name: '실제 이관' }));
    screen.getByRole('button', { name: 'PRD로 이관' }).focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    const order = await tabOrder(user);
    expect(order).toContain(within(dialog).getByRole('button', { name: '취소' }));
    expect(order).toContain(within(dialog).getByRole('button', { name: '실행' }));
    within(dialog).getByRole('button', { name: '취소' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('dialog')).toBeNull();
  }, KEYBOARD_TEST_TIMEOUT);
});

describe('접근 가능한 이름과 색 외 구분 (REQ-108 AC-3)', () => {
  it('REQ-108 AC-3: 모든 입력·라디오·체크박스·스위치에 접근 가능한 이름이 있고 모든 버튼에 보이는 글자가 있다(아이콘만 있는 버튼 0개)', async () => {
    await openResultState();
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' })); // 대화상자까지 연다
    const controls = Array.from(document.querySelectorAll<HTMLElement>('input, [role="switch"], [role="radio"], [role="checkbox"]'));
    expect(controls.length).toBeGreaterThan(8);
    for (const c of controls) expect(c, c.outerHTML.slice(0, 80)).toHaveAccessibleName();
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'));
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) expect((b.textContent ?? '').trim().length, b.outerHTML.slice(0, 80)).toBeGreaterThan(0);
  });

  it('REQ-108 AC-3: 이력 탭의 입력·버튼도 이름과 글자가 있다', async () => {
    setupApp();
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await screen.findByRole('table');
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 't-a11y' }));
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0);
    for (const c of Array.from(document.querySelectorAll<HTMLElement>('input, [role="switch"]'))) expect(c).toHaveAccessibleName();
  });

  it('REQ-108 AC-3: 색만으로 구분하지 않는다 — 선택된 행은 선택된 라디오·체크박스가, 상태 배지는 글자가, 실패 카드는 배지 글자가 함께 있다', async () => {
    await openResultState();
    // 선택된 행(primary-soft 배경)에는 선택된 컨트롤이 있다
    const rows = Array.from(document.querySelectorAll<HTMLElement>('label[class*="bg-primary-soft"]'));
    expect(rows.length).toBeGreaterThanOrEqual(3); // 패키지 행, 아티팩트 행, 실행 모드 상자
    for (const row of rows) expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true);
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
});
