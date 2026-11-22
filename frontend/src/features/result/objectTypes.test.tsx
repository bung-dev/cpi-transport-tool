import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, ArtifactType, TransportRequest, TransportResponse } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import { TestTenantProvider } from '../../test/tenantProvider';
import { startManual, typeListUrl } from '../../test/wizard';
import { TransportResult } from './TransportResult';

// 20261121-package-objects S6 REQ-1004(결과 카드 "해당 없음")·REQ-1005(진행 items 종류, 확인창 안내)·REQ-1006(다시 이관 확인창 종류)·REQ-1007(결과의 종류 표시).
// 화면 계약(이 테스트가 정함):
// - 결과 카드(마법사 미리보기 결과, 작업 완료 화면, 이력 결과 — 모두 TransportResult)마다 종류 이름(iFlow / 스크립트 컬렉션 / 메시지 매핑 / 밸류 매핑)이
//   카드 안에 글자로 보인다. 카드 제목(h4, 접근 이름 = artifactId)에는 넣지 않는다(기존 테스트가 h4 이름으로 카드를 찾는다). `type`이 없으면(옛 이력) iFlow.
// - 패키지 묶음 안 카드와 "결과 바로가기" 목록은 처리 단계 순서(① 스크립트 컬렉션·메시지 매핑 → ② 밸류 매핑 → ③ iFlow)다. 같은 단계 안에서는 응답 순서 그대로.
// - action `REPLACED`는 동작 배지 글자 "삭제 후 다시 만듦"이다(API 값 원문 "REPLACED"는 보이지 않는다).
// - 새 종류 카드는 구성 값이 없다: 접힌 줄 "Externalized Parameters 해당 없음"(개수·문제 수 줄 대신), 펼치면 표·"Externalized Parameters 없음" 대신 "해당 없음".
// - 진행 목록(list "iFlow 진행", 이름은 지금 그대로)의 항목마다 종류 이름이 보인다. `type`이 없으면 iFlow.
// - 다시 이관 확인창 list "다시 이관할 iFlow"(이름 그대로) 항목마다 종류 이름. 확인창(실제 이관·다시 이관)에 REF_NOTICE 글자.
// - 실제 이관 확인창: 미리보기 결과에 REPLACED가 N개(1개 이상)면 "밸류 매핑 N개는 대상에서 삭제 후 다시 만듭니다". 0개면 없다.
afterEach(() => vi.unstubAllGlobals());

const REF_NOTICE = '다른 패키지의 스크립트 컬렉션·메시지 매핑을 참조하는 iFlow는 그 패키지도 옮겨야 배포됩니다';
const LABEL: Record<ArtifactType, string> = {
  INTEGRATION_FLOW: 'iFlow', SCRIPT_COLLECTION: '스크립트 컬렉션', MESSAGE_MAPPING: '메시지 매핑', VALUE_MAPPING: '밸류 매핑',
};
const PKG = 'PkgObjSet';
const art = (artifactId: string, type: ArtifactType | undefined, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  packageId: PKG, artifactId, ...(type ? { type } : {}), status: 'SUCCESS', grade: 'SUCCESS', action: 'CREATED',
  deployStatus: 'STARTED', error: null, configurations: [], ...over,
} as ArtifactResult);
const iflow = (artifactId: string, over: Partial<ArtifactResult> = {}) => art(artifactId, 'INTEGRATION_FLOW', {
  action: 'UPDATED', configurations: [{ key: 'TargetSystem', value: 'PRD_ERP', dataType: 'xsd:string', status: 'COPIED' }], ...over,
});
const LOST = {
  code: 'VALUE_MAPPING_LOST',
  message: '대상에서 밸류 매핑이 지워졌고 되살리지 못했습니다. CPI에서 직접 확인하세요',
};

function entry(results: ArtifactResult[], over: Partial<TransportResponse> & Record<string, unknown> = {}) {
  const failed = results.filter((r) => r.status === 'FAILED').length;
  return {
    transportId: 't-obj', packages: [{ packageId: PKG, packageName: 'Object Set', targetPackage: 'EXISTING' }], dryRun: false, deploy: true,
    startedAt: '2026-11-22T01:00:00Z', finishedAt: '2026-11-22T01:00:30Z',
    summary: { total: results.length, succeeded: results.length - failed, failed, fixRequired: failed, retryable: 0, skipped: 0 },
    results, sourceTenant: { id: 'DEV', name: '개발' }, targetTenant: { id: 'PRD', name: '운영' }, skipped: [],
    ...over,
  } as TransportResponse;
}
/** 카드 h4 안 접기 버튼(접근 이름 = artifactId)에서 카드 본문(머리 줄과 펼친 내용을 감싼 요소)으로 올라간다. */
const card = (artifactId: string) => screen.getByRole('button', { name: artifactId }).closest('h4')!.parentElement!.parentElement!;
const cardIds = (group: HTMLElement) => within(group).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
const navIds = () => within(screen.getByRole('navigation', { name: '결과 바로가기' })).getAllByRole('button').map((b) => b.textContent);

