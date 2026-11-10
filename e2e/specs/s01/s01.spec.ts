// 묶음 s01 — REQ-310 원본·대상 라디오의 방향키 포커스 유지 (QA-141~148). qa_cases.md "REQ-310" 절 그대로.
// 앱: --profile stub (초기 등록 DEV·PRD). QA-143이 3번째 테넌트 QA-T3를 등록하고 QA-148 끝에서 지운다.
import { expect, test, type Page } from '@playwright/test';
import { addMap, after, call, dropTenant, key, R, registerTenant, shot, sleep, STUB, tenantList } from '../../lib/qa';
import {
  arrow,
  active,
  expectFocus,
  foreignHosts,
  grp,
  isTenantRadio,
  keysTo,
  modeRadio,
  openTransport,
  packageIds,
  pkgRadios,
  checkedLabels,
  previewBtn,
  radiosOf,
  selectedOf,
  settle,
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

test('QA-141: 원본 그룹 방향키 이동과 포커스 유지', async ({ page }) => {
  const rec = R('QA-141');
  const w = watch(page);
  await openTransport(page);
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
  finish('QA-141', w);
});

test('QA-142: 대상 그룹 방향키 이동과 포커스 유지', async ({ page }) => {
  const rec = R('QA-142');
  const w = watch(page);
  await openTransport(page);
  const nav = await keysTo(page, isTenantRadio('대상', 'PRD'), '대상 그룹의 PRD 라디오');
  rec.tabPresses = nav.presses;
  expect(await selectedOf(page, '원본')).toEqual(['DEV']);

  const up = await arrow(page, w, 'ArrowUp');
  rec.step2_ArrowUp = brief(up);
  rec.sameNoticeVisibleAfterUp = await page.getByText('원본과 대상이 같습니다', { exact: true }).count();
  expectFocus(up, '대상', 'DEV', 'ArrowUp');
  expect(up.targetSelected).toEqual(['DEV']);
  await shot(page, 'QA-142-after-ArrowUp');

  const down = await arrow(page, w, 'ArrowDown');
  rec.step3_ArrowDown = brief(down);
  expectFocus(down, '대상', 'PRD', 'ArrowDown');
  expect(down.targetSelected).toEqual(['PRD']);
  expect(down.sourceSelected, '원본 선택 DEV 그대로').toEqual(['DEV']);
  await shot(page, 'QA-142-after-ArrowDown');
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
  expect(id).toBeTruthy();
  finish('QA-143', w);
});

test('QA-144: 빠른 연속 방향키와 마지막 선택 일치', async ({ page, request }) => {
  const rec = R('QA-144');
  const t3 = await ensureT3(request);
  // 구분을 위해 PRD 스텁에 패키지 목록 임시 매핑 한 개(H-4). DEV 는 기본 목록 3개.
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
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  const keys = ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowUp'];
  const seq: any[] = [];
  const t0 = Date.now();
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(Math.floor(Math.random() * 20));
    seq.push({ k, at: Date.now() - t0 });
  }
  rec.keySequence = seq;
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settle(page, w, 800);
  const info = await active(page);
  const sel = await selectedOf(page, '원본');
  const shown = await packageIds(page);
  const last = w.packageReqs[w.packageReqs.length - 1];
  const lastTenant = new URL(last).searchParams.get('tenantId');
  const idOf: Record<string, string> = { DEV: 'DEV', PRD: 'PRD', 'QA-T3': t3 };
  rec.final = { focus: pick(info), sourceSelected: sel, packagesShown: shown, packageRequestsInOrder: w.packageReqs.map((u) => new URL(u).searchParams.get('tenantId')), lastPackageRequestTenantId: lastTenant, delayedDevRequests: delayed.length };
  await shot(page, 'QA-144-final');
  expect(sel.length, '선택된 원본 라디오 정확히 1개').toBe(1);
  expect(info.tag, '포커스가 BODY 아님').not.toBe('BODY');
  expect(isTenantRadio('원본', sel[0])(info), `포커스 = 선택된 원본 라디오 ${sel[0]} 실제 ${JSON.stringify(pick(info))}`).toBe(true);
  expect(lastTenant, '마지막 GET /packages 의 tenantId = 선택된 원본 id').toBe(idOf[sel[0]]);
  expect(shown, '화면 패키지 목록 = 마지막 선택 원본 기준').toEqual(sel[0] === 'DEV' ? PKGS_DEV : ['PkgPrdOnly']);
  finish('QA-144', w);
});

