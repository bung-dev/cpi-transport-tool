// 화면 공용 도우미 (run 20261020-defect-fix). 접근 가능한 이름과 역할로만 요소를 찾는다(run_instructions 5-6).
// H-1(키보드 이동), H-2(요청 기록), H-8(옛 명칭 스캐너), H-9(양성 대조), H-11(설명 문장)을 구현한다.
import { expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { APP, ART } from './qa';

export const OLD_TERM = '드라이런';
export const NEW_TERM = '미리보기';
// S3b(REQ-420): 실행 모드 라디오와 그 설명 문장은 없어졌다. 새 이관 부제가 "<원본> → <대상> · <안내>"로 실제 경로와 미리보기 안내를 보인다.
export const SUBTITLE_TAIL = '미리보기로 변경 내용을 먼저 확인한 뒤 실제 이관합니다.';
export const subtitleOf = (route: string) => `${route} · ${SUBTITLE_TAIL}`;

// ---------------------------------------------------------------- H-2: 요청·오류 기록
export interface Watch {
  reqs: Array<{ method: string; url: string; postData: string | null }>;
  errors: string[];
  consoleErrors: string[];
  consoleExcluded: string[];
  dialogs: string[];
  inflightPackages: number;
  packageReqs: string[];
}
export function watch(page: Page): Watch {
  const w: Watch = { reqs: [], errors: [], consoleErrors: [], consoleExcluded: [], dialogs: [], inflightPackages: 0, packageReqs: [] };
  const isPkg = (u: string) => {
    try {
      const x = new URL(u);
      return x.host === 'localhost:8080' && x.pathname === '/packages';
    } catch {
      return false;
    }
  };
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 브라우저가 HTTP 오류 응답마다 남기는 자체 로그는 예상한 오류 응답으로 보고 제외하되 기록은 남긴다.
    if (/^Failed to load resource/.test(t)) w.consoleExcluded.push(t);
    else w.consoleErrors.push(t);
  });
  page.on('request', (r) => {
    w.reqs.push({ method: r.method(), url: r.url(), postData: r.method() === 'GET' ? null : r.postData() });
    if (isPkg(r.url())) {
      w.inflightPackages++;
      w.packageReqs.push(r.url());
    }
  });
  const done = (r: any) => {
    if (isPkg(r.url())) w.inflightPackages = Math.max(0, w.inflightPackages - 1);
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  // 네이티브 대화상자: 메시지를 기록하고 닫는다(취소). 이 앱의 확인은 화면 안 대화상자다.
  page.on('dialog', (d) => {
    w.dialogs.push(d.message());
    d.dismiss().catch(() => undefined);
  });
  return w;
}
export const foreignHosts = (w: Watch): string[] =>
  w.reqs.filter((r) => /^https?:/.test(r.url) && new URL(r.url).host !== 'localhost:8080').map((r) => r.url);

/** 패키지 요청이 모두 끝나고 500ms 뒤까지 기다린다 (판정 시점 2). */
export async function settle(page: Page, w: Watch, extraMs = 500): Promise<void> {
  const until = Date.now() + 15000;
  await page.waitForTimeout(150);
  while (w.inflightPackages > 0 && Date.now() < until) await page.waitForTimeout(100);
  await page.waitForTimeout(extraMs);
}

// ---------------------------------------------------------------- 포커스·라디오
export interface ActiveInfo {
  tag: string;
  type: string;
  role: string;
  name: string;
  group: string;
  checked: boolean | null;
  disabled: boolean;
  text: string;
}
export async function active(page: Page): Promise<ActiveInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as any;
    if (!el) return { tag: 'NONE', type: '', role: '', name: '', group: '', checked: null, disabled: false, text: '' };
    const byIds = (ids: string | null) =>
      (ids || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((i) => document.getElementById(i)?.textContent?.trim() || '')
        .join(' ')
        .trim();
    const nameOf = (e: any): string => {
      const a = e.getAttribute('aria-label');
      if (a) return a;
      const l = byIds(e.getAttribute('aria-labelledby'));
      if (l) return l;
      if (e.labels && e.labels[0]) return (e.labels[0].textContent || '').trim();
      return (e.textContent || '').trim();
    };
    const g = el.closest ? el.closest('[role=radiogroup],[role=group],[role=list],[aria-label]') : null;
    const gname = g ? g.getAttribute('aria-label') || byIds(g.getAttribute('aria-labelledby')) || (g.querySelector(':scope > legend')?.textContent || '').trim() : '';
    return {
      tag: el.tagName,
      type: el.type || '',
      role: el.getAttribute('role') || (el.tagName === 'INPUT' ? el.type : '') || '',
      name: nameOf(el),
      group: gname,
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      disabled: !!el.disabled,
      text: (el.textContent || '').trim().slice(0, 80),
    };
  });
}
// S3b(REQ-420): 테넌트 라디오는 이관 화면이 아니라 "경로 변경"으로 여는 창 안의 라디오 그룹 '원본'·'대상'에 있다.
export const ROUTE_DIALOG = '원본과 대상 선택';
export const routeDialog = (page: Page): Locator => page.getByRole('dialog', { name: ROUTE_DIALOG, exact: true });
export const grp = (page: Page, side: '원본' | '대상'): Locator => routeDialog(page).getByRole('radiogroup', { name: side, exact: true });

