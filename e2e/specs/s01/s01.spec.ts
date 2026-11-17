// 묶음 s01 — REQ-310 원본·대상 라디오의 방향키 포커스 유지 (QA-141~148). qa_cases.md "REQ-310" 절 그대로.
// 앱: --profile stub (초기 등록 DEV·PRD). QA-143이 3번째 테넌트 QA-T3를 등록하고 QA-148 끝에서 지운다.
// S3b(REQ-420): 원본·대상 라디오는 새 이관의 "경로 변경" 창(원본과 대상 선택) 안에 있다. 창 안의 선택은 "이 경로 사용"을 눌러야
// 적용되므로, 방향키 판정은 창 안에서 하고 패키지 목록 다시 읽기 판정은 적용 뒤에 한다.
import { expect, test } from '@playwright/test';
import { addMap, after, call, dropTenant, key, R, registerTenant, shot, sleep, STUB, tenantList } from '../../lib/qa';
import {
  arrow,
  active,
  applyRoute,
  applyRouteBtn,
  checkedLabels,
  expectFocus,
  foreignHosts,
  isTenantRadio,
  kbdFlow,
  keysTo,
  openRouteDialog,
  openTransport,
  packageIds,
  pkgRadios,
  radiosOf,
  routeDialog,
  selectedOf,
  setRoute,
  settle,
  stepBtn,
  waitTransport,
  watch,
  type ArrowStep,
  type Watch,
} from '../../lib/ui';

test.afterEach(async ({ request }) => {
  await after(request);
});

let t3Id = '';
const PKGS_DEV = ['PkgTransportDemo', 'PkgFaultDemo', 'PkgNotInPrd'];

async function ensureT3(request: any): Promise<string> {
  if (t3Id) return t3Id;
  const existing = (await tenantList(request)).find((t) => t.name === 'QA-T3');
  if (existing) t3Id = existing.id;
  else t3Id = await registerTenant(request, 'QA-T3', key(18082, '127.0.0.1'), true);
  return t3Id;
}
function finish(qa: string, w: Watch): void {
  R(qa).pageerrors = w.errors;
  R(qa).consoleErrors = w.consoleErrors;
  R(qa).consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  R(qa).nonLocalRequests = foreignHosts(w);
  R(qa).packageRequests = w.packageReqs;
  expect(w.errors, 'pageerror 0건').toEqual([]);
  expect(w.consoleErrors, 'console.error 0건 (HTTP 오류 응답 자동 로그 제외)').toEqual([]);
  expect(foreignHosts(w), 'localhost:8080 밖 요청 0건').toEqual([]);
}
const brief = (s: ArrowStep) => ({ key: s.key, t1: pick(s.t1), t2: pick(s.t2), source: s.sourceSelected, target: s.targetSelected });
const pick = (i: any) => ({ tag: i.tag, role: i.role, name: i.name, group: i.group, checked: i.checked });
/** 버튼이 없거나(목록 읽기 오류 등) 비활성이면 진행할 수 없다. */
const blocked = async (loc: any): Promise<boolean> => (await loc.count()) === 0 || (await loc.isDisabled());
const sameAlert = (page: any) => routeDialog(page).getByRole('alert').filter({ hasText: '원본과 대상이 같습니다' });

test('QA-141: 원본 그룹 방향키 이동과 포커스 유지', async ({ page }) => {
  const rec = R('QA-141');
  const w = watch(page);
  await openTransport(page);
  await openRouteDialog(page);
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹의 DEV 라디오');
  rec.tabPresses = nav.presses;
  rec.entry = pick(nav.info);
  expect(await selectedOf(page, '대상')).toEqual(['PRD']);

  const down = await arrow(page, w, 'ArrowDown');
  rec.step3_ArrowDown = brief(down);
  expectFocus(down, '원본', 'PRD', 'ArrowDown');
  expect(down.sourceSelected, '원본 그룹 선택 1개 = PRD').toEqual(['PRD']);
  expect(down.targetSelected, '대상 그룹 선택 변하지 않음').toEqual(['PRD']);
  await shot(page, 'QA-141-after-ArrowDown');

  const up = await arrow(page, w, 'ArrowUp');
  rec.step5_ArrowUp = brief(up);
  expectFocus(up, '원본', 'DEV', 'ArrowUp');
  expect(up.sourceSelected, '원본 그룹 선택 1개 = DEV').toEqual(['DEV']);
  expect(up.targetSelected, '대상 그룹 선택 변하지 않음').toEqual(['PRD']);
  await shot(page, 'QA-141-after-ArrowUp');
  await page.keyboard.press('Escape');
  await expect(routeDialog(page)).toHaveCount(0);
  finish('QA-141', w);
});

