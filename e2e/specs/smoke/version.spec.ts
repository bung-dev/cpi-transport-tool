// 20261120-versioning S2: REQ-002 GET /version, REQ-003 기동 로그 한 줄, REQ-004 화면 아래 버전 표시(데스크톱·모바일 폭)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

async function version(request: import('@playwright/test').APIRequestContext) {
  const r = await request.get('/version');
  expect(r.status(), 'GET /version 상태').toBe(200);
  const body = await r.json();
  expect(Object.keys(body).sort()).toEqual(['buildTime', 'commit', 'version']);
  expect(body.commit).toMatch(/^([0-9a-f]{7}|unknown)$/);
  return body as { version: string; commit: string; buildTime: string | null };
}

test('REQ-002·REQ-003: 기동 로그에 버전 줄이 한 번, GET /version과 같은 값으로 남는다', async ({ request }) => {
  const v = await version(request);
  const log = readFileSync(process.env.QA_APP_LOG as string, 'utf8');
  const lines = log.split(/\r?\n/).filter((l) => l.includes('CPI Transport Tool '));
  expect(lines, lines.join('\n')).toHaveLength(1);
  expect(lines[0]).toContain(`CPI Transport Tool ${v.version} (커밋 ${v.commit}, 빌드 ${v.buildTime})`);
});

for (const [label, size] of [['데스크톱', { width: 1280, height: 800 }], ['모바일', { width: 375, height: 812 }]] as const) {
  test(`REQ-004: ${label} 폭에서 화면 아래 footer가 GET /version 값을 보이고 가로 스크롤이 없다`, async ({ page, request }) => {
    const v = await version(request);
    const expected = `${v.version === 'dev' ? '' : 'v'}${v.version} · ${v.commit}`;
    await page.setViewportSize(size);
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveText(expected);
    await page.goto('/#/settings');
    await expect(footer).toHaveText(expected);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await footer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.QA_ARTIFACT_DIR!, `version-footer-${size.width}.png`) });
  });
}
