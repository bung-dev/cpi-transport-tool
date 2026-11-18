// 묶음 s06 — REQ-317 이력 목록 1280px 열 표시 (QA-195~201). qa_cases.md "REQ-317" 절 그대로.
// 앱: --profile stub --read-only false. 이력 응답은 page.route 로 대체한다(QA-199 만 실제 백엔드 이력).
import { expect, test, type Page } from '@playwright/test';
import { after, app, historyOf, key, R, registerTenant, shot } from '../../lib/qa';
import { foreignHosts, historyTable, openTab, realFlow, resultRegion, setRoute, startManual, watch, registerViaUi } from '../../lib/ui';
import { fakeUuid, measureHistory, openHistory, plainRow, rMax, replaceHistory, SET_A, SET_B, SET_C, UUID_MAX, type StrSet } from '../../lib/r2';

test.use({ actionTimeout: 20000 });

test.afterEach(async ({ request }) => {
  await after(request);
});

const finish = (rec: any, w: ReturnType<typeof watch>) => {
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.nonLocalRequests = foreignHosts(w);
  expect(w.errors, 'pageerror 0건').toEqual([]);
  expect(w.consoleErrors, 'console.error 0건').toEqual([]);
  expect(foreignHosts(w), '밖 요청 0건').toEqual([]);
};
const judge1280 = (m: any, label: string) => {
  expect.soft(m.m1_scrollMinusClient, `${label}: ① scrollWidth - clientWidth = 0 (wrapper ${m.wrapper.tag}.${m.wrapper.cls} ${m.wrapper.scrollWidth}/${m.wrapper.clientWidth})`).toBe(0);
  expect.soft(m.m2_ok, `${label}: ② 마지막 열 셀 오른쪽 ${m.m2_lastCellRight} <= 카드 안쪽 오른쪽 ${m.card.innerRight}`).toBe(true);
  expect.soft(m.m3_allInside, `${label}: ③ 모든 열 머리가 래퍼 안 (${m.m3_headerCount}개, ${JSON.stringify(m.m3_headers.filter((h: any) => !h.inside))})`).toBe(true);
};
const asHeaderMap = (ht: { headers: string[]; rows: string[][] }, ri: number) => Object.fromEntries(ht.headers.map((h, i) => [h, ht.rows[ri]?.[i]]));

test('QA-195: spec 판정 데이터(세트 A) 1280px - 모든 열이 표 래퍼 안', async ({ page }) => {
  const rec = R('QA-195');
  const w = watch(page);
  rec.replaced = 'GET http://localhost:8080/transport/history -> R-MAX(세트 A) 1행';
  await replaceHistory(page, [rMax(SET_A)]);
  await openHistory(page);
  const m = await measureHistory(page, 0);
  const ht = await historyTable(page);
  rec.measure = m;
  rec.headers = ht.headers;
  rec.row = asHeaderMap(ht, 0);
  await shot(page, 'QA-195-1280');
  judge1280(m, 'QA-195');
  expect(ht.headers, '9개 열(S3 REQ-425 템플릿 열)').toEqual(['시작 시각', '템플릿', '원본', '대상', '패키지', '모드', '배포', '결과', '이관 ID']);
  const r = rec.row as Record<string, string>;
  expect(r['모드']).toBe('실제 이관');
  expect(r['배포'], '배포 열 "배포" 배지').toContain('배포');
  expect(r['배포'], '배포 열 "실패 2" 배지').toContain('실패 2');
  expect(r['결과'], '결과 열 "성공 0 / 전체 2"').toContain('성공 0 / 전체 2');
  expect(r['결과'], '결과 열 "실패 2" 배지').toContain('실패 2');
  finish(rec, w);
});

for (const [qa, set] of [['QA-196', SET_B], ['QA-196', SET_C]] as Array<[string, StrSet]>) {
  test(`${qa}: 최악 글리프 폭 ${set.name} 1280px`, async ({ page }) => {
    const rec = R(qa);
    const w = watch(page);
    await replaceHistory(page, [rMax(set)]);
    await openHistory(page);
    const m = await measureHistory(page, 0);
    const ht = await historyTable(page);
    (rec.sets ??= {})[set.name] = { replaced: `GET /transport/history -> R-MAX(${set.name}) 1행`, measure: m, row: asHeaderMap(ht, 0), lengths: { pkg: set.pkg.length, src: set.src.length, tgt: set.tgt.length } };
    await shot(page, `QA-196-${set.name.replace(' ', '')}`);
    judge1280(m, `${qa} ${set.name}`);
    finish(rec, w);
  });
}

