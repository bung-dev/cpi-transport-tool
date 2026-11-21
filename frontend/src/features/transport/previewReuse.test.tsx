import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TenantsResponse, TenantStatusResponse, TransportHistoryEntry, TransportRequest } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, packagesOf, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import { artifactRow, postBodies, stepButton, toArtifacts } from '../../test/wizard';
import { TransportResult } from '../result/TransportResult';

// 20261121-perf-retry S4, REQ-902 화면:
// 미리보기 뒤 같은 마법사의 실제 이관(결과의 "이 구성으로 실제 이관"과 3단계 "실제 이관 실행", 사람 결정 2026-11-21)은
// 직전 미리보기의 transportId를 previewId로 보낸다. 확인창에 '저장'만 한 수정 안내가 보인다.
// 결과 카드에 묶음을 재사용한 iFlow는 "미리보기 묶음 사용"이 보인다.
afterEach(() => vi.unstubAllGlobals());

const NOTICE = "미리보기 뒤 CPI에서 '저장'만 한 수정은 버전이 같아 반영되지 않을 수 있습니다. 그럴 때는 미리보기를 다시 실행하세요";
const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'DEV', name: '개발', source: 'env', apiHost: 'dev.localhost', createdAt: null },
    { id: 'PRD', name: '운영', source: 'env', apiHost: 'prd.localhost', createdAt: null },
  ],
};
const status: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) };

function setup() {
  const fn = mockApi(baseRoutes({
    'GET /tenants': () => json(TENANTS),
    'GET /tenants/status': () => json(status),
    'GET /templates': () => json([]),
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo': () => json([{ packageId: 'PkgTransportDemo', exists: true }]),
    'POST /transport': (init) => json(respondTo(JSON.parse(init?.body as string) as TransportRequest)),
  }));
  renderAt('#/transport');
  return fn;
}
async function preview() {
  await toArtifacts();
  await userEvent.click(artifactRow('IF_Order_Sync'));
  await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
  return screen.findByRole('region', { name: '이관 결과' });
}
const dialog = () => screen.getByRole('dialog', { name: '실제 이관 확인' });
async function run() {
  const button = within(dialog()).getByRole('button', { name: '실행' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

describe('미리보기 묶음 재사용 화면', () => {
  it('REQ-902: 결과의 "이 구성으로 실제 이관"은 확인창에 저장만 한 수정 안내를 보이고 previewId(미리보기 transportId)를 보낸다', async () => {
    const fn = setup();
    const region = await preview();
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    expect(dialog()).toHaveTextContent(NOTICE);
    await run();
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)[0]).not.toHaveProperty('previewId');
    expect(postBodies(fn)[1]).toMatchObject({ dryRun: false, previewId: 't-dry' });
  });

  it('REQ-902: 3단계 "실제 이관 실행"도 같은 안내를 보이고 previewId를 보낸다', async () => {
    const fn = setup();
    await preview();
    await userEvent.click(stepButton('실제 이관'));
    await userEvent.click(screen.getByRole('button', { name: '실제 이관 실행' }));
    expect(dialog()).toHaveTextContent(NOTICE);
    await run();
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)[1]).toMatchObject({ dryRun: false, previewId: 't-dry' });
  });
});

describe('결과 카드의 묶음 재사용 표시', () => {
  const art = (artifactId: string, reusedPreview: boolean | undefined): ArtifactResult => ({
    artifactId, status: 'SUCCESS', action: 'UPDATED', deployStatus: 'NOT_REQUESTED', error: null, configurations: [], grade: 'SUCCESS',
    ...(reusedPreview === undefined ? {} : { reusedPreview }),
  });
  const entry = (results: ArtifactResult[]): TransportHistoryEntry => ({
    transportId: 't-reuse', packages: packagesOf('PkgTransportDemo'), dryRun: false, deploy: false,
    startedAt: '2026-11-21T01:00:00Z', finishedAt: '2026-11-21T01:00:02Z',
    summary: { total: results.length, succeeded: results.length, failed: 0, fixRequired: 0, retryable: 0, skipped: 0 }, results,
  });
  const card = (artifactId: string) => screen.getByRole('button', { name: artifactId }).closest('h4')!.parentElement!.parentElement!;

  it('REQ-902: reusedPreview가 true인 iFlow 카드에만 "미리보기 묶음 사용"이 보인다(false·없음은 없음)', () => {
    render(<TransportResult result={entry([art('A_Reused', true), art('B_Fresh', false), art('C_Old', undefined)])} />);
    expect(within(card('A_Reused')).getByText('미리보기 묶음 사용')).toBeInTheDocument();
    expect(within(card('B_Fresh')).queryByText('미리보기 묶음 사용')).toBeNull();
    expect(within(card('C_Old')).queryByText('미리보기 묶음 사용')).toBeNull();
  });
});
