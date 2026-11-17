// 묶음 s03 — REQ-312 테넌트 0개일 때 등록 안내 (QA-160~165). qa_cases.md "REQ-312" 절 그대로.
// 앱: --profile stub --dev unset --prd unset (테넌트 0개로 시작, 읽기 전용 기본값). 케이스는 파일 순서대로 한다.
// S3b(REQ-420): 안내는 새 이관의 패키지 단계 한 곳(문구 + "테넌트 화면으로 이동")에 있다. 실행 카드가 없어져 두 곳 → 한 곳이다.
// "등록된 테넌트가 없습니다"는 경로 변경 창 안에 있고, "대상 테넌트를 선택하세요"는 화면 문구가 아니다(원본·대상이 둘 다 골라져야 "이 경로 사용"이 켜진다).
// REQ-312 규칙(목록을 읽었고 0개일 때만 등록 안내, 읽는 중·실패면 쓰지 않음)은 그대로 판정한다.
import { expect, test, type Page } from '@playwright/test';
import { after, app, key, R, shot, tenantList } from '../../lib/qa';
import { applyRouteBtn, blocked, foreignHosts, grp, openRouteDialog, openTab, openWizard, registerViaUi, routeDialog, startManual, stepBtn, tabBtn, watch } from '../../lib/ui';
import { countAny, P_DST, P_GO, P_NONE, P_REGISTER, P_SAME, P_SRC, phraseReport } from '../../lib/r2';

test.afterEach(async ({ request }) => {
  await after(request);
});

const ALL = [P_REGISTER, P_SRC, P_DST, P_SAME, P_NONE, P_GO];
const slim = (rep: Record<string, any>) => Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, { count: Math.max(v.innerTextCount, v.ariaCount), innerText: v.innerTextCount, aria: v.ariaCount, where: v.elements.map((e: any) => `${e.nearestHeading || '-'}|${e.tag}|${e.visible ? 'visible' : 'hidden'}`) }]));
const headingsOf = (rep: Record<string, any>, p: string): string[] => rep[p].elements.map((e: any) => e.nearestHeading);

/** 새 이관 메뉴로 가서 패키지 단계를 보인다(템플릿 단계면 "템플릿 없이 진행"). */
async function toTransport(page: Page): Promise<void> {
  await openTab(page, '이관');
  await toPackageStep(page);
}
async function toPackageStep(page: Page): Promise<void> {
  const manual = page.getByRole('button', { name: '템플릿 없이 진행', exact: true });
  if (await manual.isVisible().catch(() => false)) await startManual(page);
  await expect(stepBtn(page, '패키지')).toHaveAttribute('aria-current', 'step');
  await page.waitForTimeout(400);
}
/** 새로 읽은 새 이관에서 패키지 단계까지 */
async function freshPackageStep(page: Page): Promise<void> {
  await openWizard(page);
  await toPackageStep(page);
}
const nextBtn = (page: Page) => page.getByRole('button', { name: '다음', exact: true });
const allPreviewBtn = (page: Page) => page.getByRole('button', { name: '전체 아티팩트로 미리보기', exact: true });
const finish = (rec: any, w: ReturnType<typeof watch>) => {
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  rec.nonLocalRequests = foreignHosts(w);
  expect(w.errors, 'pageerror 0건').toEqual([]);
  expect(w.consoleErrors, 'console.error 0건').toEqual([]);
  expect(foreignHosts(w), '밖 요청 0건').toEqual([]);
};
const svcKey = () => key(18082, 'localhost');

