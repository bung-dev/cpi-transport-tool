// 묶음 s12 — 20261118-package-autocreate-multi S3(REQ-624): 여러 패키지 이관과 대상 패키지 자동 생성을 화면으로 확인한다.
// 앱: app-rw(DEV·PRD env, 쓰기 허용). 로컬 스텁만 쓴다(실제 SAP CPI 연동 확인이 아니다).
// 스텁(REQ-606): PkgTransportDemo는 PRD에 있다. PkgNotInPrd·PkgCreateFail은 PRD에 없고, 만들기 요청은 PkgNotInPrd만 성공(201)하고
// PkgCreateFail은 실패(500)한다. PkgSapStandard는 SAP 제공(Mode READ_ONLY)이라 목록에 없다.
import { expect, test, type Page } from '@playwright/test';
import { after, R, shot, stubReset } from '../../lib/qa';
import { confirmDialog, foreignHosts, openTab, openTransport, packageIds, pickPackage, pkgChecks, realFromResult, resultRegion, runPreview, stepBtn, waitTransport, watch } from '../../lib/ui';

test.use({ actionTimeout: 20000 });

test.afterEach(async ({ request }) => {
  await after(request);
});

/** 결과 화면의 패키지 묶음(role=group, 접근 이름에 패키지 ID) */
const group = (page: Page, id: string) => resultRegion(page).first().getByRole('group', { name: new RegExp(id) });
/** 아티팩트 단계의 패키지 묶음(role=region, 접근 이름에 패키지 ID) */
const section = (page: Page, id: string) => page.getByRole('region', { name: new RegExp(id) });
const BADGES = ['있음', '새로 만듦', '생성 실패', '대상에 없음', '확인 실패'];

/** 두 패키지를 골라 아티팩트 단계 → 미리보기 → 확인창 열기 */
async function previewAndOpenConfirm(page: Page, ids: [string, string]) {
  for (const id of ids) await pickPackage(page, id);
  await expect(stepBtn(page, '패키지')).toContainText('외 1개');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  for (const id of ids) await expect(section(page, id).getByRole('grid', { name: '이관할 아티팩트' })).toBeVisible();
  const preview = await runPreview(page);
  expect(preview.status).toBe(200);
  expect(preview.postData.packages.map((p: any) => p.packageId)).toEqual(ids);
  expect(preview.postData).not.toHaveProperty('createPackages');
  // 미리보기는 대상 패키지 상태 배지가 없다
  for (const id of ids) {
    const text = await group(page, id).innerText();
    for (const b of BADGES) expect(text, `미리보기 ${id} 배지 ${b} 없음`).not.toContain(b);
  }
  await realFromResult(page).click();
  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  return { preview, dialog };
}

