// round 02 공용 도우미 (REQ-312·315·316·317·318 묶음). qa.ts·ui.ts 를 그대로 쓰고 여기서는 새 것만 더한다.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { app, call, STUB } from './qa';
import { resultRegion, gotoFresh } from './ui';

export const NOTICE = '대상 테넌트에서 이 아티팩트가 편집 중(잠김)일 수 있습니다. CPI 화면에서 편집을 저장하거나 취소한 뒤 다시 시도하세요.';
export const countOf = (s: string, sub: string): number => (sub ? s.split(sub).length - 1 : 0);
export const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const BASE_REQ = { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' };
export const xport = (request: APIRequestContext, over: Record<string, unknown> = {}) => app(request, 'POST', '/transport', { ...BASE_REQ, ...over });

/** 스텁의 전체 요청 기록 {method,url} (토큰 요청 제외 여부는 호출자가 고른다) */
export async function stubAll(request: APIRequestContext, port: number): Promise<Array<{ method: string; url: string }>> {
  const r = await call(request, 'POST', `${STUB[port]}/__admin/requests/find`, { method: 'ANY', urlPathPattern: '.*' });
  return ((r.json?.requests ?? []) as any[]).map((q) => ({ method: q.method, url: q.url }));
}

export const PUT_UPLOAD = { method: 'PUT', urlPath: "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')" };
export const putMapping = (status: number, body: string | undefined, headers: Record<string, string> = { 'Content-Type': 'text/plain' }) => ({
  priority: 1,
  request: PUT_UPLOAD,
  response: body === undefined ? { status } : { status, body, headers },
});
export const putCount = async (request: APIRequestContext): Promise<number> =>
  (await stubAll(request, 18082)).filter((q) => q.method === 'PUT' && /IntegrationDesigntimeArtifacts\(Id='IF_Order_Sync',Version='active'\)$/.test(decodeURIComponent(q.url))).length;

/** 화면에서 실제 이관 1회 (패키지 선택 → 아티팩트 → 실제 이관 → 확인) */
export async function openAllCards(page: Page): Promise<void> {
  const expandAll = page.getByRole('button', { name: '모두 펼치기', exact: true });
  if (await expandAll.count()) await expandAll.click();
  await page.waitForTimeout(200);
}
export const resultText = async (page: Page): Promise<string> => flat(await resultRegion(page).first().innerText());
export { expect };

/** 결과 머리 값: "실패" 타일 값, "치환 문제 N건"(S3 REQ-424 문구), "실패 아티팩트 M개" 와 두 문구의 위치 관계 */
export async function headStats(page: Page): Promise<Record<string, any>> {
  const region = resultRegion(page).first();
  return region.evaluate((r) => {
    const txt = (e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const all = [...r.querySelectorAll('*')];
    const smallest = (re: RegExp): Element[] => all.filter((e) => re.test(txt(e)) && ![...e.children].some((c) => re.test(txt(c))));
    const leaves = all.filter((e) => e.children.length === 0);
    const tileLabel = leaves.find((e) => txt(e) === '실패');
    const tileValue = tileLabel?.parentElement ? txt(tileLabel.parentElement).replace(/^실패\s*/, '') : null;
    const prob = smallest(/치환 문제 \d+건/);
    const fa = smallest(/실패 아티팩트 \d+개/);
    const full = (r as HTMLElement).innerText.replace(/\s+/g, ' ');
    const pm = full.match(/치환 문제 (\d+)건/);
    const fm = [...full.matchAll(/실패 아티팩트 (\d+)개/g)];
    let ancestor: Element | null = null;
    if (prob[0] && fa[0]) {
      let a: Element | null = prob[0];
      while (a && !a.contains(fa[0])) a = a.parentElement;
      ancestor = a;
    }
    const sw = [...r.querySelectorAll('label,span,div')].find((e) => txt(e) === '문제 항목만 보기');
    const desc = (e: Element | null) => (e ? `${e.tagName}.${(e.getAttribute('class') || '').slice(0, 60)}` : null);
    return {
      tileValue,
      problemText: prob[0] ? txt(prob[0]) : null,
      problemN: pm ? Number(pm[1]) : null,
      failArtifactsTexts: fm.map((m) => m[0]),
      failArtifactsM: fm.length ? Number(fm[0][1]) : null,
      failArtifactsElementCount: fa.length,
      sameParentAsProblem: !!(prob[0] && fa[0] && prob[0].parentElement === fa[0].parentElement),
      commonAncestor: desc(ancestor),
      commonAncestorText: ancestor ? txt(ancestor).slice(0, 140) : null,
      ancestorContainsStatTiles: ancestor ? /전체\s*\d+\s*성공\s*\d+/.test(txt(ancestor)) : null,
      ancestorContainsSwitchLabel: ancestor && sw ? ancestor.contains(sw) : null,
    };
  });
}
export const filterSwitch = (page: Page) => resultRegion(page).first().getByLabel('문제 항목만 보기', { exact: true });

// ---------------------------------------------------------------- REQ-312: 이관 탭 안내 문구 위치
export const P_REGISTER = '먼저 테넌트를 등록하세요';
export const P_SRC = '원본 테넌트를 선택하세요';
export const P_DST = '대상 테넌트를 선택하세요';
export const P_SAME = '원본과 대상이 같습니다';
export const P_NONE = '등록된 테넌트가 없습니다';
export const P_GO = '테넌트 탭으로 이동';

/** 화면(body.innerText + 접근성 트리)에서 문구 개수와, 문구를 담은 가장 작은 요소의 가까운 머리글 */
export async function phraseReport(page: Page, phrases: string[]): Promise<Record<string, any>> {
  const aria = await page.locator('body').ariaSnapshot();
  const rows = await page.evaluate((ph) => {
    const out: Record<string, any> = {};
    const body = document.body.innerText.replace(/\s+/g, ' ');
    const all = [...document.querySelectorAll('body *')];
    for (const p of ph) {
      const smallest = all.filter((e) => (e.textContent || '').replace(/\s+/g, ' ').includes(p) && ![...e.children].some((c) => (c.textContent || '').replace(/\s+/g, ' ').includes(p)));
      out[p] = {
        innerTextCount: body.split(p).length - 1,
        elements: smallest.map((e) => {
          let a: Element | null = e;
          let heading = '';
          while (a && !heading) {
            const h = a.querySelector('h1,h2,h3,h4,legend');
            if (h) heading = (h.textContent || '').trim();
            a = a.parentElement;
          }
          return { tag: e.tagName, text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), nearestHeading: heading, visible: !!((e as HTMLElement).offsetParent || (e as HTMLElement).getClientRects().length) };
        }),
      };
    }
    return out;
  }, phrases);
  for (const p of phrases) rows[p].ariaCount = aria.split(p).length - 1;
  return rows;
}
export const countAny = (rep: Record<string, any>, p: string): number => Math.max(rep[p].innerTextCount, rep[p].ariaCount);

// ---------------------------------------------------------------- REQ-317: 이력 표 측정
export const W40 = 'W'.repeat(40);
export interface StrSet {
  name: string;
  pkg: string;
  src: string;
  tgt: string;
}
export const SET_A: StrSet = { name: '세트 A', pkg: 'CPITT_Real_Package_ID_0123456789_ABCD_XYZ'.slice(0, 40), src: 'SOURCE-TRIAL-TENANT-NAME-ABCDEFGHIJ-0001', tgt: 'TARGET-TRIAL-TENANT-NAME-ABCDEFGHIJ-0002' };
export const SET_B: StrSet = { name: '세트 B', pkg: W40, src: W40, tgt: W40 };
export const SET_C: StrSet = { name: '세트 C', pkg: W40, src: '가'.repeat(40), tgt: '가'.repeat(40) };
export const UUID_MAX = '123e4567-e89b-42d3-a456-426614174000';

export function rMax(s: StrSet, over: Record<string, any> = {}): any {
  return {
    transportId: UUID_MAX,
    packageId: s.pkg,
    dryRun: false,
    deploy: true,
    startedAt: '2026-10-20T09:00:00Z',
    finishedAt: '2026-10-20T09:01:00Z',
    summary: { total: 2, succeeded: 0, failed: 2 },
    results: [
      { artifactId: 'A1', status: 'FAILED', action: 'UPDATED', replacements: [], unmappedKeys: [], deployStatus: 'ERROR', error: { code: 'DEPLOY_FAILED', message: 'DEPLOY: CPI deployment ERROR' } },
      { artifactId: 'A2', status: 'FAILED', action: 'UPDATED', replacements: [], unmappedKeys: [], deployStatus: 'TIMEOUT', error: { code: 'DEPLOY_TIMEOUT', message: 'DEPLOY: timeout' } },
    ],
    sourceTenant: { id: 's1', name: s.src },
    targetTenant: { id: 't1', name: s.tgt },
    ...over,
  };
}
let uuidSeq = 0;
export const fakeUuid = (): string => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;
export function plainRow(i: number, over: Record<string, any> = {}): any {
  return {
    transportId: fakeUuid(),
    packageId: `PkgPlain${i}`,
    dryRun: false,
    deploy: false,
    startedAt: `2026-10-19T0${i % 10}:00:00Z`,
    finishedAt: `2026-10-19T0${i % 10}:01:00Z`,
    summary: { total: 2, succeeded: 2, failed: 0 },
    results: [
      { artifactId: 'A1', status: 'SUCCESS', action: 'UPDATED', replacements: [], unmappedKeys: [], deployStatus: 'NOT_REQUESTED', error: null },
      { artifactId: 'A2', status: 'SUCCESS', action: 'CREATED', replacements: [], unmappedKeys: [], deployStatus: 'NOT_REQUESTED', error: null },
    ],
    sourceTenant: { id: 's1', name: 'DEV' },
    targetTenant: { id: 't1', name: 'PRD' },
    ...over,
  };
}
/** 이력 응답 대체 (GET /transport/history). 해제 함수를 돌려준다. */
export async function replaceHistory(page: Page, rows: any[]): Promise<() => Promise<void>> {
  const pred = (u: URL) => u.host === 'localhost:8080' && u.pathname === '/transport/history';
  const handler = async (route: any) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    else await route.continue();
  };
  await page.route(pred, handler);
  return async () => {
    await page.unroute(pred, handler);
  };
}
export async function openHistory(page: Page): Promise<void> {
  await gotoFresh(page, '/#/history');
  await expect(page.getByRole('columnheader', { name: '모드', exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await page.waitForTimeout(300);
}

/** 측정 ①②③ (qa_cases REQ-317 "측정 정의"). rowIndex = 마지막 열 셀을 볼 본문 행 */
export async function measureHistory(page: Page, rowIndex = 0): Promise<Record<string, any>> {
  return page.evaluate((ri) => {
    const table = document.querySelector('table') as HTMLElement;
    const ovf = (e: Element) => /auto|scroll|hidden/.test(getComputedStyle(e).overflowX);
    let wrapper: HTMLElement | null = table.parentElement;
    for (let a: HTMLElement | null = table.parentElement; a; a = a.parentElement) {
      if (ovf(a)) {
        wrapper = a;
        break;
      }
    }
    const w = wrapper as HTMLElement;
    const bw = (e: Element) => parseFloat(getComputedStyle(e).borderRightWidth) || 0;
    let card: HTMLElement | null = w;
    while (card && !(bw(card) > 0)) card = card.parentElement;
    const cardEl = (card || w) as HTMLElement;
    const cr = cardEl.getBoundingClientRect();
    const cs = getComputedStyle(cardEl);
    const inner = cr.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    const ths = [...table.querySelectorAll('thead th')] as HTMLElement[];
    const wr = w.getBoundingClientRect();
    const row = table.querySelectorAll('tbody tr')[ri] as HTMLElement | undefined;
    const tds = row ? ([...row.querySelectorAll('td')] as HTMLElement[]) : [];
    const last = tds[tds.length - 1];
    const lr = last?.getBoundingClientRect();
    const headerIn = ths.map((t) => {
      const r = t.getBoundingClientRect();
      return { text: (t.textContent || '').trim(), left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, inside: r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5 };
    });
    const cellIn = tds.map((t) => {
      const r = t.getBoundingClientRect();
      return { right: Math.round(r.right * 10) / 10, inside: r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5 };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wrapper: { tag: w.tagName, cls: (w.getAttribute('class') || '').slice(0, 60), overflowX: getComputedStyle(w).overflowX, scrollWidth: w.scrollWidth, clientWidth: w.clientWidth, scrollLeft: w.scrollLeft, left: wr.left, right: wr.right },
      card: { tag: cardEl.tagName, cls: (cardEl.getAttribute('class') || '').slice(0, 60), isWrapper: cardEl === w, right: cr.right, innerRight: inner },
      m1_scrollMinusClient: w.scrollWidth - w.clientWidth,
      m2_lastCellRight: lr ? lr.right : null,
      m2_ok: lr ? lr.right <= inner + 0.5 : false,
      m3_headerCount: ths.length,
      m3_headers: headerIn,
      m3_allInside: ths.length === 8 && headerIn.every((h) => h.inside),
      cellsInside: cellIn,
      tableWidth: table.getBoundingClientRect().width,
      verticalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  }, rowIndex);
}