test('QA-197: 줄여 보인 값의 전체 확인과 이관 ID 확인', async ({ page, context }) => {
  const rec = R('QA-197');
  const w = watch(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8080' }).catch(() => undefined);
  await replaceHistory(page, [rMax(SET_A)]);
  await openHistory(page);
  const cells = await page.evaluate(
    ({ pkg, src, tgt, id }) => {
      const tds = [...document.querySelectorAll('table tbody tr')[0].querySelectorAll('td')] as HTMLElement[];
      const info = (td: HTMLElement, full: string) => {
        const els = [td, ...(td.querySelectorAll('*') as unknown as HTMLElement[])];
        const truncated = els.filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => `${e.tagName}:${e.scrollWidth}>${e.clientWidth}`);
        const labels = els.flatMap((e) => [e.getAttribute('title'), e.getAttribute('aria-label')]).filter(Boolean) as string[];
        const textFull = (td.textContent || '').includes(full);
        const wrap = els.some((e) => getComputedStyle(e).whiteSpace.startsWith('normal')) && !truncated.length;
        return { text: (td.textContent || '').trim(), textHasFull: textFull, truncatedElements: truncated, titlesAndLabels: labels, someLabelEqualsFull: labels.includes(full), ellipsis: els.some((e) => getComputedStyle(e).textOverflow === 'ellipsis'), wraps: wrap };
      };
      return { pkg: info(tds[4], pkg), src: info(tds[2], src), tgt: info(tds[3], tgt), id: info(tds[8], id) };
    },
    { pkg: SET_A.pkg, src: SET_A.src, tgt: SET_A.tgt, id: UUID_MAX },
  );
  rec.cells = cells;
  for (const [nm, c] of Object.entries(cells) as Array<[string, any]>) {
    const truncated = c.truncatedElements.length > 0;
    if (truncated) expect.soft(c.someLabelEqualsFull, `${nm}: 줄어든 값은 title/aria-label 이 전체 값과 같음`).toBe(true);
    else expect.soft(c.textHasFull, `${nm}: 줄어들지 않았으면 DOM 텍스트에 전체 값`).toBe(true);
  }
  expect.soft(cells.id.textHasFull || cells.id.someLabelEqualsFull, '이관 ID 전체(36자)가 텍스트나 title/label 에 있음').toBe(true);
  // 이관 ID 버튼 클릭
  const idBtn = page.getByRole('button', { name: UUID_MAX, exact: true });
  rec.idButtonCount = await idBtn.count();
  expect(rec.idButtonCount, '이관 ID 셀의 버튼').toBe(1);
  const reqsBefore = w.reqs.length;
  await idBtn.click();
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${String(e).slice(0, 60)}`));
  rec.click = {
    clipboard: clip,
    detailOpened: await resultRegion(page).first().isVisible().catch(() => false),
    detailText: (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200),
    toasts: await page.getByRole('status').allInnerTexts(),
    newRequests: w.reqs.length - reqsBefore,
  };
  await shot(page, 'QA-197-after-click');
  expect(rec.click.detailOpened || String(clip).includes(UUID_MAX) || rec.click.toasts.length > 0, '클릭 효과(상세 열림·클립보드·토스트 중 하나)').toBe(true);
  finish(rec, w);
});

test('QA-198: 여러 행 혼합(미리보기, 이전 형식, 세로 스크롤)', async ({ page }) => {
  const rec = R('QA-198');
  const w = watch(page);
  const rows: any[] = [rMax(SET_A)];
  for (let i = 0; i < 3; i++) rows.push(plainRow(i, { dryRun: true, deploy: false, packageId: `PkgPreview${i}` }));
  for (let i = 0; i < 2; i++) {
    const r = plainRow(10 + i, { packageId: `PkgOld${i}` });
    delete r.sourceTenant;
    delete r.targetTenant;
    rows.push(r);
  }
  for (let i = 0; i < 8; i++) rows.push(plainRow(20 + i));
  expect(rows.length).toBe(14);
  rec.replaced = 'GET /transport/history -> 14행(R-MAX 1 + 미리보기 3 + 이전 형식 2 + 일반 8)';
  await replaceHistory(page, rows);
  await openHistory(page);
  const m1 = await measureHistory(page, 0);
  rec.top = m1;
  rec.verticalScrollExists = m1.verticalScroll;
  await shot(page, 'QA-198-top');
  judge1280(m1, 'QA-198 위쪽');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const m2 = await measureHistory(page, 0);
  rec.bottom = m2;
  await shot(page, 'QA-198-bottom');
  judge1280(m2, 'QA-198 아래로 스크롤 뒤');
  const ht = await historyTable(page);
  const iS = ht.headers.indexOf('원본');
  const iT = ht.headers.indexOf('대상');
  const iP = ht.headers.indexOf('패키지');
  const oldRows = ht.rows.filter((r) => /^PkgOld/.test(r[iP]));
  rec.oldFormatRows = oldRows.map((r) => ({ pkg: r[iP], src: r[iS], tgt: r[iT] }));
  expect(oldRows.length).toBe(2);
  for (const r of oldRows) {
    expect.soft(r[iS], '이전 형식 행 원본 "-"').toBe('-');
    expect.soft(r[iT], '이전 형식 행 대상 "-"').toBe('-');
  }
  finish(rec, w);
});

test('QA-199: 실제 백엔드 이력의 40자 테넌트 이름', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-199');
  const w = watch(page);
  const SRC = 'QA317-SRC-' + 'S'.repeat(30);
  const TGT = 'QA317-TGT-' + 'T'.repeat(30);
  expect(SRC.length).toBe(40);
  expect(TGT.length).toBe(40);
  const n0 = (await historyOf(request)).length;
  rec.n0 = n0;
  await page.goto('/');
  // 화면 테넌트 탭에서 등록
  for (const [name, k] of [[SRC, key(18081, '127.0.0.1')], [TGT, key(18082, 'localhost')]] as Array<[string, any]>) {
    await registerViaUi(page, name, k);
  }
  const tl = (await app(request, 'GET', '/tenants')).json.tenants.map((t: any) => t.name);
  rec.tenantNames = tl;
  try {
    await openTab(page, '이관');
    await startManual(page);
    await setRoute(page, SRC, TGT);
    await expect(page.getByRole('list', { name: '패키지 목록' }).getByRole('checkbox').first()).toBeVisible();
    // S3b(REQ-423): 미리보기 → "이 구성으로 실제 이관" → 확인창
    const { real: out } = await realFlow(page);
    rec.run = { http: out.status, summary: out.body?.summary, transportId: out.body?.transportId, request: out.postData };
    expect(out.status).toBe(200);
    await openTab(page, '이력');
    await page.waitForTimeout(500);
    const ht = await historyTable(page);
    const iId = ht.headers.indexOf('이관 ID');
    const rowIdx = ht.rows.findIndex((r) => r[iId] === out.body.transportId);
    rec.rowFound = rowIdx;
    expect(rowIdx, '새 행').toBeGreaterThanOrEqual(0);
    const m = await measureHistory(page, rowIdx);
    rec.measure = m;
    const iS = ht.headers.indexOf('원본');
    const iT = ht.headers.indexOf('대상');
    rec.cellLengths = { source: ht.rows[rowIdx][iS].length, target: ht.rows[rowIdx][iT].length };
    await shot(page, 'QA-199-history');
    judge1280(m, 'QA-199');
    expect(ht.rows[rowIdx][iS].length, '원본 셀 텍스트 길이 40').toBe(40);
    expect(ht.rows[rowIdx][iT].length, '대상 셀 텍스트 길이 40').toBe(40);
    const hist = await historyOf(request);
    const apiRow = hist.find((h: any) => h.transportId === out.body.transportId);
    rec.api = { count: hist.length, srcLen: apiRow?.sourceTenant?.name?.length, tgtLen: apiRow?.targetTenant?.name?.length };
    // S3b(REQ-423): 화면의 실제 이관은 미리보기를 먼저 하므로 미리보기 1건 + 실제 이관 1건
    expect(hist.length, '이력 n0+2(미리보기·실제 이관)').toBe(n0 + 2);
    expect(rec.api.srcLen).toBe(40);
    expect(rec.api.tgtLen).toBe(40);
  } finally {
    for (const t of (await app(request, 'GET', '/tenants')).json.tenants as any[]) if (t.name === SRC || t.name === TGT) await app(request, 'DELETE', `/tenants/${encodeURIComponent(t.id)}`);
    rec.cleanedTenants = (await app(request, 'GET', '/tenants')).json.tenants.map((t: any) => t.name);
    void registerTenant;
  }
  finish(rec, w);
});

async function m390(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('table') as HTMLElement;
    let wrapper: HTMLElement = table.parentElement as HTMLElement;
    for (let a: HTMLElement | null = table.parentElement; a; a = a.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) { wrapper = a; break; }
    return { pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth, scrollLeft: wrapper.scrollLeft, scrollable: wrapper.scrollWidth > wrapper.clientWidth, overflowX: getComputedStyle(wrapper).overflowX };
  });
}
async function inWrapperView(page: Page, which: 'first' | 'last') {
  return page.evaluate((wh) => {
    const table = document.querySelector('table') as HTMLElement;
    let wrapper: HTMLElement = table.parentElement as HTMLElement;
    for (let a: HTMLElement | null = table.parentElement; a; a = a.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) { wrapper = a; break; }
    const wr = wrapper.getBoundingClientRect();
    const ths = [...table.querySelectorAll('thead th')] as HTMLElement[];
    const th = wh === 'first' ? ths[0] : ths[ths.length - 1];
    const tds = [...table.querySelectorAll('tbody tr')[0].querySelectorAll('td')] as HTMLElement[];
    const td = wh === 'first' ? tds[0] : tds[tds.length - 1];
    const ins = (e: HTMLElement) => {
      const r = e.getBoundingClientRect();
      return r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5;
    };
    return { headerInside: ins(th), cellInside: ins(td), headerText: (th.textContent || '').trim() };
  }, which);
}

test('QA-200: 390px - 표 래퍼 가로 스크롤과 페이지 넘침 0', async ({ page }) => {
  const rec = R('QA-200');
  const w = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await replaceHistory(page, [rMax(SET_A), plainRow(1), plainRow(2)]);
  await openHistory(page);
  rec.start = await m390(page);
  await shot(page, 'QA-200-left');
  expect.soft(rec.start.pageOverflow, '페이지 가로 넘침 0').toBe(0);
  expect.soft(rec.start.scrollable, '래퍼는 가로 스크롤 가능').toBe(true);
  rec.firstAtLeft = await inWrapperView(page, 'first');
  expect.soft(rec.firstAtLeft.headerInside && rec.firstAtLeft.cellInside, '왼쪽 끝에서 첫 열 보임').toBe(true);
  await page.evaluate(() => {
    const table = document.querySelector('table') as HTMLElement;
    for (let a: HTMLElement | null = table.parentElement; a; a = a.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) { a.scrollLeft = a.scrollWidth; break; }
  });
  await page.waitForTimeout(300);
  rec.atRight = await m390(page);
  rec.lastAtRight = await inWrapperView(page, 'last');
  await shot(page, 'QA-200-right');
  expect.soft(rec.lastAtRight.headerInside, '오른쪽 끝에서 마지막 열 머리가 래퍼 안').toBe(true);
  expect.soft(rec.lastAtRight.cellInside, '오른쪽 끝에서 이관 ID 셀이 래퍼 안').toBe(true);
  expect.soft(rec.atRight.pageOverflow, '스크롤 뒤에도 페이지 넘침 0').toBe(0);
  await page.evaluate(() => {
    const table = document.querySelector('table') as HTMLElement;
    for (let a: HTMLElement | null = table.parentElement; a; a = a.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) { a.scrollLeft = 0; break; }
  });
  await page.waitForTimeout(200);
  rec.back = { ...(await m390(page)), first: await inWrapperView(page, 'first') };
  expect.soft(rec.back.pageOverflow).toBe(0);
  expect.soft(rec.back.first.headerInside).toBe(true);
  rec.topBar = await page.evaluate(() => {
    const h = document.querySelector('header') as HTMLElement | null;
    return h ? { scrollWidth: h.scrollWidth, clientWidth: h.clientWidth } : null;
  });
  if (rec.topBar) expect.soft(rec.topBar.scrollWidth - rec.topBar.clientWidth, '상단 바 넘침 0').toBeLessThanOrEqual(0);
  finish(rec, w);
});

test('QA-201: 크기 전환과 새로고침 반복', async ({ page }) => {
  test.setTimeout(240000);
  const rec = R('QA-201');
  const w = watch(page);
  await replaceHistory(page, [rMax(SET_A)]);
  await openHistory(page);
  rec.rounds = [];
  for (let i = 1; i <= 3; i++) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    const a = await measureHistory(page, 0);
    judge1280(a, `QA-201 ${i}회 1280`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const b = await m390(page);
    expect.soft(b.pageOverflow, `${i}회 390 페이지 넘침 0`).toBe(0);
    expect.soft(b.scrollable, `${i}회 390 래퍼 스크롤 가능`).toBe(true);
    rec.rounds.push({ round: i, m1280: { m1: a.m1_scrollMinusClient, m2: a.m2_ok, m3: a.m3_allInside, cardInner: a.card.innerRight, lastCellRight: a.m2_lastCellRight }, m390: b });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  rec.reloads = [];
  for (let i = 1; i <= 3; i++) {
    await page.reload();
    await openTab(page, '이력');
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    const early = await measureHistory(page, 0);
    await page.waitForTimeout(600);
    const settled = await measureHistory(page, 0);
    judge1280(early, `QA-201 새로고침 ${i} 로딩 직후`);
    judge1280(settled, `QA-201 새로고침 ${i} 안정 뒤`);
    rec.reloads.push({ reload: i, early: { m1: early.m1_scrollMinusClient, m2: early.m2_ok, m3: early.m3_allInside }, settled: { m1: settled.m1_scrollMinusClient, m2: settled.m2_ok, m3: settled.m3_allInside } });
  }
  await shot(page, 'QA-201-final');
  finish(rec, w);
  void fakeUuid;
});