/** 그룹 안 라디오들의 {이름, checked} */
export async function radiosOf(page: Page, side: '원본' | '대상'): Promise<Array<{ name: string; checked: boolean }>> {
  return grp(page, side).evaluate((g) => {
    const byIds = (ids: string | null) =>
      (ids || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((i) => document.getElementById(i)?.textContent?.trim() || '')
        .join(' ')
        .trim();
    return [...g.querySelectorAll('input[type=radio]')].map((r: any) => ({
      name: r.getAttribute('aria-label') || byIds(r.getAttribute('aria-labelledby')) || (r.labels?.[0]?.textContent || '').trim(),
      checked: !!r.checked,
    }));
  });
}
export const selectedOf = async (page: Page, side: '원본' | '대상'): Promise<string[]> =>
  (await radiosOf(page, side)).filter((r) => r.checked).map((r) => r.name);

export const isTenantRadio = (side: '원본' | '대상', name?: string, checked = true) => (i: ActiveInfo) =>
  i.tag === 'INPUT' && i.type === 'radio' && i.group === side && (name === undefined || i.name === name) && (!checked || i.checked === true);

/** H-1: 방향키(기본 Tab)를 최대 max회 누르며 매번 포커스 요소가 목표인지 검사한다. 누른 횟수를 돌려준다. 닿지 못하면 예외. */
export async function keysTo(
  page: Page,
  pred: (i: ActiveInfo) => boolean,
  what: string,
  dir: 'Tab' | 'Shift+Tab' = 'Tab',
  max = 40,
): Promise<{ presses: number; info: ActiveInfo }> {
  let info = await active(page);
  if (pred(info)) return { presses: 0, info };
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(dir);
    info = await active(page);
    if (pred(info)) return { presses: i, info };
  }
  throw new Error(`H-1 ${dir} ${max}회 안에 '${what}'에 닿지 못함. 마지막 포커스=${JSON.stringify(info)}`);
}

/** 방향키 1회 + 판정 시점 1(직후)·2(패키지 요청 종료 + 500ms 뒤) */
export interface ArrowStep {
  key: string;
  t1: ActiveInfo;
  t2: ActiveInfo;
  sourceSelected: string[];
  targetSelected: string[];
}
export async function arrow(page: Page, w: Watch, key: string): Promise<ArrowStep> {
  await page.keyboard.press(key);
  const t1 = await active(page);
  await settle(page, w);
  const t2 = await active(page);
  return { key, t1, t2, sourceSelected: await selectedOf(page, '원본'), targetSelected: await selectedOf(page, '대상') };
}
/** 두 시점 모두 포커스가 side 그룹의 name 라디오이고 checked 인지 단언한다. */
export function expectFocus(step: ArrowStep, side: '원본' | '대상', name: string, label: string): void {
  for (const [t, i] of [['직후', step.t1], ['요청 종료 500ms 뒤', step.t2]] as const) {
    expect(i.tag, `${label} ${t}: 포커스가 BODY 로 나가지 않음 (${JSON.stringify(i)})`).not.toBe('BODY');
    expect(isTenantRadio(side, name)(i), `${label} ${t}: 포커스=${side} 그룹의 ${name} 라디오(checked) 실제=${JSON.stringify(i)}`).toBe(true);
  }
}