test('QA-142: 대상 그룹 방향키 이동과 포커스 유지', async ({ page }) => {
  const rec = R('QA-142');
  const w = watch(page);
  await openTransport(page);
  await openRouteDialog(page);
  const nav = await keysTo(page, isTenantRadio('대상', 'PRD'), '대상 그룹의 PRD 라디오');
  rec.tabPresses = nav.presses;
  expect(await selectedOf(page, '원본')).toEqual(['DEV']);

  const up = await arrow(page, w, 'ArrowUp');
  rec.step2_ArrowUp = brief(up);
  rec.sameNoticeVisibleAfterUp = await sameAlert(page).count();
  expectFocus(up, '대상', 'DEV', 'ArrowUp');
  expect(up.targetSelected).toEqual(['DEV']);
  await shot(page, 'QA-142-after-ArrowUp');

  const down = await arrow(page, w, 'ArrowDown');
  rec.step3_ArrowDown = brief(down);
  expectFocus(down, '대상', 'PRD', 'ArrowDown');
  expect(down.targetSelected).toEqual(['PRD']);
  expect(down.sourceSelected, '원본 선택 DEV 그대로').toEqual(['DEV']);
  await shot(page, 'QA-142-after-ArrowDown');
  await page.keyboard.press('Escape');
  finish('QA-142', w);
});

test('QA-143: 테넌트 3개 이상, 끝 위치의 방향키 이동', async ({ page, request }) => {
  const rec = R('QA-143');
  const id = await ensureT3(request);
  const list = await tenantList(request);
  rec.tenantOrder = list.map((t) => `${t.id}:${t.name}`);
  expect(list.map((t) => t.name)).toEqual(['DEV', 'PRD', 'QA-T3']);
  const w = watch(page);
  await openTransport(page);
  await openRouteDialog(page);
  expect((await radiosOf(page, '원본')).map((r) => r.name)).toEqual(['DEV', 'PRD', 'QA-T3']);

  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  rec.source = [];
  for (const [k, name] of [['ArrowDown', 'PRD'], ['ArrowDown', 'QA-T3'], ['ArrowUp', 'PRD'], ['ArrowUp', 'DEV']] as const) {
    const s = await arrow(page, w, k);
    rec.source.push(brief(s));
    expectFocus(s, '원본', name, `원본 ${k}`);
    expect(s.sourceSelected, `원본 선택 ${name}`).toEqual([name]);
  }
  // 3. 대상 그룹: Tab 으로 들어가 ArrowUp(PRD→DEV), 이어서 ArrowDown 2회(DEV→PRD→QA-T3)
  const nav2 = await keysTo(page, isTenantRadio('대상', 'PRD'), '대상 그룹 PRD');
  rec.targetTabPresses = nav2.presses;
  rec.target = [];
  for (const [k, name] of [['ArrowUp', 'DEV'], ['ArrowDown', 'PRD'], ['ArrowDown', 'QA-T3']] as const) {
    const s = await arrow(page, w, k);
    rec.target.push(brief(s));
    expectFocus(s, '대상', name, `대상 ${k}`);
    expect(s.targetSelected, `대상 선택 ${name}`).toEqual([name]);
  }
  // 4. 기록용(판정 안 함): 끝에서 ArrowDown, 처음에서 ArrowUp, 좌우 방향키. 어떤 입력 뒤에도 BODY 로 나가지 않는다.
  rec.info = [];
  const visit = async (k: string) => {
    const s = await arrow(page, w, k);
    rec.info.push({ ...brief(s) });
    expect(s.t1.tag, `${k} 직후 포커스가 BODY 아님`).not.toBe('BODY');
    expect(s.t2.tag, `${k} 뒤 포커스가 BODY 아님`).not.toBe('BODY');
  };
  await visit('ArrowDown'); // 끝(QA-T3)에서
  for (let i = 0; i < 4 && (await selectedOf(page, '대상'))[0] !== 'DEV'; i++) await visit('ArrowUp');
  await visit('ArrowUp'); // 처음(DEV)에서
  await visit('ArrowRight');
  await visit('ArrowLeft');
  await shot(page, 'QA-143-end');
  await page.keyboard.press('Escape');
  expect(id).toBeTruthy();
  finish('QA-143', w);
});

