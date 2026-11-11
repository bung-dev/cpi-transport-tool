// 묶음 s09 — REQ-319 AC-1~AC-3 (QA-215~223, 파일 안에서 번호 순). qa_cases.md "REQ-319" 절 그대로.
// 앱: --profile stub --read-only false. 한 파일에서 번호 순으로 실행하며 앱·이력·저장소를 함께 쓴다.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import {
  addMap,
  delMap,
  after,
  app,
  call,
  dropTenant,
  findTenant,
  historyFile,
  historyOf,
  key,
  mappingCount,
  R,
  registerTenant,
  shot,
  STUB,
  stubCount,
  stubReset,
  tenantList,
} from '../../lib/qa';
import {
  bundleScan,
  brief,
  CLOSING_SENTENCE,
  choosePackage,
  confirmDialogRun,
  descOf,
  foreignHosts,
  grp,
  historyTable,
  hoverFocusSweep,
  modeInfo,
  modeRadio,
  OLD_TERM,
  openTab,
  openTransport,
  previewBtn,
  realBtn,
  resultBadge,
  resultRegion,
  runPreview,
  scannerControl,
  scanOldTerm,
  waitTransport,
  watch,
  type ScanResult,
  type Watch,
  tabBtn, gotoFresh } from '../../lib/ui';

test.afterEach(async ({ request }) => {
  await after(request);
});

const PUBLIC_KEYS = ['transportId', 'packageId', 'dryRun', 'deploy', 'startedAt', 'finishedAt', 'summary', 'results', 'sourceTenant', 'targetTenant'];

/** H-8 스캔 한 번. 결과를 rec.scans 에 쌓고 옛 명칭이 나오면 (soft) 실패로 센다. */
async function scan(page: Page, rec: any, state: string, w: Watch, mask: string[] = []): Promise<ScanResult> {
  const r = await scanOldTerm(page, state, w, mask);
  (rec.scans ??= []).push(brief(r));
  expect.soft(r.failTotal, `H-8 ${state}: FAIL 검색어 '${OLD_TERM}' 0건 (${r.fail.map((h) => `${h.source}/${h.variant}=${h.count}`).join(', ')})`).toBe(0);
  return r;
}
function finish(rec: any, w: Watch, opts: { allowConsole?: boolean } = {}): void {
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  rec.nonLocalRequests = foreignHosts(w);
  rec.nativeDialogs = w.dialogs;
  expect.soft(w.errors, 'pageerror 0건').toEqual([]);
  if (!opts.allowConsole) expect.soft(w.consoleErrors, 'console.error 0건 (HTTP 오류 응답 자동 로그 제외)').toEqual([]);
  expect.soft(foreignHosts(w), 'localhost:8080 밖 요청 0건').toEqual([]);
}
const norm = (s: string) => s.trim().normalize('NFC');
const modeOfRow = (dryRun: any) => (dryRun === true ? '미리보기' : '실제 이관');