// ---------------------------------------------------------------- 화면 구역
// S2(REQ-410): 탭 대신 주 메뉴 링크. 옛 이름(이관·이력·테넌트)을 새 메뉴 이름으로 바꿔 부른다.
export type OldTab = '이관' | '이력' | '테넌트';
export const NAV_OF: Record<OldTab, string> = { 이관: '새 이관', 이력: '이관 이력', 테넌트: '테넌트' };
export const navLink = (page: Page, name: string) => page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name, exact: true });
export const tabBtn = (page: Page, name: OldTab) => navLink(page, NAV_OF[name]);
export async function openTab(page: Page, name: OldTab): Promise<void> {
  await tabBtn(page, name).click();
  await expect(tabBtn(page, name)).toHaveAttribute('aria-current', 'page');
}
/** 해시만 다른 주소로 goto하면 브라우저가 새로 읽지 않는다(해시 이동). 예전 goto('/')처럼 항상 새로 읽게 빈 페이지를 거친다. */
export async function gotoFresh(page: Page, url: string, opts?: Parameters<Page['goto']>[1]) {
  await page.goto('about:blank');
  return page.goto(url, opts);
}
export const STEP_LABELS = ['템플릿', '패키지', '아티팩트', '미리보기', '실제 이관'] as const;
export type StepLabel = (typeof STEP_LABELS)[number];
export const stepNav = (page: Page) => page.getByRole('navigation', { name: '이관 단계', exact: true });
/** 단계 줄 버튼. 이름은 "<n>. <단계>" 뒤에 요약이 붙는다. */
export const stepBtn = (page: Page, label: StepLabel) => stepNav(page).getByRole('button', { name: new RegExp(`^\\d\\. ${label}`) });
/** 새 이관 화면을 새로 읽는다(템플릿 단계). */
export async function openWizard(page: Page): Promise<void> {
  await gotoFresh(page, '/#/transport');
  await expect(page.getByRole('heading', { level: 2, name: '새 이관', exact: true })).toBeVisible();
}
/** 템플릿 단계에서 "템플릿 없이 진행"을 눌러 패키지 단계로 간다. */
export async function startManual(page: Page): Promise<void> {
  await page.getByRole('button', { name: '템플릿 없이 진행', exact: true }).click();
  await expect(stepBtn(page, '패키지')).toHaveAttribute('aria-current', 'step');
}
/** 새 이관을 새로 열고 템플릿 없이 패키지 단계까지(패키지 목록이 보일 때까지) 간다. */
export async function openTransport(page: Page): Promise<void> {
  await openWizard(page);
  await startManual(page);
  await expect(pkgChecks(page).first()).toBeVisible();
}
/** 버튼이 없거나(원본 없음·목록 읽기 오류로 패키지 목록을 그리지 않음) 비활성이면 진행할 수 없다. */
export const blocked = async (loc: Locator): Promise<boolean> => (await loc.count()) === 0 || (await loc.isDisabled());
export const routeBar = (page: Page) => page.getByRole('group', { name: '이관 경로', exact: true });
export async function openRouteDialog(page: Page): Promise<void> {
  await routeBar(page).getByRole('button', { name: '경로 변경', exact: true }).click();
  await expect(routeDialog(page)).toBeVisible();
}
export const applyRouteBtn = (page: Page) => routeDialog(page).getByRole('button', { name: '이 경로 사용', exact: true });
export async function applyRoute(page: Page): Promise<void> {
  await applyRouteBtn(page).click();
  await expect(routeDialog(page)).toHaveCount(0);
}
/** 경로 변경 창에서 원본·대상을 골라 적용한다. */
export async function setRoute(page: Page, source: string, target: string): Promise<void> {
  await openRouteDialog(page);
  await grp(page, '원본').getByRole('radio', { name: source, exact: true }).check();
  await grp(page, '대상').getByRole('radio', { name: target, exact: true }).check();
  await applyRoute(page);
}
// 20261118 S3(REQ-620): 패키지 단계는 체크 목록이다(여러 개 선택).
export const pkgChecks = (page: Page) => page.getByRole('list', { name: '패키지 목록' }).getByRole('checkbox');
/** 체크된 입력(라디오·체크박스)의 label 텍스트 */
export const checkedLabels = (loc: Locator): Promise<string[]> =>
  loc.evaluateAll((es) => es.filter((e: any) => e.checked).map((e: any) => (e.labels?.[0]?.textContent || '').trim()));
/** 패키지 단계에서 패키지만 고른다(단계는 그대로). */
export async function pickPackage(page: Page, id: string): Promise<void> {
  await page.getByRole('list', { name: '패키지 목록' }).getByRole('checkbox', { name: new RegExp(id) }).first().check();
}
/** 패키지를 고르고 "다음"으로 아티팩트 단계(표)까지 간다. */
export async function choosePackage(page: Page, id: string): Promise<void> {
  await pickPackage(page, id);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(artifactGrid(page)).toBeVisible();
}
export async function packageIds(page: Page): Promise<string[]> {
  const names = await pkgChecks(page).evaluateAll((es) => es.map((e: any) => (e.labels?.[0]?.textContent || '').trim()));
  return names.map((n) => (n.match(/(Pkg[A-Za-z]+)/) || [, n])[1] as string);
}
// S3b(REQ-422): 아티팩트는 체크박스 목록이 아니라 한 열 grid다. 행의 ID 글자로 찾는다.
export const artifactGrid = (page: Page) => page.getByRole('grid', { name: '이관할 아티팩트', exact: true });
export const artifactRow = (page: Page, id: string) => artifactGrid(page).getByRole('row').filter({ has: page.getByText(id, { exact: true }) });
/** 고른 패키지의 아티팩트를 ids만 남긴다. 20261118 S3(REQ-621): 처음엔 모두 선택돼 있으므로 "모두 해제" 뒤에 고른다. */
export async function selectArtifacts(page: Page, ids: string[]): Promise<void> {
  await page.getByRole('button', { name: '모두 해제', exact: true }).click();
  for (const id of ids) {
    await artifactRow(page, id).click();
    await expect(artifactRow(page, id)).toHaveAttribute('aria-selected', 'true');
  }
}
/** 선택된 행의 아티팩트 ID(표 순서) */
export const selectedArtifacts = (page: Page): Promise<string[]> =>
  artifactGrid(page).getByRole('row').evaluateAll((rs) => rs.filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => (r.querySelector('.font-mono')?.textContent || '').trim()));