test('QA-144: 빠른 연속 방향키와 마지막 선택 일치', async ({ page, request }) => {
  const rec = R('QA-144');
  const t3 = await ensureT3(request);
  // 구분을 위해 PRD 스텁에 패키지 목록 임시 매핑 한 개(H-4). DEV 는 기본 목록 3개. QA-T3 도 18082 라 같은 목록이다.
  const mapId = await addMap(request, 18082, {
    priority: 1,
    request: { method: 'GET', urlPath: '/api/v1/IntegrationPackages' },
    response: { status: 200, jsonBody: { d: { results: [{ Id: 'PkgPrdOnly', Name: 'Prd Only', Version: '1.0.0' }] } }, headers: { 'Content-Type': 'application/json' } },
  });
  rec.tempMappingId = mapId;
  const w = watch(page);
  const delayed: string[] = [];
  await page.route(
    (u) => u.pathname === '/packages' && u.searchParams.get('tenantId') === 'DEV',
    async (route) => {
      delayed.push(route.request().url());
      await sleep(600);
      await route.continue();
    },
  );
  rec.replacedUrls = 'GET http://localhost:8080/packages?tenantId=DEV 응답 600ms 지연 (page.route, route.continue)';
  await openTransport(page);
  await openRouteDialog(page);
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  const reqsBeforeKeys = w.packageReqs.length;
  const keys = ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowUp'];
  const seq: any[] = [];
  const t0 = Date.now();
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(Math.floor(Math.random() * 20));
    seq.push({ k, at: Date.now() - t0 });
  }
  rec.keySequence = seq;
  await settle(page, w, 500);
  const info = await active(page);
  const sel = await selectedOf(page, '원본');
  rec.inDialog = { focus: pick(info), sourceSelected: sel, packageRequestsDuringKeys: w.packageReqs.length - reqsBeforeKeys };
  expect(sel.length, '선택된 원본 라디오 정확히 1개').toBe(1);
  expect(info.tag, '포커스가 BODY 아님').not.toBe('BODY');
  expect(isTenantRadio('원본', sel[0])(info), `포커스 = 선택된 원본 라디오 ${sel[0]} 실제 ${JSON.stringify(pick(info))}`).toBe(true);
  expect(rec.inDialog.packageRequestsDuringKeys, '창 안의 선택만으로는 패키지 목록을 다시 읽지 않음(적용 전)').toBe(0);
  expect(sel[0], '대상(PRD)과 다른 원본이어야 적용 가능 — 키 순서상 마지막 선택').not.toBe('PRD');
  await applyRoute(page);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settle(page, w, 800);
  const shown = await packageIds(page);
  const last = w.packageReqs[w.packageReqs.length - 1];
  const lastTenant = new URL(last).searchParams.get('tenantId');
  const idOf: Record<string, string> = { DEV: 'DEV', PRD: 'PRD', 'QA-T3': t3 };
  rec.final = { sourceSelected: sel, packagesShown: shown, packageRequestsInOrder: w.packageReqs.map((u) => new URL(u).searchParams.get('tenantId')), lastPackageRequestTenantId: lastTenant, delayedDevRequests: delayed.length };
  await shot(page, 'QA-144-final');
  expect(lastTenant, '마지막 GET /packages 의 tenantId = 선택된 원본 id').toBe(idOf[sel[0]]);
  expect(shown, '화면 패키지 목록 = 마지막 선택 원본 기준').toEqual(sel[0] === 'DEV' ? PKGS_DEV : ['PkgPrdOnly']);
  finish('QA-144', w);
});

