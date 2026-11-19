// 묶음 s12 — 20261117-remove-value-mapping S2(REQ-510~512): 결과 카드의 구성 값 표와 "구성 값 문제 N건".
// 20261119-transport-speedup S3(REQ-707): 실제 이관은 구성 값을 PUT하지 않고 "iFlow와 함께 옮겨짐"으로 보인다.
// 예전 이력(복사됨·빈 값이라 건너뜀·실패)은 그대로 보인다.
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 로컬 스텁만 쓴다.
import * as fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { after, historyFile, R, shot, stubCount, stubReset } from '../../lib/qa';
import { choosePackage, confirmDialogRun, foreignHosts, openTab, openTransport,realFromResult, resultRegion, runPreview, selectArtifacts, watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });

test.afterEach(async ({ request }) => {
  await after(request);
});

const flat = (s: string) => s.replace(/\s+/g, ' ');
const expandAll = async (page: import('@playwright/test').Page) => {
  const all = resultRegion(page).first().getByRole('button', { name: '모두 펼치기', exact: true });
  if (await all.isEnabled()) await all.click();
};
const BUNDLED = 'iFlow와 함께 옮겨짐';
const CONFIG_PUT = ".*/\\$links/Configurations.*";

test('QA-REQ512-1: 미리보기는 빈 값까지 모두 복사 예정, 실제 이관은 iFlow와 함께 옮겨짐을 구성 값 표로 보이고 구성 값 PUT은 없다', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ512-1');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  await choosePackage(page, 'PkgTransportDemo');
  await page.getByRole('button', { name: '전체 선택', exact: true }).click();
  const preview = await runPreview(page);
  expect(preview.status).toBe(200);
  await expandAll(page);
  const region = resultRegion(page).first();
  const previewText = flat(await region.innerText());
  rec.preview = previewText.slice(0, 2000);
  expect(previewText).toContain('구성 값');
  expect(previewText).toContain('복사 예정');
  // REQ-701: 빈 민감 값 예외가 없어져 ApiToken(빈 값)도 복사 예정이다.
  expect(previewText).not.toContain('빈 값이라 건너뜀');
  await expect(region.getByRole('row').filter({ hasText: 'ApiToken' }).first()).toContainText('복사 예정');
  expect(previewText).not.toMatch(/치환|매핑되지 않은 키/);
  await expect(region.getByRole('row').filter({ hasText: 'ClientPassword' }).first()).toContainText('dummy-dev-pass-XYZ');
  await shot(page, 'QA-REQ512-1-preview');

  await realFromResult(page).click();
  const real = await confirmDialogRun(page);
  expect(real.status).toBe(200);
  await expect(resultRegion(page).first()).toBeVisible();
  await expandAll(page);
  const realRegion = resultRegion(page).first();
  const realText = flat(await realRegion.innerText());
  rec.real = realText.slice(0, 2000);
  expect(realText).toContain(BUNDLED);
  expect(realText).not.toContain('복사됨');
  expect(realText).toContain('구성 값 문제 0건');
  expect(realText).not.toMatch(/치환|매핑되지 않은 키/);
  for (const key of ['Endpoint', 'ApiToken', 'ClientPassword', 'LogLevel'])
    await expect(realRegion.getByRole('row').filter({ hasText: key }).first(), key).toContainText(BUNDLED);
  rec.configurationPuts = await stubCount(request, 18082, 'PUT', CONFIG_PUT);
  expect(rec.configurationPuts, '대상 구성 값 PUT 0회(REQ-701)').toBe(0);
  await shot(page, 'QA-REQ512-1-real');

  // REQ-510, REQ-707 화면 폭: 375px에서 페이지가 가로로 넘치지 않는다(긴 값은 줄바꿈).
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  rec.overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, 'QA-REQ512-1-375');
  expect(rec.overflow375, '375px 가로 넘침 없음').toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-REQ512-3: 이력에서 다시 연 결과와 새로고침 뒤에도 구성 값이 보이고, 구성 값 읽기 실패 카드는 구성 값 없음, ParamPutFail은 성공한다', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ512-3');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  await choosePackage(page, 'PkgFaultDemo');
  await selectArtifacts(page, ['IF_Fault_ConfigRead500', 'IF_Fault_ParamPutFail']);
  await runPreview(page);
  await realFromResult(page).click();
  const real = await confirmDialogRun(page);
  expect(real.status).toBe(200);
  const id = real.body.transportId as string;
  const put = (real.body.results as any[]).find((r) => r.artifactId === 'IF_Fault_ParamPutFail');
  rec.api = { status: put?.status, code: put?.error?.code ?? null };
  expect(put?.status, 'REQ-702: ParamPutFail은 구성 값 PUT이 없어 성공').toBe('SUCCESS');
  const check = async (label: string) => {
    await expect(resultRegion(page).first()).toBeVisible();
    await expandAll(page);
    const region = resultRegion(page).first();
    const text = flat(await region.innerText());
    rec[label] = text.slice(0, 1500);
    expect(text, `${label}: 구성 값 읽기 실패 카드`).toMatch(/IF_Fault_ConfigRead500.*CONFIGURATION_READ_FAILED.*구성 값 없음/);
    await expect(region.getByRole('row').filter({ hasText: 'ParamA' }).first()).toContainText('a-dev');
    await expect(region.getByRole('row').filter({ hasText: 'ParamA' }).first()).toContainText(BUNDLED);
    await expect(region.getByRole('row').filter({ hasText: 'ParamB' }).first()).toContainText(BUNDLED);
  };
  await check('result');
  await openTab(page, '이력');
  await page.getByRole('button', { name: id, exact: true }).click();
  await check('history');
  await page.reload();
  await openTab(page, '이력');
  await page.getByRole('button', { name: id, exact: true }).click();
  await check('historyAfterReload');
  await shot(page, 'QA-REQ512-3');
  expect(w.errors).toEqual([]);
});