test('QA-145: 방향키로 원본을 대상과 같게 옮길 때', async ({ page, request }) => {
  const rec = R('QA-145');
  await ensureT3(request);
  const w = watch(page);
  await openTransport(page);
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  const same = page.getByText('원본과 대상이 같습니다', { exact: true });
  const s1 = await arrow(page, w, 'ArrowDown');
  rec.step1_toPRD = brief(s1);
  expectFocus(s1, '원본', 'PRD', '원본 ArrowDown(PRD=대상)');
  rec.step2 = { sameNotice: await same.count(), previewDisabled: await previewBtn(page).isDisabled(), definitions: await page.locator('dd').allInnerTexts() };
  await shot(page, 'QA-145-same');
  expect(await same.count(), '"원본과 대상이 같습니다" 표시').toBeGreaterThan(0);
  expect(await previewBtn(page).isDisabled(), '미리보기 실행 비활성').toBe(true);

  const s3 = await arrow(page, w, 'ArrowDown');
  rec.step3_toQAT3 = brief(s3);
  expectFocus(s3, '원본', 'QA-T3', '원본 ArrowDown(QA-T3)');
  rec.step4 = { sameNotice: await same.count(), previewDisabled: await previewBtn(page).isDisabled(), packageDefinition: await page.getByText('선택 안 됨', { exact: true }).count() };
  await shot(page, 'QA-145-different');
  expect(await same.count(), '같다는 안내 사라짐').toBe(0);
  expect(await previewBtn(page).isDisabled(), '패키지를 고르지 않았으므로 비활성').toBe(true);
  expect(await page.getByText('선택 안 됨', { exact: true }).count(), '비활성 이유 = 패키지 미선택').toBeGreaterThan(0);
  finish('QA-145', w);

  // 이 앱은 읽기 전용 기본값이라 "실제 이관" 항목을 고를 수 없다. 그 사실만 기록한다(qa_cases: "미리보기 실행"·실제 이관은 비활성).
  rec.realModeRadioDisabled = await modeRadio(page, '실제 이관').isDisabled();
  expect(rec.realModeRadioDisabled, '실제 이관 항목 비활성(읽기 전용 앱)').toBe(true);
});

/** QA-146 절차 1~6: 키보드(Tab·Shift+Tab·방향키)만으로 미리보기 실행 버튼 앞까지. click/focus/check 를 쓰지 않는다. */
async function keyboardToReady(page: Page, w: Watch, rec: any) {
  await openTransport(page);
  const steps: any = (rec.steps = {});
  const n1 = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  steps.sourceTab = n1.presses;
  const a = await arrow(page, w, 'ArrowDown');
  expectFocus(a, '원본', 'PRD', '원본 ArrowDown');
  const b = await arrow(page, w, 'ArrowUp');
  expectFocus(b, '원본', 'DEV', '원본 ArrowUp');
  steps.source = [brief(a), brief(b)];
  const n2 = await keysTo(page, isTenantRadio('대상', 'PRD'), '대상 그룹 PRD');
  steps.targetTab = n2.presses;
  const c = await arrow(page, w, 'ArrowUp');
  expectFocus(c, '대상', 'DEV', '대상 ArrowUp');
  steps.sameNoticeAfterTargetUp = await page.getByText('원본과 대상이 같습니다', { exact: true }).count();
  expect(steps.sameNoticeAfterTargetUp, '대상=원본일 때 같음 안내').toBeGreaterThan(0);
  const d = await arrow(page, w, 'ArrowDown');
  expectFocus(d, '대상', 'PRD', '대상 ArrowDown');
  steps.target = [brief(c), brief(d)];
  // 패키지 목록으로: DOM 순서상 패키지 목록이 테넌트 그룹보다 앞이라 Shift+Tab 으로 되돌아간다.
  const n3 = await keysTo(page, (i) => i.tag === 'INPUT' && i.type === 'radio' && i.group === '패키지 목록', '패키지 목록 라디오', 'Shift+Tab');
  steps.packageShiftTab = n3.presses;
  steps.packageEntry = pick(n3.info);
  const seen: any[] = [];
  for (let i = 0; i < 5; i++) {
    const cur = await active(page);
    if (/PkgTransportDemo/.test(cur.name) && cur.checked) break;
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    seen.push(pick(await active(page)));
  }
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const down = pick(await active(page));
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('list', { name: '아티팩트 목록' })).toBeVisible();
  await page.waitForTimeout(300);
  const fin = await active(page);
  steps.packageKeys = { upward: seen, afterArrowDown: down, afterArrowUp: pick(fin) };
  expect(fin.name, '키보드로 선택한 패키지 PkgTransportDemo').toMatch(/PkgTransportDemo/);
  expect(fin.checked).toBe(true);
  steps.selectedPackage = await checkedLabels(pkgRadios(page));
  // ④ 아티팩트는 건드리지 않는다
  steps.checkedArtifacts = await checkedLabels(page.getByRole('list', { name: '아티팩트 목록' }).getByRole('checkbox'));
  const n4 = await keysTo(page, (i) => i.tag === 'BUTTON' && i.text === '미리보기 실행', '"미리보기 실행" 버튼', 'Tab');
  steps.buttonTab = n4.presses;
  steps.buttonDisabled = n4.info.disabled;
  return steps;
}