export interface RunInfo {
  steps: string[];
  current: string | null;
  buttons: string[];
  deployControls: string[];
}
/** 실행 영역: 단계 줄 이름, 현재 단계, 미리보기·실제 이관 버튼 이름, 화면 전체(확인창 포함)의 배포 컨트롤 */
export async function runInfo(page: Page): Promise<RunInfo> {
  const stepTexts = (await stepNav(page).getByRole('button').evaluateAll((bs) => bs.map((b) => `${(b.firstElementChild?.textContent || '').trim()}|${b.getAttribute('aria-current') || ''}`)));
  const steps = stepTexts.map((t) => t.split('|')[0].replace(/^\d+\.\s*/, ''));
  const cur = stepTexts.find((t) => t.endsWith('|step'));
  const all = [...(await page.locator('main').getByRole('button').allInnerTexts()), ...(await page.getByRole('dialog').getByRole('button').allInnerTexts())];
  // 단계 줄 버튼("<n>. <단계>")은 실행 버튼이 아니므로 뺀다.
  const buttons = all.map((s) => s.trim()).filter((s) => !/^\d+\./.test(s) && /미리보기|로 이관$|실제 이관$/.test(s));
  const dep: string[] = [];
  for (const role of ['switch', 'checkbox'] as const) {
    const els = page.getByRole(role);
    const n = await els.count();
    for (let i = 0; i < n; i++) {
      const nm = await els.nth(i).evaluate((e: any) => {
        const ids = (e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        return ids.map((x: string) => document.getElementById(x)?.textContent || '').join(' ') || e.getAttribute('aria-label') || (e.labels?.[0]?.textContent || '');
      });
      if (/배포/.test(nm)) dep.push(`${role}:${nm.trim()}`);
    }
  }
  return { steps, current: cur ? cur.split('|')[0].replace(/^\d+\.\s*/, '') : null, buttons, deployControls: dep };
}
export const previewBtn = (page: Page) => page.getByRole('button', { name: '미리보기 실행', exact: true });
/** 실제 이관 단계의 실행 버튼 "<대상>로 이관" */
export const realBtn = (page: Page, target: string) => page.getByRole('button', { name: `${target}로 이관`, exact: true });
/** 미리보기 결과 머리의 "이 구성으로 실제 이관" */
export const realFromResult = (page: Page) => page.getByRole('button', { name: '이 구성으로 실제 이관', exact: true });
export const confirmDialog = (page: Page) => page.getByRole('dialog', { name: '실제 이관 확인', exact: true });
export const resultRegion = (page: Page) => page.getByRole('region', { name: '이관 결과' });
/** 결과 화면 머리의 모드 배지 (제목 바로 뒤의 칩) */
export async function resultBadge(page: Page): Promise<string> {
  const r = resultRegion(page).first();
  const sp = r.getByRole('heading', { level: 3, name: '이관 결과' }).locator('xpath=following-sibling::span[1]');
  return (await sp.innerText()).trim();
}
export async function waitTransport(page: Page, act: () => Promise<void>): Promise<{ status: number; body: any; postData: any }> {
  const p = page.waitForResponse((r) => r.url() === `${APP}/transport` && r.request().method() === 'POST');
  await act();
  const r = await p;
  let body: any;
  try {
    body = await r.json();
  } catch {
    body = undefined;
  }
  let pd: any;
  try {
    pd = JSON.parse(r.request().postData() || 'null');
  } catch {
    pd = r.request().postData();
  }
  return { status: r.status(), body, postData: pd };
}
export async function runPreview(page: Page) {
  const out = await waitTransport(page, async () => {
    await previewBtn(page).click();
  });
  await expect(resultRegion(page).first()).toBeVisible();
  return out;
}
/** 열린 실제 이관 확인창에서 (deploy면 배포 스위치를 켜고) "실행"을 누른다. 배포 스위치는 꺼짐으로 시작한다(ADR-008). */
export async function confirmDialogRun(page: Page, opts: { deploy?: boolean } = {}) {
  const d = confirmDialog(page);
  await expect(d).toBeVisible();
  const sw = d.getByRole('switch', { name: '배포', exact: true });
  await expect(sw, '확인창의 배포 스위치는 꺼짐으로 시작').not.toBeChecked();
  if (opts.deploy) await sw.check();
  return waitTransport(page, async () => {
    await d.getByRole('button', { name: '실행', exact: true }).click();
  });
}
/**
 * 화면에서 실제 이관 1회. 패키지 단계에서 시작해 패키지 → 아티팩트(artifacts: 'all'이면 "전체 선택", 빈 배열이면 고르지 않음)
 * → 미리보기 → 결과의 "이 구성으로 실제 이관" → 확인창 "실행". S3b부터 실제 이관은 미리보기를 먼저 해야 한다(REQ-423).
 */
export async function realFlow(page: Page, opts: { pkg?: string; artifacts?: string[] | 'all'; deploy?: boolean } = {}) {
  await choosePackage(page, opts.pkg ?? 'PkgTransportDemo');
  if (opts.artifacts === 'all') await page.getByRole('button', { name: '전체 선택', exact: true }).click();
  else if (opts.artifacts) await selectArtifacts(page, opts.artifacts);
  const preview = await runPreview(page);
  await realFromResult(page).click();
  const real = await confirmDialogRun(page, { deploy: opts.deploy });
  await expect(resultRegion(page).first()).toBeVisible();
  return { preview, real };
}
export async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

// ---------------------------------------------------------------- 서비스 키 붙여넣기 등록(테넌트 탭)
export async function registerViaUi(page: Page, name: string, keyJson: unknown): Promise<void> {
  await openTab(page, '테넌트');
  await page.getByRole('button', { name: '테넌트 등록', exact: true }).click();
  const g = page.getByRole('dialog', { name: '테넌트 등록' });
  await g.getByRole('textbox', { name: '이름' }).fill(name);
  await g.getByRole('textbox', { name: '서비스 키 붙여넣기' }).fill(JSON.stringify(keyJson));
  const resp = page.waitForResponse((r) => r.url() === `${APP}/tenants` && r.request().method() === 'POST');
  await g.getByRole('button', { name: '등록', exact: true }).click();
  const r = await resp;
  expect(r.status(), `UI 등록 ${name} 상태`).toBe(201);
}

// ---------------------------------------------------------------- H-8 옛 명칭 스캐너
export interface ScanHit {
  source: string;
  variant: 'NFC' | 'NFKC';
  count: number;
  ctx: string[];
}
export interface ScanResult {
  state: string;
  fail: ScanHit[];
  failTotal: number;
  info: ScanHit[];
  sources: Record<string, number>;
  failBeforeMask?: number;
}
const ZW = /[​-‍⁠﻿­]/g;
const INFO_RE = /드라이 런|드라이-런|dry run|dry-run|dryrun/gi;
function norm(s: string, f: 'NFC' | 'NFKC'): string {
  return s.replace(ZW, '').normalize(f).replace(ZW, '');
}
function findAll(text: string, re: RegExp | string): Array<{ i: number; len: number }> {
  const out: Array<{ i: number; len: number }> = [];
  if (typeof re === 'string') {
    for (let i = text.indexOf(re); i >= 0; i = text.indexOf(re, i + re.length)) out.push({ i, len: re.length });
  } else {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(text))) out.push({ i: m.index, len: m[0].length || 1 });
  }
  return out;
}
function ctxOf(text: string, h: { i: number; len: number }): string {
  return text.slice(Math.max(0, h.i - 40), h.i + h.len + 40).replace(/\s+/g, ' ');
}