test('QA-145: 방향키로 원본을 대상과 같게 옮길 때', async ({ page, request }) => {
  const rec = R('QA-145');
  await ensureT3(request);
  const w = watch(page);
  await openTransport(page);
  await openRouteDialog(page);
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  const s1 = await arrow(page, w, 'ArrowDown');
  rec.step1_toPRD = brief(s1);
  expectFocus(s1, '원본', 'PRD', '원본 ArrowDown(PRD=대상)');
  rec.step2 = { sameNotice: await sameAlert(page).count(), applyDisabled: await applyRouteBtn(page).isDisabled() };
  await shot(page, 'QA-145-same');
  expect(rec.step2.sameNotice, '"원본과 대상이 같습니다" 경고 표시').toBeGreaterThan(0);
  expect(rec.step2.applyDisabled, '"이 경로 사용" 비활성').toBe(true);

  const s3 = await arrow(page, w, 'ArrowDown');
  rec.step3_toQAT3 = brief(s3);
  expectFocus(s3, '원본', 'QA-T3', '원본 ArrowDown(QA-T3)');
  rec.step4 = { sameNotice: await sameAlert(page).count(), applyDisabled: await applyRouteBtn(page).isDisabled() };
  expect(rec.step4.sameNotice, '같다는 안내 사라짐').toBe(0);
  expect(rec.step4.applyDisabled, '"이 경로 사용" 활성').toBe(false);
  await applyRoute(page);
  const next = page.getByRole('button', { name: '다음', exact: true });
  // QA-T3(127.0.0.1:18082)의 패키지 목록은 이 스텁에서 읽기 오류가 날 수 있다. 목록이 아니라 패키지 단계가 된 것을 기다린다.
  await expect(stepBtn(page, '패키지')).toHaveAttribute('aria-current', 'step');
  await page.waitForTimeout(500);
  rec.step5 = { packageChecked: await checkedLabels(pkgRadios(page)), nextDisabled: await blocked(next), artifactStepDisabled: await stepBtn(page, '아티팩트').isDisabled() };
  await shot(page, 'QA-145-different');
  expect(rec.step5.packageChecked, '적용 뒤 패키지 선택 없음').toEqual([]);
  expect(rec.step5.nextDisabled, '패키지를 고르지 않았으므로 "다음" 비활성(또는 목록 오류로 없음)').toBe(true);
  expect(rec.step5.artifactStepDisabled, '아티팩트 단계 비활성').toBe(true);
  // 이 앱은 읽기 전용 기본값이다. 미리보기 전이라 실제 이관 단계로 갈 수도 없다(기록과 판정).
  rec.realStepDisabled = await stepBtn(page, '실제 이관').isDisabled();
  expect(rec.realStepDisabled, '실제 이관 단계 비활성(미리보기 전)').toBe(true);
  finish('QA-145', w);
});

test('QA-146: 키보드만으로 미리보기 시작', async ({ page, request }) => {
  const rec = R('QA-146');
  await ensureT3(request);
  const w = watch(page);
  const steps = await kbdFlow(page, w, 'PRD');
  rec.steps = steps;
  expect(steps.sameNoticeAfterTargetUp, '대상=원본일 때 같음 안내').toBeGreaterThan(0);
  expect(steps.applyDisabledWhenSame, '대상=원본일 때 "이 경로 사용" 비활성').toBe(true);
  expect(steps.buttonDisabled, '미리보기 실행 버튼 활성').toBe(false);
  expect(steps.buttonTab, 'Tab 60회 안').toBeLessThanOrEqual(60);
  const out = await waitTransport(page, async () => {
    await page.keyboard.press('Enter');
  });
  rec.request = out.postData;
  rec.response = { status: out.status, dryRun: out.body?.dryRun, summary: out.body?.summary, results: (out.body?.results ?? []).map((r: any) => `${r.artifactId}:${r.status}`) };
  expect(out.status).toBe(200);
  expect(out.postData.packageId).toBe('PkgTransportDemo');
  expect(out.postData.sourceTenantId).toBe('DEV');
  expect(out.postData.targetTenantId).toBe('PRD');
  expect(out.postData.dryRun).toBe(true);
  const sel: string[] = steps.checkedArtifacts;
  const reqIds = out.postData.artifactIds;
  if (sel.length === 0) expect(reqIds === undefined || reqIds === null || (Array.isArray(reqIds) && reqIds.length === 0), `artifactIds 기본값 일치 (조작 없음, 요청=${JSON.stringify(reqIds)})`).toBe(true);
  else expect(reqIds.length).toBe(sel.length);
  await expect(page.getByRole('region', { name: '이관 결과' })).toBeVisible();
  await expect(page.getByRole('region', { name: '이관 결과' }).getByRole('heading', { name: 'IF_Order_Sync', level: 4 })).toBeVisible();
  rec.resultSummaryText = (await page.getByRole('region', { name: '이관 결과' }).innerText()).slice(0, 300);
  await shot(page, 'QA-146-result');
  const h = await call(request, 'GET', 'http://localhost:8080/transport/history');
  rec.historyCountObserved = (h.json as any[]).length;
  rec.lastHistoryDryRun = (h.json as any[])[0]?.dryRun;
  finish('QA-146', w);
});