test('QA-146: 키보드만으로 미리보기 시작', async ({ page, request }) => {
  const rec = R('QA-146');
  await ensureT3(request);
  const w = watch(page);
  const steps = await keyboardToReady(page, w, rec);
  expect(steps.buttonDisabled, '미리보기 실행 버튼 활성').toBe(false);
  expect(steps.buttonTab, 'Tab 40회 안').toBeLessThanOrEqual(40);
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
  const steps = await keyboardToReady(page, w, rec);
  expect(steps.buttonDisabled).toBe(false);
  const n = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV', 'Shift+Tab');
  rec.shiftTabToSource = n.presses;
  const readState = async () => ({
    packageChecked: await checkedLabels(pkgRadios(page)),
    previewDisabled: await previewBtn(page).isDisabled(),
    packageAreaText: (await page.locator('section, div').filter({ has: page.getByRole('heading', { name: '패키지', level: 3, exact: true }) }).first().innerText().catch(() => '')).slice(0, 200),
    definition: await page.locator('dd').allInnerTexts(),
  });
  const s1 = await arrow(page, w, 'ArrowDown');
  rec.step2_ArrowDown = { ...brief(s1), state: await readState() };
  await shot(page, 'QA-147-after-ArrowDown');
  expectFocus(s1, '원본', 'PRD', '원본 ArrowDown');
  expect(rec.step2_ArrowDown.state.packageChecked, '패키지 선택 비워짐').toEqual([]);
  expect(rec.step2_ArrowDown.state.previewDisabled, '미리보기 실행 비활성').toBe(true);
  const s2 = await arrow(page, w, 'ArrowUp');
  rec.step4_ArrowUp = { ...brief(s2), state: await readState() };
  await shot(page, 'QA-147-after-ArrowUp');
  expectFocus(s2, '원본', 'DEV', '원본 ArrowUp');
  expect(rec.step4_ArrowUp.state.packageChecked, '패키지 선택 자동 복원 안 됨').toEqual([]);
  expect(rec.step4_ArrowUp.state.previewDisabled).toBe(true);
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
  await grp(page, '대상').getByRole('radio', { name: 'QA-T3', exact: true }).check();
  const nav = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  rec.tabPresses = nav.presses;
  const lastTenant = () => new URL(w.packageReqs[w.packageReqs.length - 1]).searchParams.get('tenantId');
  const s2 = await arrow(page, w, 'ArrowDown');
  rec.step2_PRD = { ...brief(s2), packages: await packageIds(page), lastRequestTenantId: lastTenant() };
  expect(rec.step2_PRD.lastRequestTenantId, 'PRD 선택 뒤 마지막 GET /packages tenantId').toBe('PRD');
  expect(rec.step2_PRD.packages, 'PRD 목록').toEqual(['PkgPrdOnly']);
  const s4 = await arrow(page, w, 'ArrowUp');
  rec.step4_DEV = { ...brief(s4), packages: await packageIds(page), lastRequestTenantId: lastTenant() };
  expect(rec.step4_DEV.lastRequestTenantId).toBe('DEV');
  expect(rec.step4_DEV.packages).toEqual(PKGS_DEV);
  // 5. DEV 응답 1500ms 지연, 빠르게 PRD → DEV → PRD
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
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(30);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settle(page, w, 800);
  rec.step6 = { sourceSelected: await selectedOf(page, '원본'), packages: await packageIds(page), requestsInRace: w.packageReqs.slice(seqStart).map((u) => new URL(u).searchParams.get('tenantId')), delayedDevRequests: delayed.length, focus: pick(await active(page)) };
  await shot(page, 'QA-148-after-race');
  expect(rec.step6.sourceSelected).toEqual(['PRD']);
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