test('QA-REQ624-1: 대상에 있는 패키지와 없는 패키지를 함께 옮기면 확인창이 "새로 만듦"을 보이고, 실행하면 만들어지며 결과·이력에 묶음 배지가 남는다', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ624-1');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  rec.packages = await packageIds(page);
  expect(rec.packages, 'SAP 제공 패키지는 목록에 없다(REQ-605)').not.toContain('PkgSapStandard');
  expect(rec.packages).toEqual(expect.arrayContaining(['PkgTransportDemo', 'PkgNotInPrd', 'PkgCreateFail']));

  const { dialog } = await previewAndOpenConfirm(page, ['PkgTransportDemo', 'PkgNotInPrd']);
  const items = dialog.getByRole('list', { name: '대상 패키지' });
  await expect(items.getByRole('listitem', { name: /PkgTransportDemo/ })).toContainText('있음');
  await expect(items.getByRole('listitem', { name: /PkgNotInPrd/ })).toContainText('대상에 없음 → 새로 만듦');
  await expect(dialog).toContainText('패키지 1개를 대상에 새로 만듭니다. 이관이 실패해도 만든 패키지는 남습니다');
  await shot(page, 'QA-REQ624-1-confirm');
  const run = dialog.getByRole('button', { name: '실행', exact: true });
  await expect(run).toBeEnabled();
  const real = await waitTransport(page, async () => { await run.click(); });
  rec.request = real.postData;
  rec.response = { status: real.status, packages: real.body?.packages, summary: real.body?.summary };
  expect(real.status).toBe(200);
  expect(real.postData.createPackages).toEqual(['PkgNotInPrd']);
  expect(real.body.packages.map((p: any) => [p.packageId, p.targetPackage])).toEqual([['PkgTransportDemo', 'EXISTING'], ['PkgNotInPrd', 'CREATED']]);
  expect(real.body.summary.failed, '모든 아티팩트 성공').toBe(0);
  const id = real.body.transportId as string;

  const check = async (label: string) => {
    await expect(group(page, 'PkgTransportDemo')).toContainText('있음');
    await expect(group(page, 'PkgNotInPrd')).toContainText('새로 만듦');
    await expect(group(page, 'PkgTransportDemo').getByRole('heading', { level: 4, name: 'IF_Order_Sync' })).toBeVisible();
    await expect(group(page, 'PkgNotInPrd').getByRole('heading', { level: 4, name: 'IF_Orphan' })).toBeVisible();
    rec[label] = (await resultRegion(page).first().innerText()).slice(0, 1500);
  };
  await check('result');
  await shot(page, 'QA-REQ624-1-result');
  await openTab(page, '이력');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: id, exact: true }) });
  await expect(row).toContainText('Transport Demo 외 1개');
  await page.getByRole('button', { name: id, exact: true }).click();
  await check('history');
  await page.reload();
  await openTab(page, '이력');
  await page.getByRole('button', { name: id, exact: true }).click();
  await check('historyAfterReload');
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-REQ624-2: 만들기 실패 패키지는 "생성 실패"와 "패키지 생성 실패" 오류를 보이고 다른 패키지는 성공한다. 375px에서 넘치지 않는다', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ624-2');
  const w = watch(page);
  await stubReset(request);
  await openTransport(page);
  const { dialog } = await previewAndOpenConfirm(page, ['PkgTransportDemo', 'PkgCreateFail']);
  await expect(dialog.getByRole('list', { name: '대상 패키지' }).getByRole('listitem', { name: /PkgCreateFail/ })).toContainText('대상에 없음 → 새로 만듦');
  const run = dialog.getByRole('button', { name: '실행', exact: true });
  await expect(run).toBeEnabled();
  const real = await waitTransport(page, async () => { await run.click(); });
  rec.response = { status: real.status, packages: real.body?.packages, results: (real.body?.results ?? []).map((r: any) => `${r.packageId}/${r.artifactId}:${r.status}:${r.error?.code ?? ''}`) };
  expect(real.status).toBe(200);
  expect(real.postData.createPackages).toEqual(['PkgCreateFail']);
  expect(real.body.packages.map((p: any) => [p.packageId, p.targetPackage])).toEqual([['PkgTransportDemo', 'EXISTING'], ['PkgCreateFail', 'CREATE_FAILED']]);
  const byPkg = (pid: string) => real.body.results.filter((r: any) => r.packageId === pid);
  expect(byPkg('PkgTransportDemo').every((r: any) => r.status === 'SUCCESS'), '다른 패키지는 성공').toBe(true);
  expect(byPkg('PkgCreateFail').every((r: any) => r.status === 'FAILED' && r.error?.code === 'PACKAGE_CREATE_FAILED')).toBe(true);

  const failGroup = group(page, 'PkgCreateFail');
  await expect(failGroup).toContainText('생성 실패');
  await expect(failGroup).toContainText('패키지 생성 실패');
  await expect(failGroup).toContainText('PACKAGE_CREATE_FAILED');
  await expect(group(page, 'PkgTransportDemo')).toContainText('있음');
  await shot(page, 'QA-REQ624-2-result');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  rec.overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, 'QA-REQ624-2-375');
  expect(rec.overflow375, '375px 가로 넘침 없음').toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});

test('QA-REQ624-3: 검색으로 보이는 패키지만 전체 선택하고 검색을 지워도 선택이 유지되며, 확인창은 패키지마다 대상 상태를 보인다(데스크톱·375px)', async ({ page, request }) => {
  test.setTimeout(240000);
  const rec = R('QA-REQ624-3');
  const w = watch(page);
  await stubReset(request);
  for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
    await page.setViewportSize(vp);
    await openTransport(page);
    const search = page.getByLabel('패키지 검색');
    const selectAll = page.getByRole('button', { name: '전체 선택', exact: true });
    await search.fill('zzzz-none');
    await expect(selectAll, '검색 결과 0개면 전체 선택 비활성').toBeDisabled();
    await search.fill('Demo');
    await selectAll.click();
    await search.fill('');
    await expect(page.getByText('3개 선택', { exact: true })).toBeVisible();
    const checked = await pkgChecks(page).evaluateAll((es) => es.filter((e: any) => e.checked).map((e: any) => (e.labels?.[0]?.textContent || '').trim()));
    rec[`checked-${label}`] = checked;
    expect(checked.map((n) => (n.match(/(Pkg[A-Za-z]+)/) || [, n])[1])).toEqual(['PkgTransportDemo', 'PkgFaultDemo', 'PkgCreateFail']);
    await expect(stepBtn(page, '패키지')).toContainText('외 2개');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    for (const id of ['PkgTransportDemo', 'PkgFaultDemo', 'PkgCreateFail'])
      await expect(section(page, id).getByRole('grid', { name: '이관할 아티팩트' })).toBeVisible();
    const preview = await runPreview(page);
    expect(preview.status).toBe(200);
    await realFromResult(page).click();
    const dialog = confirmDialog(page);
    const run = dialog.getByRole('button', { name: '실행', exact: true });
    await expect(run).toBeEnabled();
    const items = dialog.getByRole('list', { name: '대상 패키지' });
    await expect(items.getByRole('listitem', { name: /PkgTransportDemo/ })).toContainText('있음');
    await expect(items.getByRole('listitem', { name: /PkgFaultDemo/ })).toContainText('있음');
    await expect(items.getByRole('listitem', { name: /PkgCreateFail/ })).toContainText('대상에 없음 → 새로 만듦');
    await expect(dialog.getByRole('switch')).not.toBeChecked();
    rec[`overflow-${label}`] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(rec[`overflow-${label}`], `${label} 가로 넘침 없음`).toBeLessThanOrEqual(0);
    await shot(page, `QA-REQ624-3-confirm-${label}`);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(w.errors).toEqual([]);
  expect(foreignHosts(w)).toEqual([]);
});