async function collectSources(page: Page, w: Watch | undefined): Promise<Record<string, string>> {
  const raw = await page.evaluate(() => {
    const out: Record<string, string> = {};
    out['1:outerHTML'] = document.documentElement.outerHTML;
    const vals: string[] = [];
    document.querySelectorAll('input,textarea,select').forEach((e: any) => vals.push(String(e.value ?? '')));
    document.querySelectorAll('option').forEach((e: any) => vals.push(String(e.textContent ?? '')));
    out['2:values'] = vals.join('\n');
    out['3:innerText'] = document.body.innerText;
    out['3:textContent'] = document.body.textContent || '';
    const pseudo: string[] = [];
    document.querySelectorAll('*').forEach((el) => {
      for (const p of ['::before', '::after']) {
        const c = getComputedStyle(el, p).content;
        if (c && c !== 'none' && c !== 'normal') pseudo.push(c);
      }
    });
    out['5:pseudo'] = pseudo.join('\n');
    out['6:title'] = document.title;
    return out;
  });
  let aria = '';
  try {
    aria = await page.locator('body').ariaSnapshot();
  } catch (e) {
    aria = `ARIA_SNAPSHOT_ERROR ${String(e).slice(0, 80)}`;
  }
  raw['4:ariaSnapshot'] = aria;
  raw['7:nativeDialogs'] = (w?.dialogs ?? []).join('\n');
  return raw;
}