test('QA-REQ707-1: 예전 이력의 복사됨·빈 값이라 건너뜀·실패는 지금처럼 보이고 실패만 구성 값 문제로 센다(375px 넘침 없음)', async ({ page }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ707-1');
  const w = watch(page);
  const id = `legacy-707-${Date.now()}`;
  const legacy = {
    transportId: id,
    packages: [{ packageId: 'PkgLegacy707', packageName: 'Legacy 707', targetPackage: 'EXISTING' }],
    dryRun: false, deploy: false,
    startedAt: '2026-11-01T01:00:00Z', finishedAt: '2026-11-01T01:00:05Z',
    summary: { total: 1, succeeded: 0, failed: 1 },
    results: [{
      packageId: 'PkgLegacy707', artifactId: 'IF_Legacy_707', status: 'FAILED', action: 'UPDATED',
      configurations: [
        { key: 'LegacyCopied', value: 'copied-dev', dataType: 'xsd:string', status: 'COPIED' },
        { key: 'LegacyPassword', value: '', dataType: 'xsd:string', status: 'SKIPPED_EMPTY' },
        { key: 'LegacyFailed', value: 'failed-dev', dataType: 'xsd:string', status: 'FAILED' },
      ],
      deployStatus: 'NOT_REQUESTED',
      error: { code: 'CONFIGURATION_UPDATE_FAILED', message: 'CONFIGURATION_UPDATE: LegacyFailed: HTTP 500' },
    }],
    sourceTenant: { id: 'DEV', name: 'DEV' }, targetTenant: { id: 'PRD', name: 'PRD' },
  };
  const file = historyFile();
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + JSON.stringify(legacy) + '\n', 'utf8');

  await page.goto('/#/history');
  await page.getByRole('button', { name: id, exact: true }).click();
  const region = resultRegion(page).first();
  await expect(region).toBeVisible();
  await expandAll(page);
  const text = flat(await region.innerText());
  rec.text = text.slice(0, 1500);
  await expect(region.getByRole('row').filter({ hasText: 'LegacyCopied' }).first()).toContainText('복사됨');
  await expect(region.getByRole('row').filter({ hasText: 'LegacyPassword' }).first()).toContainText('빈 값이라 건너뜀');
  await expect(region.getByRole('row').filter({ hasText: 'LegacyFailed' }).first()).toContainText('실패');
  expect(text).toContain('구성 값 문제 1건');
  expect(text).not.toContain(BUNDLED);
  await shot(page, 'QA-REQ707-1');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  rec.overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, 'QA-REQ707-1-375');
  expect(rec.overflow375, '375px 가로 넘침 없음').toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});