// ------------------------------------------------------------------------------------------ QA-215
test('QA-215: 이관 탭 문구와 기본 선택', async ({ page }) => {
  const rec = R('QA-215');
  const w = watch(page);
  await openTransport(page);
  // H-9: 스캐너 양성 대조
  rec.scannerControl = await scannerControl(page, w);
  expect(rec.scannerControl.allFound, 'H-9 변형 5종 모두 찾음').toBe(true);
  expect(rec.scannerControl.cleanZero, 'H-9 제거 뒤 0건').toBe(true);

  const para = (await page.locator('main p').first().innerText()).trim();
  rec.paragraph = para;
  expect(para.endsWith(CLOSING_SENTENCE), `설명 문단이 '${CLOSING_SENTENCE}'로 끝남`).toBe(true);
  const mi = await modeInfo(page);
  rec.modeInfo = mi;
  rec.radioRoleChecks = {
    preview: await modeRadio(page, '미리보기').count(),
    real: await modeRadio(page, '실제 이관').count(),
    note: '실행 방식 항목은 접근성 트리상 radio(radiogroup "실행 모드")',
  };
  expect(mi.items.map((i) => i.title), '두 제목').toEqual(['미리보기', '실제 이관']);
  expect(mi.items.map((i) => i.checked), '기본 선택 = 미리보기').toEqual([true, false]);
  rec.descPreview = { raw: mi.items[0].desc, normalized: norm(mi.items[0].desc), expected: descOf('PRD') };
  expect(norm(mi.items[0].desc), 'H-11 설명 문장 문자열 완전 일치').toBe(descOf('PRD'));
  expect(mi.items[0].desc).not.toContain(OLD_TERM);
  rec.realItemDesc_INFO = mi.items[1].desc;
  // 실행 버튼
  rec.previewBtnCount = await previewBtn(page).count();
  expect(rec.previewBtnCount, '실행 버튼 이름 정확히 미리보기 실행').toBe(1);
  rec.buttonBeforePackage = await previewBtn(page).isDisabled();
  expect(rec.buttonBeforePackage, '패키지 선택 전 비활성').toBe(true);
  expect(mi.deployControls, '미리보기에는 배포 관련 컨트롤 없음').toEqual([]);
  await scan(page, rec, '이관-초기', w);
  await choosePackage(page, 'PkgTransportDemo');
  rec.buttonAfterPackage = await previewBtn(page).isDisabled();
  expect(rec.buttonAfterPackage, '패키지 선택 뒤 활성').toBe(false);
  rec.deployControlsAfterPackage = (await modeInfo(page)).deployControls;
  expect((await modeInfo(page)).deployControls).toEqual([]);
  await scan(page, rec, '이관-패키지선택', w);
  await shot(page, 'QA-215-transport');
  // 9. INFO: 대상 DEV 에서의 설명 문장
  await grp(page, '대상').getByRole('radio', { name: 'DEV', exact: true }).check();
  const miDev = await modeInfo(page);
  rec.info_descWithTargetDEV = miDev.items.map((i) => i.desc);
  await grp(page, '대상').getByRole('radio', { name: 'PRD', exact: true }).check();
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-216
test('QA-216: 미리보기 실행 - 결과 머리 배지, 요청 본문, 응답 형식, 대상 무요청', async ({ page, request }) => {
  const rec = R('QA-216');
  const w = watch(page);
  await stubReset(request);
  const h0 = (await historyOf(request)).length;
  rec.historyBefore = h0;
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  await page.waitForTimeout(1000);
  await stubReset(request); // 화면 열기·연결 상태 확인 요청이 기록을 오염시키지 않도록 실행 직전에 비운다
  const out = await runPreview(page);
  const body = out.body;
  rec.request = out.postData;
  rec.responseKeys = Object.keys(body ?? {}).sort();
  rec.responseDryRun = { value: body?.dryRun, type: typeof body?.dryRun };
  expect(out.status).toBe(200);
  expect(out.postData.dryRun, '요청 dryRun').toBe(true);
  expect(out.postData.sourceTenantId).toBe('DEV');
  expect(out.postData.targetTenantId).toBe('PRD');
  expect(out.postData.packageId).toBe('PkgTransportDemo');
  expect(body.dryRun, '응답 dryRun 불리언 true').toBe(true);
  expect(Object.keys(body)).toEqual(expect.arrayContaining(PUBLIC_KEYS));
  rec.extraResponseKeys_INFO = Object.keys(body).filter((k) => !PUBLIC_KEYS.includes(k));
  rec.badge = await resultBadge(page);
  expect(rec.badge, '결과 화면 머리 배지').toBe('미리보기');
  rec.resultText = (await resultRegion(page).first().innerText()).replace(/\s+/g, ' ').slice(0, 400);
  const order = body.results.find((r: any) => r.artifactId === 'IF_Order_Sync');
  rec.orderSyncReplacementSum = (order?.replacements ?? []).reduce((a: number, x: any) => a + (x.count ?? 0), 0);
  rec.requestCounts = { dev: await stubCount(request, 18081), prd: await stubCount(request, 18082) };
  rec.prdRequests = (await call(request, 'POST', `${STUB[18082]}/__admin/requests/find`, { method: 'ANY', urlPathPattern: '.*' })).json.requests.map((q: any) => `${q.method} ${q.url}`);
  expect(rec.requestCounts.prd, '대상(18082) 요청 0건').toBe(0);
  const hist = await historyOf(request);
  const row = hist.find((h: any) => h.transportId === body.transportId);
  rec.history = { count: hist.length, rowKeys: Object.keys(row ?? {}).sort(), rowDryRun: row?.dryRun };
  expect(hist.length, '이력 건수 h0+1').toBe(h0 + 1);
  expect(row?.dryRun, '이력 항목 dryRun true').toBe(true);
  const lines = fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean);
  const mine = lines.find((l) => l.includes(body.transportId)) ?? '';
  const parsed = mine ? JSON.parse(mine) : {};
  rec.historyFileLine = { dryRun: parsed.dryRun, dryRunType: typeof parsed.dryRun, newTermCount: (mine.match(/미리보기/g) ?? []).length, keys: Object.keys(parsed).sort() };
  expect(parsed.dryRun, '이력 파일의 dryRun 불리언 true').toBe(true);
  expect(rec.historyFileLine.newTermCount, '이력 파일 줄에 화면 명칭 없음').toBe(0);
  expect((JSON.stringify(body).match(/미리보기/g) ?? []).length, '응답 JSON 에 미리보기 새로 생기지 않음').toBe(0);
  expect((JSON.stringify(row).match(/미리보기/g) ?? []).length, '이력 API 행에 미리보기 없음').toBe(0);
  await scan(page, rec, '이관-미리보기결과', w);
  await shot(page, 'QA-216-preview-result');
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-217
test('QA-217: 미리보기 ↔ 실제 이관 오가기 3회 - 버튼 문구, 배포 스위치, 결과 배지', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-217');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  const n = (await historyOf(request)).length;
  rec.historyBefore = n;
  rec.rounds = [];
  const made: string[] = [];
  const ensurePkg = async (r: any) => {
    const pkgChecked = await page.getByRole('list', { name: '패키지 목록' }).getByRole('radio').evaluateAll((es) => es.filter((e: any) => e.checked).length);
    if (pkgChecked === 0) {
      r.packageSelectionLostOnModeSwitch_INFO = true;
      await choosePackage(page, 'PkgTransportDemo');
    }
  };
  for (let i = 1; i <= 3; i++) {
    const r: any = { i };
    // 상태 A
    const mA = await modeInfo(page);
    r.A = { checked: mA.items.filter((x) => x.checked).map((x) => x.title), buttons: mA.buttons, deployControls: mA.deployControls };
    expect.soft(r.A.checked, `i=${i} A: 선택 항목 미리보기`).toEqual(['미리보기']);
    expect.soft(mA.buttons, `i=${i} A: 실행 버튼 이름`).toEqual(['미리보기 실행']);
    expect.soft(mA.deployControls, `i=${i} A: 배포 컨트롤 없음`).toEqual([]);
    await scan(page, rec, `오가기-${i}-A`, w);
    if (i !== 2) {
      await ensurePkg(r);
      await stubReset(request);
      const out = await runPreview(page);
      r.A.run = { status: out.status, requestDryRun: out.postData?.dryRun, requestDeploy: out.postData?.deploy, badge: await resultBadge(page), prdRequestsDelta: await stubCount(request, 18082), transportId: out.body?.transportId };
      made.push(out.body?.transportId);
      expect.soft(out.postData?.dryRun, `i=${i} A: dryRun true`).toBe(true);
      expect.soft(r.A.run.badge, `i=${i} A: 결과 배지`).toBe('미리보기');
      expect.soft(r.A.run.prdRequestsDelta, `i=${i} A: 대상 요청 변화 0`).toBe(0);
    }
    // 상태 B
    await modeRadio(page, '실제 이관').check();
    const mB = await modeInfo(page);
    r.B = { checked: mB.items.filter((x) => x.checked).map((x) => x.title), buttons_INFO: mB.buttons, deployControls: mB.deployControls, staleBadgeBeforeRun_INFO: (await resultRegion(page).count()) > 0 ? await resultBadge(page) : null };
    expect.soft(r.B.checked, `i=${i} B: 선택 항목 실제 이관`).toEqual(['실제 이관']);
    expect.soft(mB.deployControls.length, `i=${i} B: 배포 스위치가 나타남`).toBeGreaterThan(0);
    expect.soft(mB.buttons.includes('미리보기 실행'), `i=${i} B: 실행 버튼이 미리보기 실행이 아님`).toBe(false);
    await scan(page, rec, `오가기-${i}-B`, w);
    if (i === 2) {
      await ensurePkg(r);
      // 배포 스위치를 한 번 켰다 끄고 끈 채로 실행
      const sw = page.getByRole('switch', { name: /배포/ }).first();
      await sw.click();
      r.B.switchAfterOn = await sw.getAttribute('aria-checked');
      await sw.click();
      r.B.switchAfterOff = await sw.getAttribute('aria-checked');
      await stubReset(request);
      await realBtn(page, 'PRD').click();
      const out = await confirmDialogRun(page);
      r.B.run = { status: out.status, requestDryRun: out.postData?.dryRun, requestDeploy: out.postData?.deploy, badge: await resultBadge(page), prdRequests: await stubCount(request, 18082), transportId: out.body?.transportId };
      made.push(out.body?.transportId);
      expect.soft(out.postData?.dryRun, 'i=2 B: dryRun false').toBe(false);
      expect.soft(r.B.run.badge, 'i=2 B: 결과 배지 = 실제 이관 (미리보기 아님)').toBe('실제 이관');
      expect.soft(r.B.run.prdRequests, 'i=2 B: 대상에 요청 1건 이상').toBeGreaterThanOrEqual(1);
    }
    // 상태 C
    await modeRadio(page, '미리보기').check();
    const mC = await modeInfo(page);
    r.C = { checked: mC.items.filter((x) => x.checked).map((x) => x.title), buttons: mC.buttons, deployControls: mC.deployControls };
    expect.soft(r.C.checked, `i=${i} C: 선택 항목 미리보기`).toEqual(['미리보기']);
    expect.soft(mC.buttons, `i=${i} C: 실행 버튼`).toEqual(['미리보기 실행']);
    expect.soft(mC.deployControls, `i=${i} C: 배포 컨트롤 없음`).toEqual([]);
    await scan(page, rec, `오가기-${i}-C`, w);
    await shot(page, `QA-217-round${i}`);
    rec.rounds.push(r);
  }
  const hist = await historyOf(request);
  rec.historyAfter = hist.length;
  const mine = made.map((id) => hist.find((h: any) => h.transportId === id));
  rec.madeRows = mine.map((h: any) => ({ id: h?.transportId, dryRun: h?.dryRun, startedAt: h?.startedAt }));
  expect.soft(hist.length, '이력 행 수 n+3').toBe(n + 3);
  expect.soft(mine.map((h: any) => h?.dryRun), '만든 행의 dryRun 순서 true,false,true').toEqual([true, false, true]);
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-218
test('QA-218: 이력 목록과 상세의 모드 배지', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-218');
  const w = watch(page);
  const hist = await historyOf(request);
  const P = hist.filter((h: any) => h.dryRun === true).length;
  const Rn = hist.filter((h: any) => h.dryRun === false).length;
  rec.api = { rows: hist.length, preview: P, real: Rn };
  expect(P).toBeGreaterThan(0);
  expect(Rn).toBeGreaterThan(0);
  await gotoFresh(page, '/#/transport');
  await openTab(page, '이력');
  const read = async (label: string) => {
    const t = await historyTable(page);
    const iMode = t.headers.indexOf('모드');
    const iId = t.headers.indexOf('이관 ID');
    const rows = t.rows.map((r) => ({ id: r[iId], mode: r[iMode] }));
    const table = hist.map((h: any) => ({ id: h.transportId, apiDryRun: h.dryRun, expected: modeOfRow(h.dryRun), badge: rows.find((x) => x.id === h.transportId)?.mode }));
    rec[label] = { tableRows: rows.length, previewBadges: rows.filter((r) => r.mode === '미리보기').length, realBadges: rows.filter((r) => r.mode === '실제 이관').length, pairs: table };
    expect.soft(rows.filter((r) => r.mode === '미리보기').length, `${label}: 미리보기 배지 수 = P`).toBe(P);
    expect.soft(rows.filter((r) => r.mode === '실제 이관').length, `${label}: 실제 이관 배지 수 = R`).toBe(Rn);
    for (const p of table) expect.soft(p.badge, `${label}: ${p.id} 배지`).toBe(p.expected);
  };
  await read('list');
  await shot(page, 'QA-218-list');
  await scan(page, rec, '이력-목록', w);
  const prevId = hist.find((h: any) => h.dryRun === true).transportId;
  const realId = hist.find((h: any) => h.dryRun === false).transportId;
  rec.detail = [];
  const openDetail = async (id: string, want: string, shotName?: string) => {
    await page.getByRole('button', { name: id, exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    const b = await resultBadge(page);
    rec.detail.push({ id, want, badge: b });
    expect.soft(b, `상세 ${id} 머리 배지`).toBe(want);
    if (shotName) await shot(page, shotName);
    return b;
  };
  await openDetail(prevId, '미리보기', 'QA-218-detail-preview');
  await scan(page, rec, '이력-상세-미리보기', w);
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await openDetail(realId, '실제 이관', 'QA-218-detail-real');
  await scan(page, rec, '이력-상세-실제', w);
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await openDetail(prevId, '미리보기'); // 번갈아 열어도 잔상 없음
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await page.reload();
  await openTab(page, '이력');
  await read('listAfterReload');
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-219
test('QA-219: 이 변경 전에 저장된 이력 항목의 표시 (응답 대체)', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-219');
  const w = watch(page);
  const real = await historyOf(request);
  const base = real.find((h: any) => h.dryRun === true && h.sourceTenant && h.targetTenant);
  const realRow = real.find((h: any) => h.dryRun === false);
  expect(base).toBeTruthy();
  const clone = (o: any) => JSON.parse(JSON.stringify(o));
  const id = (n: number) => `qa21900${n}-0000-4000-8000-00000000000${n}`;
  const mk = (n: number, mod?: (x: any) => void) => {
    const x = clone(base);
    x.transportId = id(n);
    x.startedAt = `2026-10-2${n}T01:00:00Z`;
    mod?.(x);
    return x;
  };
  const H = {
    H1: mk(1),
    H2: mk(2, (x) => {
      delete x.sourceTenant;
      delete x.targetTenant;
    }),
    H3: mk(3, (x) => {
      x.deploy = true;
    }),
    H4: realRow ? clone(realRow) : mk(4, (x) => (x.dryRun = false)),
    H5: mk(5, (x) => {
      x.results[0].status = 'FAILED';
      x.results[0].error = { code: 'DOWNLOAD_FAILED', message: 'qa 오류 메시지' };
      x.summary = { total: x.summary.total, succeeded: Math.max(0, x.summary.succeeded - 1), failed: 1 };
    }),
    H6: mk(6, (x) => {
      delete x.dryRun;
    }),
  } as Record<string, any>;
  const body = JSON.stringify(Object.values(H));
  rec.replacement = { url: 'GET http://localhost:8080/transport/history (page.route **/transport/history, fulfill)', rows: Object.entries(H).map(([k, v]) => ({ k, id: v.transportId, dryRun: v.dryRun ?? '(필드 없음)', deploy: v.deploy, hasTenants: !!(v.sourceTenant && v.targetTenant), firstResult: v.results?.[0]?.status })), note: '실제 앱이 방금 저장한 행(GET /transport/history)을 바탕으로 만든 대체 응답. 이 변경 전 이력 파일을 앱에 들일 수단이 없다(Q-14).' };
  await page.route('**/transport/history', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 200, contentType: 'application/json', body });
    else await route.continue();
  });
  await gotoFresh(page, '/#/transport');
  await openTab(page, '이력');
  const t = await historyTable(page);
  const idx = { src: t.headers.indexOf('원본'), tgt: t.headers.indexOf('대상'), mode: t.headers.indexOf('모드'), dep: t.headers.indexOf('배포'), res: t.headers.indexOf('결과'), id: t.headers.indexOf('이관 ID') };
  rec.listRows = {};
  for (const [k, v] of Object.entries(H)) {
    const row = t.rows.find((r) => r[idx.id] === v.transportId);
    rec.listRows[k] = row ? { mode: row[idx.mode], source: row[idx.src], target: row[idx.tgt], deploy: row[idx.dep], result: row[idx.res] } : null;
  }
  await shot(page, 'QA-219-replaced-list');
  await scan(page, rec, '이력-대체-목록', w);
  const want: Record<string, string> = { H1: '미리보기', H2: '미리보기', H3: '미리보기', H4: '실제 이관', H5: '미리보기' };
  for (const [k, m] of Object.entries(want)) expect.soft(rec.listRows[k]?.mode, `${k} 목록 배지`).toBe(m);
  expect.soft(rec.listRows.H2?.source, 'H2 원본 셀 (이전 형식)').toBe('-');
  expect.soft(rec.listRows.H2?.target, 'H2 대상 셀 (이전 형식)').toBe('-');
  rec.detail = {};
  for (const [k, v] of Object.entries(H)) {
    await page.getByRole('button', { name: v.transportId, exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    rec.detail[k] = { badge: await resultBadge(page), text: (await resultRegion(page).first().innerText()).replace(/\s+/g, ' ').slice(0, 220) };
    if (want[k]) expect.soft(rec.detail[k].badge, `${k} 상세 머리 배지`).toBe(want[k]);
    await scan(page, rec, `이력-대체-상세-${k}`, w);
    if (k === 'H5') await shot(page, 'QA-219-detail-H5');
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
  }
  // 5. 대체 해제 뒤 실제 응답
  await page.unroute('**/transport/history');
  await page.reload();
  await openTab(page, '이력');
  const t2 = await historyTable(page);
  const api = await historyOf(request);
  const iMode2 = t2.headers.indexOf('모드');
  const iId2 = t2.headers.indexOf('이관 ID');
  rec.afterUnroute = api.map((h: any) => ({ id: h.transportId, expected: modeOfRow(h.dryRun), badge: t2.rows.find((r) => r[iId2] === h.transportId)?.[iMode2] }));
  for (const p of rec.afterUnroute) expect.soft(p.badge, `실제 응답 ${p.id} 모드 열`).toBe(p.expected);
  // 6. 이력 파일 줄의 키 집합
  const lines = fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean);
  const fileKeys = Object.keys(JSON.parse(lines[lines.length - 1])).sort();
  rec.keySets = { h1: Object.keys(H.H1).sort(), fileLine: fileKeys };
  expect.soft(fileKeys, '이력 파일 줄 키 집합이 H1 과 같음').toEqual(Object.keys(H.H1).sort());
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-220
test('QA-220: 모든 탭 전수 스캔, 번들 정적 스캔, 새로고침 반복', async ({ page, request }) => {
  test.setTimeout(900000);
  const rec = R('QA-220');
  const w = watch(page);
  await registerTenant(request, 'QA319-T1', key(18082, 'localhost'), true);
  rec.registered = 'QA319-T1';
  rec.sweeps = [];
  await stubReset(request);
  // 1. 이관 탭
  await openTransport(page);
  await scan(page, rec, '이관-미리보기-패키지없음', w);
  await choosePackage(page, 'PkgTransportDemo');
  await scan(page, rec, '이관-미리보기-패키지선택-아티팩트표시', w);
  rec.sweeps.push(await hoverFocusSweep(page, '이관-미리보기'));
  await modeRadio(page, '실제 이관').check();
  await scan(page, rec, '이관-실제이관', w);
  rec.sweeps.push(await hoverFocusSweep(page, '이관-실제이관'));
  await modeRadio(page, '미리보기').check();
  await runPreview(page);
  await scan(page, rec, '이관-미리보기결과', w);
  rec.sweeps.push(await hoverFocusSweep(page, '이관-미리보기결과'));
  await modeRadio(page, '실제 이관').check();
  await realBtn(page, 'PRD').click();
  await confirmDialogRun(page);
  await expect(resultRegion(page).first()).toBeVisible();
  await scan(page, rec, '이관-실제이관결과', w);
  await shot(page, 'QA-220-transport');
  // 2. 이력 탭
  await openTab(page, '이력');
  const t = await historyTable(page);
  const iMode = t.headers.indexOf('모드');
  const iId = t.headers.indexOf('이관 ID');
  await scan(page, rec, '이력-목록', w);
  rec.sweeps.push(await hoverFocusSweep(page, '이력-목록'));
  for (const [mode, name] of [['미리보기', '이력-상세-미리보기'], ['실제 이관', '이력-상세-실제']] as const) {
    const r = t.rows.find((x) => x[iMode] === mode);
    if (!r) continue;
    await page.getByRole('button', { name: r[iId], exact: true }).click();
    await expect(resultRegion(page).first()).toBeVisible();
    await scan(page, rec, name, w);
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
  }
  await shot(page, 'QA-220-history');
  // 3. 테넌트 탭
  await openTab(page, '테넌트');
  await scan(page, rec, '테넌트-목록과-등록폼', w);
  rec.sweeps.push(await hoverFocusSweep(page, '테넌트-목록'));
  const row = page.getByRole('row').filter({ hasText: 'QA319-T1' });
  await row.getByRole('button', { name: '수정' }).click();
  await scan(page, rec, '테넌트-수정폼', w);
  const cancelEdit = page.getByRole('button', { name: '취소', exact: true });
  if (await cancelEdit.count()) await cancelEdit.first().click();
  await row.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page, rec, '테넌트-삭제확인대화상자', w);
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await shot(page, 'QA-220-tenants');
  // 4. 상단 영역(연결 상태 칩과 안내)
  const chips = page.locator('header').getByRole('button');
  const nChips = await chips.count();
  rec.headerChips = nChips;
  for (let i = 0; i < nChips; i++) {
    await chips.nth(i).hover();
    await page.waitForTimeout(250);
    await scan(page, rec, `상단-칩${i}-호버`, w);
    await chips.nth(i).focus();
    await page.waitForTimeout(150);
    await scan(page, rec, `상단-칩${i}-포커스`, w);
  }
  rec.sweeps.push(await hoverFocusSweep(page, '상단-탭과칩'));
  for (const s of rec.sweeps) expect.soft(s.hits, `호버·포커스 스윕 ${s.state}: 옛 명칭 0건 (${s.visited}개 방문)`).toBe(0);
  // 6. 정적 번들 스캔 (H-10)
  rec.bundle = await bundleScan(request);
  expect.soft(rec.bundle.total, `H-10 번들 정적 스캔: 옛 명칭 0건 (${rec.bundle.assets.length}개 파일)`).toBe(0);
  // 7. 새로고침 반복 3회: 각 탭의 초기 로딩 직후와 안정된 뒤
  for (let i = 1; i <= 3; i++) {
    for (const tab of ['이관', '이력', '테넌트'] as const) {
      await gotoFresh(page, '/#/transport', { waitUntil: 'commit' });
      await scan(page, rec, `새로고침${i}-${tab}-로딩직후`, w);
      await page.waitForLoadState('load');
      await expect(tabBtn(page, tab)).toBeVisible();
      await openTab(page, tab);
      await page.waitForTimeout(700);
      await scan(page, rec, `새로고침${i}-${tab}-안정`, w);
    }
  }
  await shot(page, 'QA-220-final');
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-221
test('QA-221: 확인 대화상자 - 열기·닫기 반복과 문구', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-221');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  await modeRadio(page, '실제 이관').check();
  const n = (await historyOf(request)).length;
  rec.historyBefore = n;
  const postCount = () => w.reqs.filter((r) => r.method === 'POST' && r.url === 'http://localhost:8080/transport').length;
  const dlg = page.getByRole('dialog');
  const open = async () => {
    await realBtn(page, 'PRD').click();
    await expect(dlg).toBeVisible();
  };
  const readDlg = async () => ({
    name: await dlg.evaluate((d: any) => (document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.getAttribute('aria-label') || '').trim()),
    text: (await dlg.innerText()).replace(/\s+/g, ' ').trim(),
    buttons: (await dlg.getByRole('button').allInnerTexts()).map((s) => s.trim()),
  });
  await open();
  const first = await readDlg();
  rec.first = first;
  expect.soft(first.text, '대상 테넌트 이름 PRD 가 보임').toContain('PRD');
  await scan(page, rec, '확인대화상자-기본', w);
  await shot(page, 'QA-221-dialog-1');
  const texts: string[] = [first.text];
  // 2. Escape 로 닫기
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect.soft(postCount(), 'Escape 뒤 POST /transport 0건').toBe(0);
  // 3~4. 취소 / Escape 번갈아 총 5회
  const closing: string[] = ['Escape'];
  for (let i = 2; i <= 5; i++) {
    await open();
    const cur = await readDlg();
    texts.push(cur.text);
    if (i % 2 === 0) {
      await dlg.getByRole('button', { name: '취소', exact: true }).click();
      closing.push('취소');
    } else {
      await page.keyboard.press('Escape');
      closing.push('Escape');
    }
    await expect(dlg).toHaveCount(0);
    expect.soft(postCount(), `${i}회 닫은 뒤 POST /transport 0건`).toBe(0);
  }
  rec.repeat = { closing, texts, allSame: texts.every((x) => x === texts[0]) };
  expect.soft(rec.repeat.allSame, '5회 반복에서 문구가 같다').toBe(true);
  // 5. 배포 스위치를 켠 상태
  const sw = page.getByRole('switch', { name: /배포/ }).first();
  await sw.click();
  await open();
  const dep = await readDlg();
  rec.deployOn = dep;
  rec.deployOnChanged_INFO = dep.text !== first.text;
  await scan(page, rec, '확인대화상자-배포', w);
  await shot(page, 'QA-221-dialog-deploy');
  await dlg.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dlg).toHaveCount(0);
  expect.soft(postCount(), '배포 켠 상태에서 취소 뒤 POST 0건').toBe(0);
  // 6. 스위치를 끄고 승인
  await sw.click();
  await open();
  const out = await confirmDialogRun(page);
  rec.approve = { status: out.status, dryRun: out.postData?.dryRun, deploy: out.postData?.deploy, badge: await resultBadge(page), postCount: postCount() };
  expect.soft(rec.approve.postCount, '승인하면 POST /transport 정확히 1건').toBe(1);
  expect.soft(out.postData?.dryRun).toBe(false);
  expect.soft(rec.approve.badge).toBe('실제 이관');
  // 7. 테넌트 삭제 확인 대화상자(열고 취소)
  await openTab(page, '테넌트');
  const row = page.getByRole('row').filter({ hasText: 'QA319-T1' });
  await row.getByRole('button', { name: '삭제' }).click();
  await expect(dlg).toBeVisible();
  rec.deleteDialog = await readDlg();
  await scan(page, rec, '삭제확인', w);
  await shot(page, 'QA-221-dialog-delete');
  await dlg.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dlg).toHaveCount(0);
  rec.tenantStillThere = !!(await findTenant(request, 'QA319-T1'));
  expect.soft(rec.tenantStillThere, '삭제는 하지 않았다').toBe(true);
  finish(rec, w);
});

// ------------------------------------------------------------------------------------------ QA-222
test('QA-222: 오류·안내 상태 전수', async ({ page, request }) => {
  test.setTimeout(900000);
  const rec = R('QA-222');
  const w = watch(page);
  const maps0 = { dev: await mappingCount(request, 18081), prd: await mappingCount(request, 18082) };
  rec.mappingsBefore = maps0;
  rec.replaced = [];
  await stubReset(request);
  const alerts = async () => (await page.getByRole('alert').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  const guide = async (state: string, opts: { retry?: boolean; expectAlert?: boolean } = {}) => {
    await page.waitForTimeout(700);
    const a = await alerts();
    const retry = await page.getByRole('button', { name: '다시 시도' }).count();
    (rec.states ??= []).push({ state, alerts: a, retryButtons: retry });
    if (opts.expectAlert !== false) {
      expect.soft(a.length, `${state}: 오류 안내(alert)가 보임`).toBeGreaterThan(0);
      expect.soft(a.every((x) => x.length > 0), `${state}: 안내가 비어 있지 않음`).toBe(true);
    }
    if (opts.retry) expect.soft(retry, `${state}: 다시 시도 버튼`).toBeGreaterThan(0);
    await scan(page, rec, `오류-${state}`, w);
  };
  const isPkgList = (u: URL) => u.pathname === '/packages';
  const isArtifacts = (u: URL) => /^\/packages\/[^/]+\/artifacts$/.test(u.pathname);
  const isTransport = (u: URL) => u.pathname === '/transport';
  const isHistory = (u: URL) => u.pathname === '/transport/history';
  const isTenants = (u: URL) => u.pathname === '/tenants';
  type Mode = { abort: true } | { status: number; contentType: string; body: string };
  const replaceWith = async (pred: (u: URL) => boolean, method: string, mode: Mode, label: string) => {
    const h = async (route: any) => {
      if (route.request().method() !== method) return route.continue();
      if ('abort' in mode) return route.abort('connectionrefused');
      return route.fulfill({ status: mode.status, contentType: mode.contentType, body: mode.body });
    };
    await page.route(pred, h);
    rec.replaced.push(label);
    return async () => page.unroute(pred, h);
  };
  const JSON500: Mode = { status: 500, contentType: 'application/json', body: '{"error":"INTERNAL","message":"boom"}' };
  const HTML500: Mode = { status: 500, contentType: 'text/html', body: '<html><body>err</body></html>' };
  const ABORT: Mode = { abort: true };

  // 1. 패키지 목록 읽기 실패
  for (const [nm, mode] of [['abort', ABORT], ['500json', JSON500], ['500html', HTML500]] as const) {
    const off = await replaceWith(isPkgList, 'GET', mode, `GET /packages -> ${nm}`);
    await gotoFresh(page, '/#/transport');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await guide(`패키지목록-${nm}`, { retry: true });
    await off();
  }
  // 2. 아티팩트 목록 읽기 실패
  for (const [nm, mode] of [['abort', ABORT], ['500json', JSON500], ['500html', HTML500]] as const) {
    const off = await replaceWith(isArtifacts, 'GET', mode, `GET /packages/*/artifacts -> ${nm}`);
    await gotoFresh(page, '/#/transport');
    await page.getByRole('list', { name: '패키지 목록' }).getByRole('radio').first().check();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await guide(`아티팩트목록-${nm}`);
    await off();
  }
  // 3. 요청 단위 오류의 실제 문구 수집 (API)
  const base = { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' };
  const real: Record<string, { status: number; body: string }> = {};
  const calls: Array<[string, () => Promise<any>]> = [
    ['가-원본=대상', () => app(request, 'POST', '/transport', { ...base, targetTenantId: 'DEV' })],
    ['나-규칙밖ID', () => app(request, 'POST', '/transport', { ...base, packageId: 'a b' })],
    ['다-모르는테넌트', () => app(request, 'POST', '/transport', { ...base, targetTenantId: 'unknown-tenant' })],
    ['라-tenantId없음', () => app(request, 'GET', '/packages')],
  ];
  rec.apiMessages = [];
  for (const [nm, fn] of calls) {
    const r = await fn();
    real[nm] = { status: r.status, body: r.text };
    const msg = String(r.json?.message ?? '');
    const hasOld = [msg.normalize('NFC'), msg.normalize('NFKC')].some((m) => m.replace(/[​-‍⁠﻿­]/g, '').includes(OLD_TERM));
    rec.apiMessages.push({ case: nm, status: r.status, error: r.json?.error, message: msg, oldTermInMessage: hasOld });
    expect.soft(hasOld, `3 ${nm}: 서버 응답 message 에 옛 명칭 없음 (있으면 AC-2·AC-3 충돌 NEEDS_DECISION, Q-17)`).toBe(false);
  }
  // 4. 그 실제 응답을 화면에 재현 (미리보기·실제 이관 둘 다)
  const runUi = async (mode: '미리보기' | '실제 이관') => {
    if (mode === '미리보기') await previewBtn(page).click();
    else {
      await realBtn(page, 'PRD').click();
      await page.getByRole('dialog').getByRole('button', { name: '실행', exact: true }).click();
    }
  };
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  for (const mode of ['미리보기', '실제 이관'] as const) {
    await modeRadio(page, mode).check();
    const cases: Array<[string, Mode]> = [
      ['가', { status: real['가-원본=대상'].status, contentType: 'application/json', body: real['가-원본=대상'].body }],
      ['나', { status: real['나-규칙밖ID'].status, contentType: 'application/json', body: real['나-규칙밖ID'].body }],
      ['다', { status: real['다-모르는테넌트'].status, contentType: 'application/json', body: real['다-모르는테넌트'].body }],
      ['abort', ABORT],
      ['500html', HTML500],
      ['빈본문200', { status: 200, contentType: 'application/json', body: '' }],
    ];
    for (const [nm, m] of cases) {
      const off = await replaceWith(isTransport, 'POST', m, `POST /transport -> ${mode}/${nm}`);
      await runUi(mode);
      await expect(page.getByRole('alert').first()).toBeVisible();
      await guide(`실행-${mode}-${nm}`);
      await off();
      if ((await page.getByRole('dialog').count()) > 0) await page.keyboard.press('Escape');
    }
  }
  // 5. 결과 오류 카드 (실제 백엔드)
  const idPut = await addMap(request, 18082, {
    priority: 1,
    request: { method: 'PUT', urlPath: "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')" },
    response: { status: 400, body: 'bad', headers: { 'Content-Type': 'text/plain' } },
  });
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  await modeRadio(page, '실제 이관').check();
  await realBtn(page, 'PRD').click();
  const outPut = await confirmDialogRun(page);
  rec.resultCard_update400 = { status: outPut.status, results: (outPut.body?.results ?? []).map((r: any) => `${r.artifactId}:${r.status}:${r.error?.code ?? ''}:${r.error?.message ?? ''}`) };
  await expect(resultRegion(page).first()).toBeVisible();
  expect.soft(await resultRegion(page).first().innerText(), '갱신 400: 결과 카드에 오류 코드 UPLOAD_FAILED').toContain('UPLOAD_FAILED');
  await guide('결과카드-갱신400', { expectAlert: false });
  const expandAll = page.getByRole('button', { name: '모두 펼치기', exact: true });
  if (await expandAll.count()) await expandAll.click();
  await guide('결과카드-갱신400-펼침', { expectAlert: false });
  await shot(page, 'QA-222-result-card-update400');
  await delMap(request, 18082, idPut);
  const idGet = await addMap(request, 18081, {
    priority: 1,
    request: { method: 'GET', urlPath: "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')/$value" },
    response: { status: 500, body: 'download fail', headers: { 'Content-Type': 'text/plain' } },
  });
  await modeRadio(page, '미리보기').check();
  const outGet = await waitTransport(page, async () => {
    await previewBtn(page).click();
  });
  rec.resultCard_download500 = { status: outGet.status, results: (outGet.body?.results ?? []).map((r: any) => `${r.artifactId}:${r.status}:${r.error?.code ?? ''}:${r.error?.message ?? ''}`) };
  await page.waitForTimeout(500);
  expect.soft(await resultRegion(page).first().innerText(), '다운로드 500: 결과 카드에 오류 코드 DOWNLOAD_FAILED').toContain('DOWNLOAD_FAILED');
  await guide('결과카드-다운로드500', { expectAlert: false });
  if (await expandAll.count()) await expandAll.click();
  await guide('결과카드-다운로드500-펼침', { expectAlert: false });
  await shot(page, 'QA-222-result-card-download500');
  await delMap(request, 18081, idGet);
  // 6. 이력
  for (const [nm, mode] of [['500', JSON500], ['abort', ABORT], ['빈배열', { status: 200, contentType: 'application/json', body: '[]' } as Mode]] as const) {
    const off = await replaceWith(isHistory, 'GET', mode, `GET /transport/history -> ${nm}`);
    await gotoFresh(page, '/#/transport');
    await openTab(page, '이력');
    await page.waitForTimeout(800);
    if (nm === '빈배열') {
      const txt = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      (rec.states ??= []).push({ state: '이력-빈배열', mainText: txt.slice(0, 200) });
      expect.soft(txt, '이력 빈 상태 안내').toContain('이관 이력이 없습니다');
      await scan(page, rec, '오류-이력-빈배열', w);
    } else await guide(`이력-${nm}`, { retry: nm === '500' });
    await off();
  }
  // 7. 테넌트
  const offT = await replaceWith(isTenants, 'GET', ABORT, 'GET /tenants -> abort');
  await gotoFresh(page, '/#/transport');
  await openTab(page, '테넌트');
  await guide('테넌트-목록abort', { retry: true });
  await offT();
  await gotoFresh(page, '/#/transport');
  await openTab(page, '테넌트');
  // S2(REQ-412): 등록 폼은 "테넌트 등록" 버튼으로 여는 서랍이다.
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
  const g = page.getByRole('dialog', { name: '테넌트 등록' });
  const tryReg = async (nm: string, name: string, text: string) => {
    await g.getByRole('textbox', { name: '이름' }).fill(name);
    await g.getByRole('textbox', { name: '서비스 키 붙여넣기' }).fill(text);
    const rp = page.waitForResponse((r) => r.url() === 'http://localhost:8080/tenants' && r.request().method() === 'POST').catch(() => undefined);
    await g.getByRole('button', { name: '등록', exact: true }).click();
    const rr = await rp;
    (rec.registerAttempts ??= []).push({ nm, status: rr?.status() });
    await guide(`테넌트-등록실패-${nm}`);
  };
  await tryReg('이름중복409', 'DEV', JSON.stringify(key(18082, 'localhost')));
  await tryReg('키형식400', 'QA222-bad', '{"oauth":{}}');
  // 8. 연결 상태 칩
  const chipBtns = page.locator('header').getByRole('button');
  await gotoFresh(page, '/#/transport');
  await page.waitForTimeout(800);
  rec.chipTexts = (await chipBtns.allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await guide('칩-PRD기존오류', { expectAlert: false });
  const idTok = await addMap(request, 18081, { priority: 1, request: { method: 'POST', urlPath: '/oauth/token' }, response: { status: 401, body: '{"error":"invalid_client"}', headers: { 'Content-Type': 'application/json' } } });
  const devChip = chipBtns.filter({ hasText: 'DEV' }).first();
  await devChip.click();
  await page.waitForTimeout(1200);
  rec.chipAfterToken401 = (await chipBtns.allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await guide('칩-DEV토큰401', { expectAlert: false });
  await shot(page, 'QA-222-chip-token401');
  await delMap(request, 18081, idTok);
  await devChip.click();
  await page.waitForTimeout(1200);
  rec.chipAfterRestore = (await chipBtns.allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await guide('칩-복구후', { expectAlert: false });
  // 매핑 복귀 확인
  rec.mappingsAfter = { dev: await mappingCount(request, 18081), prd: await mappingCount(request, 18082) };
  expect.soft(rec.mappingsAfter, '임시 매핑 모두 삭제(GET /__admin/mappings 개수 복귀)').toEqual(maps0);
  finish(rec, w, { allowConsole: true });
  rec.consoleErrors_note = '오류 응답·abort 재현 중 앱이 남기는 console.error 는 예상한 것으로 기록만 한다(rec.consoleErrors)';
});

// ------------------------------------------------------------------------------------------ QA-223
test('QA-223: 사용자가 입력한 데이터는 치환되지 않는다', async ({ page, request }) => {
  test.setTimeout(300000);
  const rec = R('QA-223');
  const w = watch(page);
  const NAME = `QA319-${OLD_TERM}`;
  const c = (await tenantList(request)).length;
  rec.tenantCountBefore = c;
  rec.hadT1 = !!(await findTenant(request, 'QA319-T1'));
  await gotoFresh(page, '/#/transport');
  await openTab(page, '테넌트');
  // S2(REQ-412): 등록 폼은 "테넌트 등록" 버튼으로 여는 서랍이다.
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
  const g = page.getByRole('dialog', { name: '테넌트 등록' });
  await g.getByRole('textbox', { name: '이름' }).fill(NAME);
  await g.getByRole('textbox', { name: '서비스 키 붙여넣기' }).fill(JSON.stringify(key(18082, 'localhost')));
  const resp = page.waitForResponse((r) => r.url() === 'http://localhost:8080/tenants' && r.request().method() === 'POST');
  await g.getByRole('button', { name: '등록', exact: true }).click();
  expect((await resp).status()).toBe(201);
  const stored = await findTenant(request, NAME);
  rec.storedName = stored?.name;
  expect(stored?.name, '저장된 이름이 입력 그대로').toBe(NAME);
  // 등록 응답(201) 뒤에 앱이 GET /tenants로 목록을 다시 읽어 그린다. 응답 직후 바로 읽으면 이전 목록을 읽으므로 새 항목이 보일 때까지 기다린다.
  const mine = page.getByRole('row').filter({ hasText: NAME });
  await expect.soft(mine.first(), '테넌트 탭 목록에 입력한 이름 그대로').toBeVisible();
  const listText = await page.getByRole('row').filter({ hasText: 'QA319-' }).allInnerTexts();
  rec.tenantTabItems = listText.map((s) => s.replace(/\s+/g, ' '));
  expect.soft(rec.tenantTabItems.some((s: string) => s.includes(NAME)), '테넌트 탭 목록에 입력한 이름 그대로').toBe(true);
  await openTab(page, '이관');
  await expect(page.getByRole('list', { name: '패키지 목록' }).getByRole('radio').first()).toBeVisible();
  const targetRadio = grp(page, '대상').getByRole('radio', { name: NAME, exact: true });
  rec.targetRadioCount = await targetRadio.count();
  expect.soft(rec.targetRadioCount, '이관 탭 대상 그룹 레이블이 입력한 이름 그대로').toBe(1);
  await targetRadio.check();
  await choosePackage(page, 'PkgTransportDemo');
  const mi = await modeInfo(page);
  rec.descWithUserName = mi.items[0].desc;
  expect.soft(norm(mi.items[0].desc), '설명 문장이 대상 이름을 그대로 넣은 틀').toBe(descOf(NAME));
  const out = await runPreview(page);
  rec.run = { status: out.status, badge: await resultBadge(page), buttonCount: await previewBtn(page).count(), targetName: out.body?.targetTenant?.name };
  expect.soft(rec.run.badge).toBe('미리보기');
  expect.soft(rec.run.buttonCount).toBe(1);
  expect.soft(out.body?.targetTenant?.name, '응답 targetTenant.name').toBe(NAME);
  await openTab(page, '이력');
  const t = await historyTable(page);
  const iTgt = t.headers.indexOf('대상');
  const iMode = t.headers.indexOf('모드');
  const iId = t.headers.indexOf('이관 ID');
  const rowMine = t.rows.find((r) => r[iId] === out.body.transportId);
  rec.historyRow = { target: rowMine?.[iTgt], mode: rowMine?.[iMode] };
  expect.soft(rowMine?.[iTgt]).toBe(NAME);
  expect.soft(rowMine?.[iMode]).toBe('미리보기');
  const hist = await historyOf(request);
  const apiRow = hist.find((h: any) => h.transportId === out.body.transportId);
  rec.apiTargetName = apiRow?.targetTenant?.name;
  expect.soft(rec.apiTargetName, '이력 API targetTenant.name').toBe(NAME);
  await shot(page, 'QA-223-history');
  // 6. 입력한 이름을 가린 뒤 스캔 (가리기 전 개수는 INFO)
  await openTab(page, '이관');
  const s = await scan(page, rec, '이관-사용자이름-가린뒤', w, [NAME]);
  rec.scanBeforeMask_INFO = s.failBeforeMask;
  await shot(page, 'QA-223-transport');
  // 7. 정리
  for (const nm of [NAME, 'QA319-T1']) {
    const tn = await findTenant(request, nm);
    if (tn) rec[`delete_${nm}`] = (await dropTenant(request, tn.id)).status;
  }
  rec.tenantCountAfter = (await tenantList(request)).length;
  expect.soft(rec.tenantCountAfter, '건수가 시작 값으로 되돌아옴(QA319-T1 포함해 삭제)').toBe(c - (rec.hadT1 ? 1 : 0));
  finish(rec, w);
  void app;
  void addMap;
  void mappingCount;
  void waitTransport;
});