/** 지금 화면 상태에서 H-8 스캔. mask 는 사용자가 입력한 데이터(스캔 전에 가림). */
export async function scanOldTerm(page: Page, state: string, w?: Watch, mask: string[] = []): Promise<ScanResult> {
  const src = await collectSources(page, w);
  const res: ScanResult = { state, fail: [], failTotal: 0, info: [], sources: {} };
  let before = 0;
  for (const [name, text0] of Object.entries(src)) {
    res.sources[name] = text0.length;
    for (const f of ['NFC', 'NFKC'] as const) {
      const t = norm(text0, f);
      if (mask.length) before += findAll(t, OLD_TERM).length;
      let m = t;
      for (const x of mask) for (const mv of new Set([x, norm(x, 'NFC'), norm(x, 'NFKC')])) m = m.split(mv).join('■'.repeat(3));
      const hits = findAll(m, OLD_TERM);
      if (hits.length) {
        res.fail.push({ source: name, variant: f, count: hits.length, ctx: hits.slice(0, 5).map((h) => ctxOf(m, h)) });
        if (f === 'NFC') res.failTotal += hits.length;
      }
      if (!name.startsWith('1:')) {
        const ih = findAll(m, INFO_RE);
        if (ih.length) res.info.push({ source: name, variant: f, count: ih.length, ctx: ih.slice(0, 5).map((h) => ctxOf(m, h)) });
      }
    }
  }
  // NFKC 에서만 나온 경우도 놓치지 않도록 failTotal 은 NFC/NFKC 중 큰 쪽의 합으로 다시 계산
  const nfc = res.fail.filter((h) => h.variant === 'NFC').reduce((a, h) => a + h.count, 0);
  const nfkc = res.fail.filter((h) => h.variant === 'NFKC').reduce((a, h) => a + h.count, 0);
  res.failTotal = Math.max(nfc, nfkc);
  if (mask.length) res.failBeforeMask = before / 2;
  return res;
}

/** H-9: 스캐너 양성 대조. 변형 5종을 하나씩 넣어 모두 찾는지, 지운 뒤 0건인지 확인한다. */
export async function scannerControl(page: Page, w?: Watch): Promise<Record<string, any>> {
  const out: Record<string, any> = { variants: {} };
  const variants: Array<{ id: string; make: string }> = [
    { id: 'visible-text', make: 'text' },
    { id: 'aria-label', make: 'aria' },
    { id: 'title', make: 'title' },
    { id: 'nfd', make: 'nfd' },
    { id: 'zero-width', make: 'zw' },
  ];
  for (const v of variants) {
    await page.evaluate(
      ({ id, make, term }) => {
        const el = document.createElement('div');
        el.setAttribute('data-qa-probe', id);
        const nfd = term.normalize('NFD');
        const zw = term.split('').join('​');
        if (make === 'text') el.textContent = term;
        else if (make === 'aria') el.setAttribute('aria-label', term);
        else if (make === 'title') el.setAttribute('title', term);
        else if (make === 'nfd') el.textContent = nfd;
        else el.textContent = zw;
        document.body.appendChild(el);
      },
      { id: v.id, make: v.make, term: OLD_TERM },
    );
    const r = await scanOldTerm(page, `양성대조-${v.id}`, w);
    out.variants[v.id] = { failTotal: r.failTotal, sources: r.fail.map((h) => `${h.source}/${h.variant}=${h.count}`) };
    await page.evaluate(() => document.querySelectorAll('[data-qa-probe]').forEach((e) => e.remove()));
  }
  const clean = await scanOldTerm(page, '양성대조-제거후', w);
  out.afterRemoval = { failTotal: clean.failTotal };
  out.allFound = Object.values(out.variants).every((x: any) => x.failTotal > 0);
  out.cleanZero = clean.failTotal === 0;
  return out;
}

export function saveJson(name: string, data: unknown): void {
  fs.mkdirSync(ART(), { recursive: true });
  fs.writeFileSync(path.join(ART(), name), JSON.stringify(data, null, 2), 'utf8');
}

/** 스캔 결과 요약(증거 기록용) */
export const brief = (r: ScanResult) => ({ state: r.state, failTotal: r.failTotal, fail: r.fail.map((h) => `${h.source}/${h.variant}=${h.count}`), infoCount: r.info.length, info: r.info.map((h) => `${h.source}/${h.variant}=${h.count}: ${h.ctx[0] ?? ''}`) });

