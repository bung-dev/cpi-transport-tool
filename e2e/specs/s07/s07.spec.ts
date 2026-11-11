// 묶음 s07 — REQ-318 등록 실패 뒤 서비스 키 입력 비우기 (QA-203~211). qa_cases.md "REQ-318" 절 그대로.
// 앱: --profile stub (초기 등록 DEV·PRD, 저장소 fresh). 표지 문자열은 H-5 스캔 대상이다.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { after, app, ART, R, shot, tenantList } from '../../lib/qa';
import { foreignHosts, openTab, watch, type Watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });

test.afterEach(async ({ request }) => {
  await after(request);
});

const KEYJSON = (n: string, over: Record<string, any> = {}) => ({
  oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: `qa318-${n}-id`, clientsecret: `qa318-${n}-secret`, createdate: '2026-01-01T00:00:00Z', ...over },
});
const KEYTXT = (n: string) => JSON.stringify(KEYJSON(n));
const marks = (n: string) => [`qa318-${n}-id`, `qa318-${n}-secret`];

// S2(REQ-412): 등록 폼은 "테넌트 등록" 버튼으로 여는 오른쪽 서랍이다. 성공하면 서랍이 닫히므로 다시 열어 입력이 빈 것을 확인한다.
const regGroup = (page: Page) => page.getByRole('dialog', { name: '테넌트 등록' });
async function ensureDrawer(page: Page): Promise<void> {
  if (await regGroup(page).isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
  await expect(regGroup(page)).toBeVisible();
}
const nameBox = (page: Page) => regGroup(page).getByRole('textbox', { name: '이름' });
const keyBox = (page: Page) => regGroup(page).getByRole('textbox', { name: '서비스 키 붙여넣기' });
const fileBox = (page: Page) => regGroup(page).locator('input[type=file]');
const submitBtn = (page: Page) => regGroup(page).getByRole('button', { name: '등록', exact: true });

/** H-5 DOM 비밀 스캔 */
async function scan(page: Page, strs: string[]): Promise<Record<string, number>> {
  return page.evaluate((ss) => {
    const html = document.documentElement.outerHTML;
    const vals = [...document.querySelectorAll('input,textarea')].map((e: any) => String(e.value ?? '')).join('\n');
    const attrs = [...document.querySelectorAll('*')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`).join('\n');
    const text = document.body.innerText;
    const cnt = (h: string, s: string) => h.split(s).length - 1;
    const out: Record<string, number> = {};
    for (const s of ss) out[s] = cnt(html, s) + cnt(vals, s) + cnt(attrs, s) + cnt(text, s);
    return out;
  }, strs);
}
const alertTexts = async (page: Page) => (await page.getByRole('alert').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
async function state(page: Page) {
  const alerts = await alertTexts(page);
  await ensureDrawer(page);
  return {
    name: await nameBox(page).inputValue(),
    key: await keyBox(page).inputValue(),
    keyLen: (await keyBox(page).inputValue()).length,
    files: await fileBox(page).evaluate((e: HTMLInputElement) => e.files?.length ?? 0),
    fileValue: await fileBox(page).evaluate((e: HTMLInputElement) => e.value),
    alerts,
  };
}
const postCount = (w: Watch) => w.reqs.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/tenants').length;
const finish = (rec: any, w: Watch) => {
  rec.pageerrors = w.errors;
  rec.consoleErrors = w.consoleErrors;
  rec.consoleExcluded_httpErrorLogs = w.consoleExcluded.length;
  rec.nonLocalRequests = foreignHosts(w);
  expect(w.errors, 'pageerror 0건').toEqual([]);
  expect(w.consoleErrors, 'console.error 0건').toEqual([]);
  expect(foreignHosts(w), '밖 요청 0건').toEqual([]);
};
const countT = async (request: any) => (await tenantList(request)).length;

/** 이름·키 입력 후 등록 클릭. POST 응답이 오면 상태를 돌려준다(요청 전 검사 실패면 null). */
async function submit(page: Page, name: string, keyText: string | null, opts: { fill?: boolean } = {}): Promise<{ status: number | null; body: string | null }> {
  await ensureDrawer(page);
  await nameBox(page).fill(name);
  if (keyText !== null) await keyBox(page).fill(keyText);
  let status: number | null = null;
  let body: string | null = null;
  const onResp = async (r: any) => {
    if (r.url() === 'http://localhost:8080/tenants' && r.request().method() === 'POST') {
      status = r.status();
      body = await r.text().catch(() => null);
    }
  };
  page.on('response', onResp);
  await submitBtn(page).click();
  await page.waitForTimeout(1200);
  page.off('response', onResp);
  void opts;
  return { status, body };
}

async function toTenants(page: Page): Promise<void> {
  await page.goto('/#/tenants');
  await expect(page.getByRole('heading', { level: 2, name: '테넌트', exact: true })).toBeVisible();
  await ensureDrawer(page);
}

test('QA-203: 서버 오류(409 이름 중복) 뒤 입력 비움', async ({ page, request }) => {
  const rec = R('QA-203');
  const w = watch(page);
  rec.c0 = await countT(request);
  await toTenants(page);
  const r = await submit(page, 'DEV', KEYTXT('203'));
  rec.response = { status: r.status, body: r.body && r.body.slice(0, 200) };
  rec.after = await state(page);
  rec.scan = await scan(page, marks('203'));
  rec.c1 = await countT(request);
  await shot(page, 'QA-203-after');
  expect(rec.after.alerts.length, '오류 안내 보임').toBeGreaterThan(0);
  expect(rec.after.keyLen, 'textarea 빈 값').toBe(0);
  expect(rec.after.name, '이름은 입력 그대로').toBe('DEV');
  expect(Object.values(rec.scan).reduce((a: number, b) => a + (b as number), 0), 'DOM 표지 0건').toBe(0);
  expect(rec.c1, '등록 건수 그대로').toBe(rec.c0);
  finish(rec, w);
});

test('QA-204: 서버 오류(INVALID_SERVICE_KEY) 뒤 입력 비움', async ({ page, request }) => {
  const rec = R('QA-204');
  const w = watch(page);
  rec.c0 = await countT(request);
  await toTenants(page);
  const k = { oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: 'qa318-204-id' }, extra: 'qa318-204-secret' };
  const r = await submit(page, 'QA318-B', JSON.stringify(k));
  rec.response = { status: r.status, body: r.body && r.body.slice(0, 300) };
  rec.after = await state(page);
  rec.scan = await scan(page, marks('204'));
  rec.c1 = await countT(request);
  await shot(page, 'QA-204-after');
  expect(rec.after.alerts.length, '오류 안내').toBeGreaterThan(0);
  expect(rec.after.alerts.join(' '), '안내 문구에 키 일부 에코 없음').not.toMatch(/qa318-204/);
  expect(rec.after.keyLen).toBe(0);
  expect(rec.after.name).toBe('QA318-B');
  expect(Object.values(rec.scan).reduce((a: number, b) => a + (b as number), 0), 'DOM 표지 0건').toBe(0);
  expect(rec.c1).toBe(rec.c0);
  finish(rec, w);
});

test('QA-205: 네트워크 오류 뒤 입력 비움', async ({ page, request }) => {
  const rec = R('QA-205');
  const w = watch(page);
  rec.c0 = await countT(request);
  rec.replaced = 'POST http://localhost:8080/tenants -> route.abort(connectionrefused) (GET 통과)';
  const pred = (u: URL) => u.host === 'localhost:8080' && u.pathname === '/tenants';
  const handler = async (route: any) => {
    if (route.request().method() === 'POST') await route.abort('connectionrefused');
    else await route.continue();
  };
  await page.route(pred, handler);
  await toTenants(page);
  await submit(page, 'QA318-C', KEYTXT('205'));
  rec.after = await state(page);
  rec.scan = await scan(page, marks('205'));
  rec.bodyVisible = (await page.locator('#root').innerText()).length > 50;
  await shot(page, 'QA-205-after');
  await page.unroute(pred, handler);
  rec.c1 = await countT(request);
  expect(rec.after.alerts.length, '오류 안내 보임').toBeGreaterThan(0);
  expect(rec.bodyVisible, '화면이 비지 않음').toBe(true);
  expect(rec.after.keyLen).toBe(0);
  expect(rec.after.name).toBe('QA318-C');
  expect(Object.values(rec.scan).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
  expect(rec.c1).toBe(rec.c0);
  finish(rec, w);
});

test('QA-206: 요청 전 클라이언트 검사 실패와 공격적 입력', async ({ page }) => {
  test.setTimeout(240000);
  const rec = R('QA-206');
  const w = watch(page);
  await toTenants(page);
  const variants: Array<[string, string, string]> = [
    ['가-잘린JSON', '206a', '{"oauth":{"clientid":"qa318-206a-id","clientsecret":"qa318-206a-secret"'],
    ['나-HTML조각', '206b', '<img src=x onerror="window.__qa318=1"> qa318-206b-id qa318-206b-secret'],
    ['다-JSON배열', '206c', '["qa318-206c-id","qa318-206c-secret"]'],
    ['라-따옴표문자열', '206d', '"qa318-206d-id qa318-206d-secret"'],
  ];
  rec.variants = [];
  for (const [nm, n, text] of variants) {
    const before = postCount(w);
    const r = await submit(page, 'QA318-D', text);
    const st = await state(page);
    const sc = await scan(page, marks(n));
    const flag = await page.evaluate(() => (window as any).__qa318);
    const row = { name: nm, postSent: postCount(w) - before, response: r.status, state: st, scan: sc, windowFlag: flag ?? null, dialogs: [...w.dialogs] };
    rec.variants.push(row);
    await shot(page, `QA-206-${nm.slice(0, 1)}`);
    expect.soft(st.alerts.length, `${nm}: 오류 안내`).toBeGreaterThan(0);
    expect.soft(st.keyLen, `${nm}: textarea 비어 있음`).toBe(0);
    expect.soft(st.name, `${nm}: 이름 유지`).toBe('QA318-D');
    expect.soft(Object.values(sc).reduce((a: number, b) => a + (b as number), 0), `${nm}: DOM 표지 0건 (${JSON.stringify(sc)})`).toBe(0);
    expect.soft(flag, `${nm}: window.__qa318 undefined`).toBeUndefined();
    if (nm.startsWith('가')) {
      expect.soft(row.postSent, '가: POST /tenants 나가지 않음').toBe(0);
      expect.soft(st.alerts.join(' '), '가: "서비스 키 JSON 형식이 아닙니다"').toContain('서비스 키 JSON 형식이 아닙니다');
    }
  }
  expect.soft(w.dialogs, '대화상자 없음').toEqual([]);
  finish(rec, w);
});

test('QA-207: 파일 선택 경로 실패 뒤 파일 선택 지움과 재선택', async ({ page, request }) => {
  test.setTimeout(180000);
  const rec = R('QA-207');
  const w = watch(page);
  fs.mkdirSync(ART(), { recursive: true });
  const f = path.join(ART(), 'qa318-key-207.json');
  fs.writeFileSync(f, KEYTXT('207'), 'utf8');
  await toTenants(page);
  await nameBox(page).fill('DEV');
  await fileBox(page).setInputFiles(f);
  await page.waitForTimeout(300);
  rec.beforeSubmit = { ...(await state(page)), fileNameShown: (await regGroup(page).innerText()).replace(/\s+/g, ' ').slice(0, 200) };
  expect(rec.beforeSubmit.files, '선택된 파일 1개').toBe(1);
  await submitBtn(page).click();
  await page.waitForTimeout(1200);
  rec.afterFail = { ...(await state(page)), group: (await regGroup(page).innerText()).replace(/\s+/g, ' ').slice(0, 200) };
  rec.scan = await scan(page, marks('207'));
  await shot(page, 'QA-207-after-fail');
  expect(rec.afterFail.alerts.length, '오류 안내').toBeGreaterThan(0);
  expect(rec.afterFail.files, '파일 input files.length 0').toBe(0);
  expect(rec.afterFail.fileValue, '파일 input value 빈 값').toBe('');
  expect(rec.afterFail.group, '선택 파일 이름 표시 없음').not.toContain('qa318-key-207.json');
  expect(Object.values(rec.scan).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
  // 같은 파일 다시 선택, 이름 변경, 등록
  await fileBox(page).setInputFiles(f);
  await page.waitForTimeout(300);
  rec.reselected = { ...(await state(page)), fileNameShown: (await regGroup(page).innerText()).replace(/\s+/g, ' ').slice(0, 200) };
  expect(rec.reselected.files, '다시 선택이 반영됨').toBe(1);
  await nameBox(page).fill('QA318-E');
  const resp = page.waitForResponse((r) => r.url() === 'http://localhost:8080/tenants' && r.request().method() === 'POST');
  await submitBtn(page).click();
  rec.secondStatus = (await resp).status();
  await page.waitForTimeout(500);
  rec.names = (await tenantList(request)).map((t) => t.name);
  expect(rec.secondStatus, '재등록 성공').toBe(201);
  expect(rec.names).toContain('QA318-E');
  finish(rec, w);
});

test('QA-208: 수정(PUT) 실패 뒤 입력 비움', async ({ page, request }) => {
  test.setTimeout(180000);
  const rec = R('QA-208');
  const w = watch(page);
  let t = (await tenantList(request)).find((x) => x.name === 'QA318-E');
  if (!t) {
    const r = await app(request, 'POST', '/tenants', { name: 'QA318-E', serviceKey: KEYJSON('208seed') });
    expect(r.status).toBe(201);
    t = (await tenantList(request)).find((x) => x.name === 'QA318-E');
  }
  rec.tenantId = t.id;
  await page.goto('/#/tenants');
  const row = page.getByRole('row').filter({ hasText: 'QA318-E' });
  await row.getByRole('button', { name: '수정' }).click();
  await page.waitForTimeout(300);
  const group = page.getByRole('dialog', { name: '테넌트 수정' });
  const scope = (await group.count()) ? group : page.locator('main');
  const nb = scope.getByRole('textbox', { name: '이름' });
  const kb = scope.getByRole('textbox', { name: /서비스 키/ }).first();
  await nb.fill('QA318-E2');
  await kb.fill(JSON.stringify({ oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: 'qa318-208-id', extra: 'qa318-208-secret' } }));
  let status: number | null = null;
  page.on('response', (r) => {
    if (/\/tenants\//.test(r.url()) && r.request().method() === 'PUT') status = r.status();
  });
  await scope.getByRole('button', { name: /^(저장|수정|변경)/ }).first().click();
  await page.waitForTimeout(1200);
  rec.putStatus = status;
  rec.after = { name: await nb.inputValue().catch(() => null), keyLen: (await kb.inputValue().catch(() => '')).length, alerts: await alertTexts(page) };
  rec.scan = await scan(page, marks('208'));
  rec.serverName = (await tenantList(request)).find((x) => x.id === t.id)?.name;
  await shot(page, 'QA-208-after');
  expect(rec.after.alerts.length, '오류 안내').toBeGreaterThan(0);
  expect(rec.after.keyLen, 'textarea 비어 있음').toBe(0);
  expect(rec.after.name, '이름 입력은 사용자가 입력한 QA318-E2 유지').toBe('QA318-E2');
  expect(Object.values(rec.scan).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
  expect(rec.serverName, '서버 이름 QA318-E 그대로').toBe('QA318-E');
  finish(rec, w);
});

test('QA-209: 실패 뒤 DOM에 서비스 키 문자열 없음, 안내는 유지', async ({ page }) => {
  test.setTimeout(240000);
  const rec = R('QA-209');
  const w = watch(page);
  const pred = (u: URL) => u.host === 'localhost:8080' && u.pathname === '/tenants';
  const types: Array<[string, string, string, string, boolean]> = [
    ['a-409중복', '209a', 'DEV', KEYTXT('209a'), false],
    ['b-INVALID_SERVICE_KEY', '209b', 'QA318-B2', JSON.stringify({ oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: 'qa318-209b-id', extra: 'qa318-209b-secret' } }), false],
    ['c-네트워크abort', '209c', 'QA318-C2', KEYTXT('209c'), true],
    ['d-클라이언트형식오류', '209d', 'QA318-D2', '{"oauth":{"clientid":"qa318-209d-id","clientsecret":"qa318-209d-secret"', false],
  ];
  rec.types = [];
  for (const [nm, n, name, text, abort] of types) {
    await toTenants(page);
    const handler = async (route: any) => {
      if (route.request().method() === 'POST') await route.abort('connectionrefused');
      else await route.continue();
    };
    if (abort) await page.route(pred, handler);
    await submit(page, name, text);
    if (abort) await page.unroute(pred, handler);
    const st = await state(page);
    const sc1 = await scan(page, marks(n));
    await page.keyboard.press('Escape');
    await expect(regGroup(page)).toBeHidden();
    await openTab(page, '이관');
    await page.waitForTimeout(300);
    await openTab(page, '테넌트');
    await page.waitForTimeout(300);
    const sc2 = await scan(page, marks(n));
    const taValue = await page.evaluate(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? null);
    const alertsAfterRoundTrip = await alertTexts(page);
    rec.types.push({ name: nm, alerts: st.alerts, scanAfterFail: sc1, scanAfterTabRoundTrip: sc2, textareaValue: taValue, alertsAfterRoundTrip });
    await shot(page, `QA-209-${nm.slice(0, 1)}`);
    expect.soft(st.alerts.length, `${nm}: 오류 안내 보임`).toBeGreaterThan(0);
    expect.soft(Object.values(sc1).reduce((a: number, b) => a + (b as number), 0), `${nm}: 실패 직후 DOM 표지 0건`).toBe(0);
    expect.soft(Object.values(sc2).reduce((a: number, b) => a + (b as number), 0), `${nm}: 탭 왕복 뒤 DOM 표지 0건`).toBe(0);
    expect.soft(taValue ?? '', `${nm}: textarea 값 빈 문자열`).toBe('');
  }
  finish(rec, w);
});

test('QA-210: 성공 때 이름·키 모두 비움, 저장 재조회', async ({ page, request }) => {
  test.setTimeout(180000);
  const rec = R('QA-210');
  const w = watch(page);
  rec.c0 = await countT(request);
  await toTenants(page);
  const r1 = await submit(page, 'QA318-OK1', KEYTXT('210a'));
  rec.step1 = { status: r1.status, ...(await state(page)) };
  await shot(page, 'QA-210-1-paste');
  expect(r1.status).toBe(201);
  expect(rec.step1.name, '성공 직후 이름 비움').toBe('');
  expect(rec.step1.keyLen, '성공 직후 textarea 비움').toBe(0);
  expect(rec.step1.files).toBe(0);
  fs.mkdirSync(ART(), { recursive: true });
  const f = path.join(ART(), 'qa318-key-210b.json');
  fs.writeFileSync(f, KEYTXT('210b'), 'utf8');
  await ensureDrawer(page);
  await nameBox(page).fill('QA318-OK2');
  await fileBox(page).setInputFiles(f);
  await page.waitForTimeout(300);
  let st2: number | null = null;
  const onR = (r: any) => {
    if (r.url() === 'http://localhost:8080/tenants' && r.request().method() === 'POST') st2 = r.status();
  };
  page.on('response', onR);
  await submitBtn(page).click();
  await page.waitForTimeout(1200);
  page.off('response', onR);
  rec.step3 = { status: st2, ...(await state(page)) };
  await shot(page, 'QA-210-3-file');
  expect(st2).toBe(201);
  expect(rec.step3.name).toBe('');
  expect(rec.step3.keyLen).toBe(0);
  expect(rec.step3.files).toBe(0);
  if (await regGroup(page).isVisible()) await page.keyboard.press('Escape');
  const items = (await page.getByRole('row').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  rec.listItems = items.filter((s) => /QA318-OK/.test(s));
  expect(rec.listItems.length, '목록에 두 테넌트').toBe(2);
  expect(rec.listItems.join(' '), 'source 등록').toContain('등록');
  expect((await alertTexts(page)).length, '오류 안내 사라짐').toBe(0);
  await page.reload();
  await openTab(page, '테넌트');
  const list = await tenantList(request);
  rec.apiAfter = list.filter((t) => /QA318-OK/.test(t.name)).map((t) => ({ name: t.name, source: t.source, apiHost: t.apiHost }));
  rec.c1 = list.length;
  expect(rec.c1, '건수 c0+2').toBe(rec.c0 + 2);
  expect(JSON.stringify(list), '응답에 서비스 키 값 없음').not.toMatch(/qa318-210/);
  const afterReloadText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  rec.listAfterReload = ['QA318-OK1', 'QA318-OK2'].map((n) => afterReloadText.includes(n));
  expect(rec.listAfterReload).toEqual([true, true]);
  expect((await scan(page, ['qa318-210a-id', 'qa318-210a-secret', 'qa318-210b-id', 'qa318-210b-secret'])), '화면에 서비스 키 값 없음').toEqual({ 'qa318-210a-id': 0, 'qa318-210a-secret': 0, 'qa318-210b-id': 0, 'qa318-210b-secret': 0 });
  finish(rec, w);
});

test('QA-211: 연속 실패·실패 뒤 성공·64KB 초과 본문', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-211');
  const w = watch(page);
  rec.c0 = await countT(request);
  await toTenants(page);
  rec.dup = [];
  for (let i = 1; i <= 3; i++) {
    await submit(page, 'DEV', KEYTXT('211a'));
    const st = await state(page);
    const sc = await scan(page, marks('211a'));
    rec.dup.push({ attempt: i, alerts: st.alerts, keyLen: st.keyLen, scan: sc });
    expect.soft(st.keyLen, `${i}회 textarea 비어 있음`).toBe(0);
    expect.soft(Object.values(sc).reduce((a: number, b) => a + (b as number), 0), `${i}회 DOM 표지 0건`).toBe(0);
    expect.soft(st.alerts.length, `${i}회 오류 안내`).toBeGreaterThan(0);
  }
  const ok = await submit(page, 'QA318-F', KEYTXT('211b'));
  rec.success = { status: ok.status, ...(await state(page)) };
  expect(ok.status, '실패 뒤 성공 등록').toBe(201);
  expect(rec.success.name).toBe('');
  expect(rec.success.keyLen).toBe(0);
  const c1 = await countT(request);
  expect(c1, '등록 건수 +1').toBe(rec.c0 + 1);
  // 64KB 초과
  const big = JSON.stringify(KEYJSON('211c', {})).replace(/\}\}$/, `},"pad":"${'a'.repeat(70000)}"}`);
  rec.bigLen = big.length;
  const r = await submit(page, 'QA318-G', big);
  rec.big = { status: r.status, body: r.body && r.body.slice(0, 200), ...(await state(page)), scan: await scan(page, marks('211c')) };
  await shot(page, 'QA-211-big');
  rec.c2 = await countT(request);
  rec.bigRegistered = !!(await tenantList(request)).find((t) => t.name === 'QA318-G');
  if (r.status !== null && r.status < 300) {
    rec.note = '서버가 64KB 초과 본문을 받아 등록함: REQ-318 범위가 아니라 승계 REQ-301 AC-1 위반 후보 (NEEDS_DECISION)';
  }
  expect.soft(rec.big.status === null || rec.big.status >= 400, '64KB 초과는 서버 오류 응답(승계 REQ-301 AC-1)').toBe(true);
  expect.soft(rec.big.keyLen, '실패 뒤 textarea 비어 있음').toBe(0);
  expect.soft(rec.big.name, '이름 QA318-G 유지').toBe('QA318-G');
  expect.soft(Object.values(rec.big.scan).reduce((a: number, b) => a + (b as number), 0), 'DOM 표지 0건').toBe(0);
  expect.soft(rec.bigRegistered, 'QA318-G 등록되지 않음').toBe(false);
  rec.pageerrors = w.errors;
  finish(rec, w);
});