// 응답이 처리 단계 순서가 아니어도 화면은 단계 순서로 놓는다(같은 단계 안은 응답 순서).
const MIXED = [
  iflow('IF_Order'),
  art('VM_Codes', 'VALUE_MAPPING', { action: 'REPLACED' }),
  art('SC_Scripts', 'SCRIPT_COLLECTION'),
  art('MM_Order', 'MESSAGE_MAPPING', { action: 'UPDATED' }),
  art('VM_Lost', 'VALUE_MAPPING', { status: 'FAILED', grade: 'FIX_REQUIRED', action: 'NONE', deployStatus: 'NOT_REQUESTED', error: LOST }),
];
const STAGE_ORDER = ['SC_Scripts', 'MM_Order', 'VM_Codes', 'VM_Lost', 'IF_Order'];

describe('REQ-1007 결과 카드의 종류', () => {
  it('REQ-1007: 종류 섞인 결과는 카드마다 종류 이름이 보이고, 카드와 바로가기는 처리 단계 순서다', () => {
    render(<TransportResult result={entry(MIXED)} />, { wrapper: TestTenantProvider });
    const group = screen.getByRole('group', { name: /PkgObjSet/ });
    expect(cardIds(group)).toEqual(STAGE_ORDER);
    expect(navIds()).toEqual(STAGE_ORDER);
    for (const r of MIXED) {
      expect(card(r.artifactId), `${r.artifactId} 종류`).toHaveTextContent(LABEL[(r as { type: ArtifactType }).type]);
    }
    // 종류 이름은 카드 제목(h4)에 넣지 않는다
    expect(screen.getByRole('heading', { level: 4, name: 'SC_Scripts' })).not.toHaveTextContent('스크립트 컬렉션');
  });

  it('REQ-1007: 밸류 매핑 REPLACED는 "삭제 후 다시 만듦"으로 보이고 원문 REPLACED는 보이지 않는다', () => {
    render(<TransportResult result={entry(MIXED)} />, { wrapper: TestTenantProvider });
    expect(card('VM_Codes')).toHaveTextContent('삭제 후 다시 만듦');
    expect(screen.getByRole('region', { name: '이관 결과' })).not.toHaveTextContent('REPLACED');
    expect(card('MM_Order')).toHaveTextContent('UPDATED');
    expect(card('SC_Scripts')).toHaveTextContent('CREATED');
  });

  it('REQ-1004: 새 종류 카드는 Externalized Parameters가 "해당 없음"이고(접힘·펼침), iFlow 카드는 지금 그대로다', async () => {
    render(<TransportResult result={entry(MIXED)} />, { wrapper: TestTenantProvider });
    // 접힌 새 종류 카드
    const sc = card('SC_Scripts');
    expect(sc).toHaveTextContent('Externalized Parameters 해당 없음');
    expect(sc).not.toHaveTextContent('Externalized Parameters 0개');
    // 펼친 새 종류 카드
    await userEvent.click(screen.getByRole('button', { name: 'SC_Scripts' }));
    const opened = card('SC_Scripts');
    expect(opened).toHaveTextContent('해당 없음');
    expect(opened).not.toHaveTextContent('Externalized Parameters 없음');
    expect(within(opened).queryByRole('table')).toBeNull();
    // iFlow 카드는 지금처럼 개수 줄과 표
    expect(card('IF_Order')).toHaveTextContent('Externalized Parameters 1개 · 문제 0건');
    expect(card('IF_Order')).not.toHaveTextContent('해당 없음');
    await userEvent.click(screen.getByRole('button', { name: 'IF_Order' }));
    expect(within(card('IF_Order')).getByRole('table')).toBeInTheDocument();
  });

  it('REQ-1007: VALUE_MAPPING_LOST 오류 카드는 종류·고쳐야 함·오류 코드와 문구가 보이고 펼친 채 시작한다', () => {
    render(<TransportResult result={entry(MIXED)} />, { wrapper: TestTenantProvider });
    const lost = card('VM_Lost');
    expect(screen.getByRole('button', { name: 'VM_Lost' })).toHaveAttribute('aria-expanded', 'true');
    expect(lost).toHaveTextContent('밸류 매핑');
    expect(lost).toHaveTextContent('고쳐야 함');
    expect(lost).toHaveTextContent('VALUE_MAPPING_LOST');
    expect(lost).toHaveTextContent(LOST.message);
    expect(lost).toHaveTextContent('해당 없음');
  });

  it('REQ-1007: 옛 이력(type 없음)은 이력 결과에서 오류 없이 열리고 모든 카드가 iFlow다', async () => {
    const old = entry([
      iflow('IF_Old_A', { type: undefined }),
      iflow('IF_Old_B', { type: undefined, status: 'FAILED', grade: 'FIX_REQUIRED', error: { code: 'UPLOAD_FAILED', message: 'x' } }),
    ].map(({ type: _t, ...rest }) => rest as ArtifactResult), { transportId: 't-old' });
    mockApi(baseRoutes({ 'GET /transport/history': () => json([old]) }));
    renderAt('#/history?transportId=t-old');
    const region = await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 });
    expect(within(region).queryByRole('alert')).toBeNull();
    for (const id of ['IF_Old_A', 'IF_Old_B']) {
      expect(card(id), `${id}는 iFlow`).toHaveTextContent('iFlow');
      expect(card(id)).not.toHaveTextContent('해당 없음');
    }
  });

  it('REQ-1007: 이력 결과에서도 종류 섞인 결과가 종류·단계 순서로 보인다', async () => {
    mockApi(baseRoutes({ 'GET /transport/history': () => json([entry(MIXED, { transportId: 't-hist-obj' })]) }));
    renderAt('#/history?transportId=t-hist-obj');
    await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 });
    expect(cardIds(screen.getByRole('group', { name: /PkgObjSet/ }))).toEqual(STAGE_ORDER);
    expect(card('MM_Order')).toHaveTextContent('메시지 매핑');
  });
});