test('QA-160: 테넌트 0개 - 비활성 이유와 패키지 영역 안내', async ({ page, request }) => {
  const rec = R('QA-160');
  const w = watch(page);
  const t0 = await app(request, 'GET', '/tenants');
  rec.tenantsAtStart = { store: t0.json?.store, count: (t0.json?.tenants ?? []).length };
  expect(rec.tenantsAtStart.count).toBe(0);
  await freshPackageStep(page);
  await page.waitForTimeout(400);
  const rep = await phraseReport(page, ALL);
  rec.phrases = slim(rep);
  rec.registerLocations = headingsOf(rep, P_REGISTER);
  rec.nextDisabled = await blocked(nextBtn(page));
  rec.allPreviewDisabled = await blocked(allPreviewBtn(page));
  await shot(page, 'QA-160-transport');
  expect(countAny(rep, P_REGISTER), '"먼저 테넌트를 등록하세요" 가 패키지 단계에 보임').toBeGreaterThanOrEqual(1);
  expect(rec.registerLocations, '패키지 영역(머리글 "패키지")').toContain('패키지');
  expect(rec.nextDisabled, '"다음" 비활성').toBe(true);
  expect(rec.allPreviewDisabled, '"전체 아티팩트로 미리보기" 비활성').toBe(true);
  expect(countAny(rep, P_SRC), '"원본 테넌트를 선택하세요" 0건').toBe(0);
  expect(countAny(rep, P_DST), '"대상 테넌트를 선택하세요" 0건').toBe(0);
  finish(rec, w);
});