test('QA-147: 패키지 선택 뒤 방향키로 원본 변경', async ({ page, request }) => {
  const rec = R('QA-147');
  await ensureT3(request);
  const w = watch(page);
  const steps = await kbdFlow(page, w, 'PRD');
  rec.steps = steps;
  expect(steps.buttonDisabled).toBe(false);
  const isBtn = (text: string) => (i: any) => i.tag === 'BUTTON' && i.text === text;
  // 키보드로 경로 변경 창을 열고 원본을 방향키로 바꾼 뒤 적용한다(대상 PRD 와 다른 QA-T3 로).
  const changeSource = async (keysToPress: string[], expectName: string, label: string) => {
    await keysTo(page, isBtn('경로 변경'), '"경로 변경" 버튼', 'Shift+Tab', 60);
    await page.keyboard.press('Enter');
    await expect(routeDialog(page)).toBeVisible();
    await keysTo(page, isTenantRadio('원본'), '원본 그룹 선택 라디오');
    let s: ArrowStep | null = null;
    for (const k of keysToPress) s = await arrow(page, w, k);
    expectFocus(s!, '원본', expectName, label);
    await keysTo(page, isBtn('이 경로 사용'), '"이 경로 사용" 버튼');
    await page.keyboard.press('Enter');
    await expect(routeDialog(page)).toHaveCount(0);
    await expect(stepBtn(page, '패키지')).toHaveAttribute('aria-current', 'step');
    await settle(page, w);
    return { ...brief(s!), state: await readState() };
  };
  const readState = async () => ({
    current: await stepBtn(page, '패키지').getAttribute('aria-current'),
    packageChecked: await checkedLabels(pkgRadios(page)),
    nextDisabled: await blocked(page.getByRole('button', { name: '다음', exact: true })),
    allPreviewDisabled: await blocked(page.getByRole('button', { name: '전체 아티팩트로 미리보기', exact: true })),
    artifactStepDisabled: await stepBtn(page, '아티팩트').isDisabled(),
  });
  rec.step2_toQAT3 = await changeSource(['ArrowDown', 'ArrowDown'], 'QA-T3', '원본 ArrowDown×2');
  await shot(page, 'QA-147-after-change');
  expect(rec.step2_toQAT3.state.current, '경로를 바꾸면 패키지 단계').toBe('step');
  expect(rec.step2_toQAT3.state.packageChecked, '패키지 선택 비워짐').toEqual([]);
  expect(rec.step2_toQAT3.state.nextDisabled, '"다음" 비활성').toBe(true);
  expect(rec.step2_toQAT3.state.allPreviewDisabled, '"전체 아티팩트로 미리보기" 비활성').toBe(true);
  expect(rec.step2_toQAT3.state.artifactStepDisabled, '아티팩트 단계 비활성').toBe(true);
  rec.step4_backToDEV = await changeSource(['ArrowUp', 'ArrowUp'], 'DEV', '원본 ArrowUp×2');
  await shot(page, 'QA-147-after-back');
  expect(rec.step4_backToDEV.state.packageChecked, '패키지 선택 자동 복원 안 됨').toEqual([]);
  expect(rec.step4_backToDEV.state.nextDisabled).toBe(true);
  finish('QA-147', w);
});