// ---------------------------------------------------------------- 이력 표
export async function historyTable(page: Page): Promise<{ headers: string[]; rows: string[][] }> {
  await expect(page.getByRole('columnheader', { name: '모드', exact: true })).toBeVisible();
  const headers = (await page.getByRole('columnheader').allInnerTexts()).map((s) => s.trim());
  const trs = page.locator('table tbody tr');
  const n = await trs.count();
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) rows.push((await trs.nth(i).getByRole('cell').allInnerTexts()).map((s) => s.trim()));
  return { headers, rows };
}

// ---------------------------------------------------------------- 키보드만의 이관 준비 (QA-146·213 공용)
const pickInfo = (i: ActiveInfo) => ({ tag: i.tag, role: i.role, name: i.name, group: i.group, checked: i.checked });
/**
 * Tab·Shift+Tab·방향키·Enter만으로 "템플릿 없이 진행" → 경로 변경 창에서 원본 DEV·대상 targetName → 패키지 PkgTransportDemo → "다음"
 * → 아티팩트 단계의 "미리보기 실행" 버튼에 닿는다. click/focus/check 없음.
 */
export async function kbdFlow(page: Page, w: Watch, targetName = 'PRD'): Promise<Record<string, any>> {
  const steps: Record<string, any> = {};
  const isBtn = (text: string) => (i: ActiveInfo) => i.tag === 'BUTTON' && i.text === text;
  await openWizard(page);
  steps.manualTab = (await keysTo(page, isBtn('템플릿 없이 진행'), '"템플릿 없이 진행" 버튼')).presses;
  await page.keyboard.press('Enter');
  await expect(stepBtn(page, '패키지')).toHaveAttribute('aria-current', 'step');
  await expect(pkgChecks(page).first()).toBeVisible();
  steps.routeTab = (await keysTo(page, isBtn('경로 변경'), '"경로 변경" 버튼')).presses;
  await page.keyboard.press('Enter');
  await expect(routeDialog(page)).toBeVisible();
  const n1 = await keysTo(page, isTenantRadio('원본', 'DEV'), '원본 그룹 DEV');
  steps.sourceTab = n1.presses;
  const a = await arrow(page, w, 'ArrowDown');
  expectFocus(a, '원본', 'PRD', '원본 ArrowDown');
  const b = await arrow(page, w, 'ArrowUp');
  expectFocus(b, '원본', 'DEV', '원본 ArrowUp');
  steps.source = [a, b].map((s) => ({ key: s.key, t1: pickInfo(s.t1), t2: pickInfo(s.t2), source: s.sourceSelected, target: s.targetSelected }));
  const n2 = await keysTo(page, isTenantRadio('대상', 'PRD'), '대상 그룹 PRD');
  steps.targetTab = n2.presses;
  steps.target = [];
  if (targetName === 'PRD') {
    const c = await arrow(page, w, 'ArrowUp');
    expectFocus(c, '대상', 'DEV', '대상 ArrowUp');
    steps.sameNoticeAfterTargetUp = await routeDialog(page).getByRole('alert').filter({ hasText: '원본과 대상이 같습니다' }).count();
    steps.applyDisabledWhenSame = await applyRouteBtn(page).isDisabled();
    const d = await arrow(page, w, 'ArrowDown');
    expectFocus(d, '대상', 'PRD', '대상 ArrowDown');
    steps.target = [c, d].map((s) => ({ key: s.key, t1: pickInfo(s.t1), t2: pickInfo(s.t2), target: s.targetSelected }));
  } else {
    const c = await arrow(page, w, 'ArrowDown');
    expectFocus(c, '대상', targetName, `대상 ArrowDown(${targetName})`);
    expect(c.targetSelected).toEqual([targetName]);
    expect(c.sourceSelected, '원본 DEV 유지').toEqual(['DEV']);
    steps.target = [{ key: c.key, t1: pickInfo(c.t1), t2: pickInfo(c.t2), target: c.targetSelected }];
  }
  steps.applyTab = (await keysTo(page, isBtn('이 경로 사용'), '"이 경로 사용" 버튼')).presses;
  await page.keyboard.press('Enter');
  await expect(routeDialog(page)).toHaveCount(0);
  await expect(routeBar(page)).toContainText(`DEV → ${targetName}`);
  await expect(pkgChecks(page).first()).toBeVisible();
  // 20261118 S3(REQ-620): 패키지는 체크박스마다 Tab 정지이고 Space로 체크한다.
  const n3 = await keysTo(page, (i) => i.tag === 'INPUT' && i.type === 'checkbox' && i.group === '패키지 목록' && /PkgTransportDemo/.test(i.name), '패키지 목록 PkgTransportDemo 체크박스', 'Tab', 60);
  steps.packageTab = n3.presses;
  steps.packageEntry = pickInfo(n3.info);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const fin = await active(page);
  steps.packageKeys = { afterSpace: pickInfo(fin) };
  expect(fin.name, '키보드로 선택한 패키지').toMatch(/PkgTransportDemo/);
  expect(fin.checked).toBe(true);
  steps.selectedPackage = await checkedLabels(pkgChecks(page));
  steps.nextTab = (await keysTo(page, isBtn('다음'), '"다음" 버튼')).presses;
  await page.keyboard.press('Enter');
  await expect(artifactGrid(page)).toBeVisible();
  // 아티팩트는 건드리지 않는다(처음엔 모두 선택 = 패키지 전체, REQ-621)
  steps.checkedArtifacts = await selectedArtifacts(page);
  const n4 = await keysTo(page, isBtn('미리보기 실행'), '"미리보기 실행" 버튼', 'Tab', 60);
  steps.buttonTab = n4.presses;
  steps.buttonDisabled = n4.info.disabled;
  return steps;
}