test('QA-161: 테넌트 0개 - 실행 비활성, 등록 안내, 탭 이동', async ({ page }) => {
  const rec = R('QA-161');
  const w = watch(page);
  await freshPackageStep(page);
  rec.nextDisabled = await blocked(nextBtn(page));
  rec.allPreviewDisabled = await blocked(allPreviewBtn(page));
  rec.previewStepDisabled = await stepBtn(page, '미리보기').isDisabled();
  rec.realStepDisabled = await stepBtn(page, '실제 이관').isDisabled();
  rec.realButtons = (await page.locator('main').getByRole('button').allInnerTexts()).map((s) => s.trim()).filter((s) => /로 이관$|이관 실행|실제 이관$/.test(s) && !/^\d\./.test(s));
  rec.readOnlyReasonTexts = (await page.getByText(/읽기 전용/).allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').slice(0, 100));
  const go = page.getByRole('button', { name: P_GO, exact: true });
  rec.goVisible = await go.isVisible().catch(() => false);
  // 경로 변경 창: 테넌트가 없다는 안내
  await openRouteDialog(page);
  rec.noneVisible = await routeDialog(page).getByText(P_NONE, { exact: true }).isVisible().catch(() => false);
  rec.applyDisabled = await applyRouteBtn(page).isDisabled();
  await shot(page, 'QA-161-route-dialog');
  await page.keyboard.press('Escape');
  await expect(routeDialog(page)).toHaveCount(0);
  await shot(page, 'QA-161-transport');
  expect(rec.nextDisabled, '"다음" 비활성').toBe(true);
  expect(rec.allPreviewDisabled, '"전체 아티팩트로 미리보기" 비활성').toBe(true);
  expect(rec.previewStepDisabled && rec.realStepDisabled, '미리보기·실제 이관 단계 비활성').toBe(true);
  expect(rec.realButtons, '실제 이관 실행 버튼 없음').toEqual([]);
  expect(rec.noneVisible, '경로 변경 창에 "등록된 테넌트가 없습니다"').toBe(true);
  expect(rec.applyDisabled, '"이 경로 사용" 비활성').toBe(true);
  expect(rec.goVisible, '"테넌트 화면으로 이동" 버튼').toBe(true);
  await go.click();
  // 해시 이동 뒤 다시 그려질 때까지 기다린 다음 읽는다(클릭 직후 바로 읽으면 이전 화면 상태를 읽는다). 기대값은 그대로다.
  await expect(tabBtn(page, '테넌트')).toHaveAttribute('aria-current', 'page').catch(() => undefined);
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  rec.tenantTabSelected = await tabBtn(page, '테넌트').getAttribute('aria-current');
  // S2(REQ-412): 등록 폼은 서랍이다. 테넌트 화면에서 서랍을 여는 "테넌트 등록" 버튼이 보이면 등록할 수 있다.
  rec.registerFormVisible = await page.getByRole('button', { name: '테넌트 등록', exact: true }).isVisible().catch(() => false);
  await shot(page, 'QA-161-tenants');
  expect(rec.tenantTabSelected).toBe('page');
  expect(rec.registerFormVisible, '등록 폼이 보임').toBe(true);
  finish(rec, w);
});

test('QA-162: 테넌트 1개 이상 - 기존 문구 규칙', async ({ page, request }) => {
  test.setTimeout(180000);
  const rec = R('QA-162');
  const w = watch(page);
  await openWizard(page);
  await registerViaUi(page, 'QA-ONE', svcKey());
  const list = await tenantList(request);
  rec.tenantsAfterRegister = list.map((t) => t.name);
  expect(rec.tenantsAfterRegister).toEqual(['QA-ONE']);
  await toTransport(page);
  // 3·4단계는 경로 변경 창 안에서 고른다. 원본만 고르면 "이 경로 사용"이 꺼져 있고(대상 미선택), 대상까지 같은 테넌트면 같다는 경고가 보인다.
  const steps: Array<[string, () => Promise<void>, string | null]> = [
    ['2-아무것도 안 고름', async () => undefined, P_SRC],
    ['3-원본 QA-ONE', async () => {
      await openRouteDialog(page);
      await grp(page, '원본').getByRole('radio', { name: 'QA-ONE', exact: true }).check();
    }, null],
    ['4-대상 QA-ONE(같음)', async () => grp(page, '대상').getByRole('radio', { name: 'QA-ONE', exact: true }).check(), P_SAME],
  ];
  rec.steps = [];
  for (const [name, act, expectPhrase] of steps) {
    await act();
    await page.waitForTimeout(500);
    const rep = await phraseReport(page, ALL);
    const applyDisabled = (await routeDialog(page).count()) ? await applyRouteBtn(page).isDisabled() : null;
    rec.steps.push({ name, phrases: slim(rep), nextDisabled: await blocked(nextBtn(page)), applyDisabled });
    await shot(page, `QA-162-${name.slice(0, 1)}`);
    if (expectPhrase) expect(countAny(rep, expectPhrase), `${name}: "${expectPhrase}" 보임`).toBeGreaterThanOrEqual(1);
    if (applyDisabled !== null) expect(applyDisabled, `${name}: "이 경로 사용" 비활성`).toBe(true);
    for (const p of [P_REGISTER, P_NONE, P_GO]) expect(countAny(rep, p), `${name}: "${p}" 없음`).toBe(0);
  }
  await page.keyboard.press('Escape');
  finish(rec, w);
});

test('QA-163: 등록 -> 삭제 -> 새로고침 - 문구 복귀와 유지', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-163');
  const w = watch(page);
  await openWizard(page);
  // 1. QA-ONE 삭제 (확인 대화상자 승인)
  await openTab(page, '테넌트');
  const delOne = async (name: string) => {
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: '삭제' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    rec[`deleteDialog_${name}`] = (await dlg.innerText()).replace(/\s+/g, ' ');
    const btns = await dlg.getByRole('button').allInnerTexts();
    rec[`deleteDialogButtons_${name}`] = btns;
    const ok = dlg.getByRole('button', { name: /^(삭제|확인|실행)$/ });
    await ok.first().click();
    await expect(dlg).toHaveCount(0);
  };
  await delOne('QA-ONE');
  const after1 = await tenantList(request);
  rec.tenantsAfterDelete = after1.map((t) => t.name);
  expect(after1.length, 'GET /tenants 빈 배열').toBe(0);
  const snap = async (label: string, wantRegister: boolean) => {
    const rep = await phraseReport(page, ALL);
    const row = { label, phrases: slim(rep) };
    (rec.snaps ??= []).push(row);
    if (wantRegister) {
      expect.soft(rep[P_REGISTER].elements.length, `${label}: 패키지 단계에 "먼저 테넌트를 등록하세요"`).toBeGreaterThanOrEqual(1);
      expect.soft(countAny(rep, P_GO), `${label}: "테넌트 화면으로 이동"`).toBeGreaterThanOrEqual(1);
      expect.soft(countAny(rep, P_SRC) + countAny(rep, P_DST) + countAny(rep, P_SAME), `${label}: 이전 상태 문구 잔상 없음`).toBe(0);
    }
    return rep;
  };
  await toTransport(page);
  await snap('2-삭제 직후', true);
  await shot(page, 'QA-163-2-after-delete');
  // 3. 새로고침
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: '새 이관', exact: true })).toBeVisible();
  await toPackageStep(page);
  await page.waitForTimeout(400);
  await snap('3-새로고침 뒤', true);
  await shot(page, 'QA-163-3-reload');
  // 4. QA-TWO 등록 -> 이관 탭 문구 -> 삭제 -> 문구
  await registerViaUi(page, 'QA-TWO', svcKey());
  await toTransport(page);
  const repTwo = await snap('4a-QA-TWO 등록 직후', false);
  expect.soft(countAny(repTwo, P_SRC), '4a: QA-162 와 같은 규칙(원본을 고르세요)').toBeGreaterThanOrEqual(1);
  for (const p of [P_REGISTER, P_NONE, P_GO]) expect.soft(countAny(repTwo, p), `4a: "${p}" 없음`).toBe(0);
  await openTab(page, '테넌트');
  await delOne('QA-TWO');
  await toTransport(page);
  await snap('4b-QA-TWO 삭제 직후', true);
  await shot(page, 'QA-163-4b-after-delete');
  rec.tenantsEnd = (await tenantList(request)).map((t) => t.name);
  expect(rec.tenantsEnd).toEqual([]);
  finish(rec, w);
});