const JOB = 'job-obj';
function jobOf(res: TransportResponse, items: { artifactId: string; type?: ArtifactType; stage: string; status: string | null }[], status = 'COMPLETED') {
  return {
    jobId: JOB, status, dryRun: false, deploy: true, startedAt: res.startedAt, finishedAt: status === 'RUNNING' ? null : res.finishedAt,
    total: items.length, done: items.filter((i) => i.stage === 'DONE').length, sourceTenant: res.sourceTenant, targetTenant: res.targetTenant,
    packages: res.packages, items: items.map((i) => ({ packageId: PKG, ...i })), result: status === 'RUNNING' ? null : res,
  };
}

describe('REQ-1005 진행 화면의 종류', () => {
  it('REQ-1005: 실제 이관 진행 목록 항목마다 종류 이름이 보이고, type 없는 항목은 iFlow다', async () => {
    const res = entry(MIXED);
    mockApi(baseRoutes({
      [`GET /transport/jobs/${JOB}`]: () => json(jobOf(res, [
        { artifactId: 'SC_Scripts', type: 'SCRIPT_COLLECTION', stage: 'DONE', status: 'SUCCESS' },
        { artifactId: 'MM_Order', type: 'MESSAGE_MAPPING', stage: 'DEPLOY', status: null },
        { artifactId: 'VM_Codes', type: 'VALUE_MAPPING', stage: 'WAITING', status: null },
        { artifactId: 'IF_Order', stage: 'WAITING', status: null },
      ], 'RUNNING')),
    }));
    renderAt(`#/job?id=${JOB}`);
    const list = await screen.findByRole('list', { name: 'iFlow 진행' }, { timeout: 3000 });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('SC_Scripts');
    expect(rows[0]).toHaveTextContent('스크립트 컬렉션');
    expect(rows[0]).toHaveTextContent('완료');
    expect(rows[1]).toHaveTextContent('메시지 매핑');
    expect(rows[1]).toHaveTextContent('배포');
    expect(rows[2]).toHaveTextContent('밸류 매핑');
    expect(rows[3]).toHaveTextContent('IF_Order');
    expect(rows[3]).toHaveTextContent('iFlow');
    expect(screen.getByText('실제 이관 중 1/4')).toBeInTheDocument();
  });
});

