// 묶음 s12 — 20261117-remove-value-mapping S2(REQ-510~512): 결과 카드의 구성 값 표와 "구성 값 문제 N건".
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 로컬 스텁만 쓴다(구성 값은 원본에서만 읽고 대상에 PUT한다).
import { expect, test } from '@playwright/test';
import { after, R, shot, stubReset } from '../../lib/qa';
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

test('QA-REQ512-1: 미리보기는 복사 예정·빈 값이라 건너뜀, 실제 이관은 복사됨을 구성 값 표로 보인다', async ({ page, request }) => {
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
  expect(previewText).toContain('빈 값이라 건너뜀');
  expect(previewText).not.toMatch(/치환|매핑되지 않은 키/);
  await expect(region.getByRole('row').filter({ hasText: 'ClientPassword' }).first()).toContainText('dummy-dev-pass-XYZ');
  await shot(page, 'QA-REQ512-1-preview');

  await realFromResult(page).click();
  const real = await confirmDialogRun(page);
  expect(real.status).toBe(200);
  await expect(resultRegion(page).first()).toBeVisible();
  await expandAll(page);
  const realText = flat(await resultRegion(page).first().innerText());
  rec.real = realText.slice(0, 2000);
  expect(realText).toContain('복사됨');
  expect(realText).toContain('구성 값 문제 0건');
  expect(realText).not.toMatch(/치환|매핑되지 않은 키/);
  await shot(page, 'QA-REQ512-1-real');

  // REQ-510 화면 폭: 375px에서 페이지가 가로로 넘치지 않는다(긴 값은 줄바꿈).
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  rec.overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, 'QA-REQ512-1-375');
  expect(rec.overflow375, '375px 가로 넘침 없음').toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-REQ512-3: 이력에서 다시 연 결과와 새로고침 뒤에도 구성 값이 보이고, 구성 값 읽기 실패 카드는 구성 값 없음을 보인다', async ({ page, request }) => {
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
  const check = async (label: string) => {
    await expect(resultRegion(page).first()).toBeVisible();
    await expandAll(page);
    const region = resultRegion(page).first();
    const text = flat(await region.innerText());
    rec[label] = text.slice(0, 1500);
    expect(text, `${label}: 구성 값 읽기 실패 카드`).toMatch(/IF_Fault_ConfigRead500.*CONFIGURATION_READ_FAILED.*구성 값 없음/);
    await expect(region.getByRole('row').filter({ hasText: 'ParamA' }).first()).toContainText('a-dev');
    await expect(region.getByRole('row').filter({ hasText: 'ParamA' }).first()).toContainText('실패');
    await expect(region.getByRole('row').filter({ hasText: 'ParamB' }).first()).toContainText('복사됨');
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

test('QA-REQ512-2:구성 값 PUT 실패는 실패 행과 구성 값 문제 1건 이상으로 보인다', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ512-2');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  await choosePackage(page, 'PkgFaultDemo');
  await selectArtifacts(page, ['IF_Fault_ParamPutFail']);
  const preview = await runPreview(page);
  expect(preview.status).toBe(200);
  await realFromResult(page).click();
  const real = await confirmDialogRun(page);
  rec.api = { http: real.status, results: (real.body?.results ?? []).map((r: any) => ({ id: r.artifactId, status: r.status, code: r.error?.code ?? null, configurations: r.configurations })) };
  expect(real.status).toBe(200);
  const region = resultRegion(page).first();
  await expect(region).toBeVisible();
  const text = flat(await region.innerText());
  rec.text = text.slice(0, 2000);
  const m = text.match(/구성 값 문제 (\d+)건/);
  expect(m, '"구성 값 문제 N건" 표시').not.toBeNull();
  expect(Number(m![1]), '구성 값 문제 1건 이상').toBeGreaterThanOrEqual(1);
  await expect(region.getByRole('row').filter({ hasText: 'ParamA' }).first()).toContainText('실패');
  await expect(region.getByRole('row').filter({ hasText: 'ParamB' }).first()).toContainText('복사됨');
  await shot(page, 'QA-REQ512-2');
  expect(w.errors).toEqual([]);
});