test('QA-148: 원본 변경 뒤 패키지 목록을 새 원본 기준으로 다시 읽기', async ({ page, request }) => {
  const rec = R('QA-148');
  const t3 = await ensureT3(request);
  const before = (await call(request, 'GET', `${STUB[18082]}/__admin/mappings`)).json.mappings.length;
  const mapId = await addMap(request, 18082, {
    priority: 1,
    request: { method: 'GET', urlPath: '/api/v1/IntegrationPackages' },
    response: { status: 200, jsonBody: { d: { results: [{ Id: 'PkgPrdOnly', Name: 'Prd Only', Version: '1.0.0' }] } }, headers: { 'Content-Type': 'application/json' } },
  });
  rec.tempMapping = { id: mapId, mappingsBefore: before };
  const w = watch(page);
  await openTransport(page);
  await setRoute(page, 'DEV', 'QA-T3');
  const lastTenant = () => new URL(w.packageReqs[w.packageReqs.length - 1]).searchParams.get('tenantId');
  await setRoute(page, 'PRD', 'QA-T3');
  await settle(page, w);
  rec.step2_PRD = { packages: await packageIds(page), lastRequestTenantId: lastTenant() };
  expect(rec.step2_PRD.lastRequestTenantId, 'PRD 적용 뒤 마지막 GET /packages tenantId').toBe('PRD');
  expect(rec.step2_PRD.packages, 'PRD 목록').toEqual(['PkgPrdOnly']);
  await setRoute(page, 'DEV', 'QA-T3');
  await settle(page, w);
  rec.step4_DEV = { packages: await packageIds(page), lastRequestTenantId: lastTenant() };
  expect(rec.step4_DEV.lastRequestTenantId).toBe('DEV');
  expect(rec.step4_DEV.packages).toEqual(PKGS_DEV);
  // 5. DEV 응답 1500ms 지연, 빠르게 PRD → DEV → PRD 로 적용
  const delayed: string[] = [];
  await page.route(
    (u) => u.pathname === '/packages' && u.searchParams.get('tenantId') === 'DEV',
    async (route) => {
      delayed.push(route.request().url());
      await sleep(1500);
      await route.continue();
    },
  );
  rec.replacedUrls = 'GET http://localhost:8080/packages?tenantId=DEV 응답 1500ms 지연 (page.route, route.continue)';
  const seqStart = w.packageReqs.length;
  const t0 = Date.now();
  for (const src of ['PRD', 'DEV', 'PRD']) await setRoute(page, src, 'QA-T3');
  rec.raceElapsedMs = Date.now() - t0;
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settle(page, w, 1800);
  rec.step6 = { routeText: await page.getByRole('group', { name: '이관 경로' }).innerText(), packages: await packageIds(page), requestsInRace: w.packageReqs.slice(seqStart).map((u) => new URL(u).searchParams.get('tenantId')), delayedDevRequests: delayed.length, focus: pick(await active(page)) };
  await shot(page, 'QA-148-after-race');
  expect(rec.step6.routeText).toContain('PRD → QA-T3');
  expect(rec.step6.delayedDevRequests, '지연된 DEV 요청이 경쟁 중에 나감').toBeGreaterThan(0);
  expect(rec.step6.packages, '마지막 선택 PRD 의 목록만 (DEV 의 오래된 응답이 덮어쓰지 않음)').toEqual(['PkgPrdOnly']);
  await page.unroute(() => true).catch(() => undefined);
  // 매핑 삭제 확인
  await call(request, 'DELETE', `${STUB[18082]}/__admin/mappings/${mapId}`);
  const after2 = (await call(request, 'GET', `${STUB[18082]}/__admin/mappings`)).json.mappings.length;
  rec.mappingsAfterDelete = after2;
  expect(after2, '임시 매핑 삭제 뒤 개수 복귀').toBe(before);
  finish('QA-148', w);
  // 정리: s01 이 만든 3번째 테넌트 삭제
  const d = await dropTenant(request, t3);
  rec.cleanupT3 = d.status;
});