describe('REQ-1006 다시 이관 확인창의 종류', () => {
  const retryRes = (over: Record<string, unknown> = {}) => entry([
    art('SC_Scripts', 'SCRIPT_COLLECTION', { status: 'FAILED', grade: 'FIX_REQUIRED', action: 'CREATED', deployStatus: 'ERROR', error: { code: 'DEPLOY_FAILED', message: '배포 실패' } }),
    art('VM_Lost', 'VALUE_MAPPING', { status: 'FAILED', grade: 'FIX_REQUIRED', action: 'NONE', error: LOST }),
    iflow('IF_Ok'),
  ], { jobStatus: 'CANCELLED', skipped: [{ packageId: PKG, artifactId: 'MM_Skipped', type: 'MESSAGE_MAPPING' }, { packageId: PKG, artifactId: 'IF_Skipped' }], ...over } as never);

  it('REQ-1006: 확인창 목록 항목마다 종류 이름이 보이고(type 없는 건너뜀은 iFlow), 다른 패키지 참조 안내가 있다', async () => {
    const res = retryRes();
    mockApi(baseRoutes({ [`GET /transport/jobs/${JOB}`]: () => json(jobOf(res, [])) }));
    renderAt(`#/job?id=${JOB}`);
    await userEvent.click(await screen.findByRole('button', { name: '실패한 4개 다시 이관' }, { timeout: 3000 }));
    const d = screen.getByRole('dialog', { name: '실패분 다시 이관' });
    const items = within(within(d).getByRole('list', { name: '다시 이관할 iFlow' })).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('SC_Scripts');
    expect(items[0]).toHaveTextContent('스크립트 컬렉션');
    expect(items[0]).toHaveTextContent('고쳐야 함');
    expect(items[1]).toHaveTextContent('VM_Lost');
    expect(items[1]).toHaveTextContent('밸류 매핑');
    expect(items[2]).toHaveTextContent('MM_Skipped');
    expect(items[2]).toHaveTextContent('메시지 매핑');
    expect(items[2]).toHaveTextContent('건너뜀');
    expect(items[3]).toHaveTextContent('IF_Skipped');
    expect(items[3]).toHaveTextContent('iFlow');
    expect(d).toHaveTextContent(REF_NOTICE);
  });

  it('REQ-1006: 옛 이력(type 없음) 다시 이관 확인창은 모두 iFlow로 보인다', async () => {
    const old = entry([iflow('IF_Fix', { status: 'FAILED', grade: 'FIX_REQUIRED', error: { code: 'UPLOAD_FAILED', message: 'x' } })]
      .map(({ type: _t, ...rest }) => rest as ArtifactResult), { transportId: 't-old-retry', skipped: [{ packageId: PKG, artifactId: 'IF_Skip' }] } as never);
    mockApi(baseRoutes({ 'GET /transport/history': () => json([old]) }));
    renderAt('#/history?transportId=t-old-retry');
    await userEvent.click(await screen.findByRole('button', { name: '실패한 2개 다시 이관' }, { timeout: 3000 }));
    const items = within(within(screen.getByRole('dialog', { name: '실패분 다시 이관' })).getByRole('list', { name: '다시 이관할 iFlow' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('iFlow'), expect.stringContaining('iFlow')]);
  });
});

describe('REQ-1005 실제 이관 확인창 안내', () => {
  const VM = [{ id: 'VM_A', name: 'VM A', version: '1.0.0' }, { id: 'VM_B', name: 'VM B', version: '1.0.0' }];
  type Routes = Parameters<typeof mockApi>[0];
  function setup(previewResults: (body: TransportRequest) => ArtifactResult[]) {
    const routes: Routes = {
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      [`GET ${typeListUrl('PkgTransportDemo', 'VALUE_MAPPING')}`]: () => json(VM),
      'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo': () => json([{ packageId: 'PkgTransportDemo', exists: true }]),
      'POST /transport': (init) => {
        const body = JSON.parse(init?.body as string) as TransportRequest;
        const results = previewResults(body);
        return json(respondTo(body, { results, summary: { total: results.length, succeeded: results.length, failed: 0 } }));
      },
    };
    mockApi(baseRoutes(routes));
    renderAt('#/transport');
  }
  async function openConfirm() {
    await startManual();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await screen.findAllByRole('grid', { name: '이관할 아티팩트' });
    await waitFor(() => expect(screen.getAllByRole('grid', { name: '이관할 아티팩트' })).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    return screen.getByRole('dialog', { name: '실제 이관 확인' });
  }
  const preview = (action: ArtifactResult['action']) => () => [
    art('VM_A', 'VALUE_MAPPING', { packageId: 'PkgTransportDemo', action, deployStatus: 'SKIPPED_DRY_RUN' }),
    art('VM_B', 'VALUE_MAPPING', { packageId: 'PkgTransportDemo', action, deployStatus: 'SKIPPED_DRY_RUN' }),
    iflow('IF_Order_Sync', { packageId: 'PkgTransportDemo', action: 'UPDATED', deployStatus: 'SKIPPED_DRY_RUN' }),
  ];

  it('REQ-1005: 미리보기 결과에 REPLACED가 2개면 "밸류 매핑 2개는 대상에서 삭제 후 다시 만듭니다"와 다른 패키지 참조 안내가 보인다', async () => {
    setup(preview('REPLACED'));
    const d = await openConfirm();
    expect(d).toHaveTextContent('밸류 매핑 2개는 대상에서 삭제 후 다시 만듭니다');
    expect(d).toHaveTextContent(REF_NOTICE);
  });

  it('REQ-1005: REPLACED가 없으면 밸류 매핑 안내는 없고 다른 패키지 참조 안내는 있다', async () => {
    setup(preview('CREATED'));
    const d = await openConfirm();
    expect(d).not.toHaveTextContent('삭제 후 다시 만듭니다');
    expect(d).toHaveTextContent(REF_NOTICE);
  });
});