test('QA-164: 테넌트 목록을 읽는 중에는 등록 안내를 쓰지 않는다', async ({ page, request }) => {
  test.setTimeout(180000);
  const rec = R('QA-164');
  const w = watch(page);
  expect((await tenantList(request)).length, '서버 0개').toBe(0);
  const DELAY = 4000;
  rec.replaced = `page.route(url.pathname === '/tenants' GET, 지연 ${DELAY}ms 뒤 route.continue())  /tenants/status 제외`;
  await page.route(
    (u) => u.host === 'localhost:8080' && u.pathname === '/tenants',
    async (route) => {
      if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, DELAY));
      await route.continue();
    },
  );
  const t0 = Date.now();
  await page.goto('about:blank');
  await page.goto('/#/transport', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { level: 2, name: '새 이관', exact: true })).toBeVisible();
  // 템플릿 단계의 "템플릿 없이 진행"은 목록을 읽는 중에도 누를 수 있다. 패키지 단계는 읽는 중 자리표시를 보인다.
  await startManual(page);
  await page.waitForTimeout(Math.max(0, 500 - (Date.now() - t0)));
  const mid = async (label: string) => {
    const rep = await phraseReport(page, ALL);
    return { label, atMs: Date.now() - t0, phrases: slim(rep), rep };
  };
  const m1 = await mid('0.5초');
  await shot(page, 'QA-164-transport-delay');
  await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
  const m2 = await mid('2초');
  rec.duringDelay = [m1, m2].map((m) => ({ label: m.label, atMs: m.atMs, phrases: m.phrases }));
  for (const m of [m1, m2]) {
    expect.soft(countAny(m.rep, P_REGISTER), `${m.label}: "먼저 테넌트를 등록하세요" 없음`).toBe(0);
    expect.soft(countAny(m.rep, P_GO), `${m.label}: "테넌트 화면으로 이동" 없음`).toBe(0);
    expect.soft(countAny(m.rep, P_NONE), `${m.label}: "등록된 테넌트가 없습니다" 없음`).toBe(0);
  }
  // 지연 중 테넌트 탭
  await tabBtn(page, '테넌트').click();
  await page.waitForTimeout(300);
  const tenantTabAria = await page.locator('main').ariaSnapshot();
  const skeleton = await page.evaluate(() => ({
    busy: document.querySelectorAll('[aria-busy="true"]').length,
    skeletonClass: [...document.querySelectorAll('[class]')].filter((e) => /skeleton/i.test(e.getAttribute('class') || '')).length,
    listItems: document.querySelectorAll('main li, main [role=listitem]').length,
    status: document.querySelectorAll('[role=status]').length,
  }));
  rec.tenantTabDuringDelay = { atMs: Date.now() - t0, skeleton, aria: tenantTabAria.slice(0, 1500) };
  await shot(page, 'QA-164-tenants-delay');
  expect.soft(Date.now() - t0, '여전히 지연 중(4초 전)').toBeLessThan(DELAY);
  expect.soft(skeleton.busy + skeleton.skeletonClass + skeleton.status, '자리표시(스켈레톤) 영역이 있음').toBeGreaterThan(0);
  expect.soft(tenantTabAria.includes(P_REGISTER) || tenantTabAria.includes(P_NONE), '테넌트 탭에 등록 안내 없음').toBe(false);
  // 도착 뒤
  await page.waitForTimeout(Math.max(0, DELAY + 1500 - (Date.now() - t0)));
  await toTransport(page);
  const after = await phraseReport(page, ALL);
  rec.afterArrival = slim(after);
  await shot(page, 'QA-164-after-arrival');
  expect(after[P_REGISTER].elements.length, '도착 뒤 "먼저 테넌트를 등록하세요"(0개)').toBeGreaterThanOrEqual(1);
  finish(rec, w);
});