// ---------------------------------------------------------------- 가벼운 옛 명칭 검사 (호버·포커스 스윕용)
export async function quickOldTermCount(page: Page): Promise<number> {
  const t = await page.evaluate(() => {
    const parts: string[] = [document.body.innerText];
    document.querySelectorAll('[title],[aria-label],[role=tooltip],[aria-description]').forEach((e) => {
      parts.push(`${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('aria-description') ?? ''} ${e.textContent ?? ''}`);
    });
    return parts.join('\n');
  });
  return Math.max(findAll(norm(t, 'NFC'), OLD_TERM).length, findAll(norm(t, 'NFKC'), OLD_TERM).length);
}
/** 보이는 상호작용 요소를 최대 max개 호버하고 키보드 포커스를 둔 뒤 100ms 뒤 옛 명칭을 센다. */
export async function hoverFocusSweep(page: Page, state: string, max = 80): Promise<{ state: string; elements: number; visited: number; hits: number; ctx: string[] }> {
  const sel = 'button, input[type=radio], input[type=checkbox], [role=switch], [role=tab], [title], [role=radio], [role=checkbox]';
  const all = page.locator(sel);
  const total = await all.count();
  let visited = 0;
  let hits = 0;
  const ctx: string[] = [];
  for (let i = 0; i < Math.min(total, max); i++) {
    const el = all.nth(i);
    try {
      if (!(await el.isVisible())) continue;
      await el.hover({ timeout: 1500 });
      await page.waitForTimeout(100);
      const a = await quickOldTermCount(page);
      await el.focus({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(60);
      const b = await quickOldTermCount(page);
      visited++;
      if (a + b > 0) {
        hits += a + b;
        ctx.push(`#${i} ${(await el.evaluate((e: any) => e.outerHTML.slice(0, 120))) as string}`);
      }
    } catch {
      /* 가려졌거나 사라진 요소는 건너뜀 */
    }
  }
  return { state, elements: total, visited, hits, ctx };
}
/** 정적 번들 스캔 (H-10): GET / 의 script·link 자산을 모두 읽어 옛 명칭을 센다. */
export async function bundleScan(request: any): Promise<{ assets: Array<{ url: string; bytes: number; nfc: number; nfkc: number; ctx: string[] }>; total: number }> {
  const index = await request.get(`${APP}/`);
  const html = await index.text();
  const urls = new Set<string>();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^https?:\/\//.test(u) && !u.startsWith(APP)) continue;
    urls.add(u.startsWith('http') ? u : APP + (u.startsWith('/') ? u : '/' + u));
  }
  const assets: Array<{ url: string; bytes: number; nfc: number; nfkc: number; ctx: string[] }> = [{ url: `${APP}/`, bytes: html.length, nfc: findAll(norm(html, 'NFC'), OLD_TERM).length, nfkc: findAll(norm(html, 'NFKC'), OLD_TERM).length, ctx: [] }];
  for (const u of urls) {
    const r = await request.get(u);
    const body = await r.text();
    const t = norm(body, 'NFC');
    const hits = findAll(t, OLD_TERM);
    assets.push({ url: u, bytes: body.length, nfc: hits.length, nfkc: findAll(norm(body, 'NFKC'), OLD_TERM).length, ctx: hits.slice(0, 5).map((h) => t.slice(Math.max(0, h.i - 60), h.i + h.len + 60).replace(/\s+/g, ' ')) });
  }
  return { assets, total: assets.reduce((a, x) => a + Math.max(x.nfc, x.nfkc), 0) };
}