test('QA-165: 테넌트 목록 읽기 실패와 다시 시도', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-165');
  const w = watch(page);
  expect((await tenantList(request)).length).toBe(0);
  const isTenants = (u: URL) => u.host === 'localhost:8080' && u.pathname === '/tenants';
  type Mode = { name: string; apply: (route: any) => Promise<void>; retry: boolean };
  const modes: Mode[] = [
    { name: 'a-abort', apply: (r) => r.abort('connectionrefused'), retry: true },
    { name: 'b-500json', apply: (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'X', message: 'x' }) }), retry: true },
    { name: 'c-200html', apply: (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>oops</body></html>' }), retry: false },
    { name: 'd-200noTenants', apply: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: 'OK' }) }), retry: false },
  ];
  rec.variants = [];
  for (const m of modes) {
    const row: Record<string, any> = { name: m.name, replacedUrl: 'GET http://localhost:8080/tenants (정확히 이 경로)' };
    const handler = async (route: any) => {
      if (route.request().method() === 'GET') await m.apply(route);
      else await route.continue();
    };
    await page.route(isTenants, handler);
    await freshPackageStep(page);
    await page.waitForTimeout(800);
    const rep = await phraseReport(page, ALL);
    row.transport = slim(rep);
    row.transportAlerts = (await page.getByRole('alert').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    await shot(page, `QA-165-${m.name}-transport`);
    expect.soft(countAny(rep, P_REGISTER), `${m.name}: "먼저 테넌트를 등록하세요" 없음(이관 화면)`).toBe(0);
    expect.soft(countAny(rep, P_GO), `${m.name}: "테넌트 화면으로 이동" 없음(이관 화면)`).toBe(0);
    await openTab(page, '테넌트');
    await page.waitForTimeout(500);
    const alerts = (await page.getByRole('alert').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    const retryBtn = page.getByRole('button', { name: '다시 시도' });
    row.tenantTab = { alerts, retryButtons: await retryBtn.count(), text: (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300) };
    await shot(page, `QA-165-${m.name}-tenants`);
    const repT = await phraseReport(page, ALL);
    expect.soft(countAny(repT, P_REGISTER), `${m.name}: 테넌트 탭에도 등록 안내 없음`).toBe(0);
    if (m.retry) {
      expect.soft(row.tenantTab.retryButtons, `${m.name}: 다시 시도 버튼`).toBeGreaterThan(0);
      expect.soft(alerts.length, `${m.name}: 오류 안내`).toBeGreaterThan(0);
      await page.unroute(isTenants, handler);
      const reqBefore = w.reqs.filter((r) => r.method === 'GET' && new URL(r.url).pathname === '/tenants').length;
      await retryBtn.first().click();
      await page.waitForTimeout(1000);
      const reqAfter = w.reqs.filter((r) => r.method === 'GET' && new URL(r.url).pathname === '/tenants').length;
      row.retry = { tenantsRequestsBefore: reqBefore, after: reqAfter };
      await toTransport(page);
      const rep2 = await phraseReport(page, ALL);
      row.afterRetry = slim(rep2);
      await shot(page, `QA-165-${m.name}-after-retry`);
      expect.soft(reqAfter, `${m.name}: 다시 시도 뒤 목록 요청이 다시 나감`).toBeGreaterThan(reqBefore);
      expect.soft(rep2[P_REGISTER].elements.length, `${m.name}: 다시 시도 뒤 "먼저 테넌트를 등록하세요"`).toBeGreaterThanOrEqual(1);
    } else {
      row.errorShape_recordOnly = { alerts, retryButtons: row.tenantTab.retryButtons };
      await page.unroute(isTenants, handler);
    }
    rec.variants.push(row);
  }
  finish(rec, w);
});
