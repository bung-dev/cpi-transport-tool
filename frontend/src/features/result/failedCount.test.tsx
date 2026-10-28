import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, ReplacementStatus, TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { HistoryTab } from '../history/HistoryTab';
import { failedArtifactCount, totalProblemCount } from './problems';
import { TransportResult } from './TransportResult';

// REQ-316: 결과 머리의 "문제 항목 N건"(치환 문제만 센다) 옆에 status FAILED 아티팩트 수 M을 "실패 아티팩트 M개"로 따로 보인다.
// 결과 데이터는 summary.failed와 FAILED 아티팩트 수가 같게 만든다(M은 "실패" 타일 값과 같아야 한다).

afterEach(() => vi.unstubAllGlobals());

const rep = (key: string, status: ReplacementStatus): ArtifactResult['replacements'][number] => ({
  targetType: 'header',
  key,
  status,
  before: 'a',
  after: 'b',
  occurrences: 1,
});

const art = (artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  artifactId,
  status: 'SUCCESS',
  action: 'UPDATED',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  replacements: [],
  unmappedKeys: [],
  ...over,
});

const failedArt = (artifactId: string, over: Partial<ArtifactResult> = {}) =>
  art(artifactId, { status: 'FAILED', deployStatus: 'ERROR', error: { code: `ERR_${artifactId}`, message: `failed ${artifactId}` }, ...over });

function result(transportId: string, results: ArtifactResult[], over: Partial<TransportResponse> = {}): TransportResponse {
  const failed = results.filter((r) => r.status === 'FAILED').length;
  return {
    transportId,
    packageId: 'PkgTransportDemo',
    dryRun: false,
    deploy: true,
    startedAt: '2026-10-20T07:05:05Z',
    finishedAt: '2026-10-20T07:05:59Z',
    summary: { total: results.length, succeeded: results.length - failed, failed },
    results,
    ...over,
  };
}

/** 치환 문제 0건, FAILED 0개 */
const NONE_FAILED = result('t-none', [art('A_Clean', { replacements: [rep('K1', 'APPLIED')] }), art('B_Planned', { replacements: [rep('K2', 'PLANNED')] })]);
/** 치환 문제 1건(B의 VALUE_MISMATCH), FAILED 1개(C) */
const ONE_FAILED = result('t-one', [
  art('A_Clean', { replacements: [rep('K1', 'APPLIED')] }),
  art('B_Mismatch', { replacements: [rep('K3', 'VALUE_MISMATCH'), rep('K4', 'APPLIED')] }),
  failedArt('C_Failed'),
]);
/** 치환 문제 2건(C의 KEY_NOT_FOUND, D의 FAILED 치환), FAILED 2개(C, D) */
const TWO_FAILED = result('t-two', [
  art('A_Clean', { replacements: [rep('K1', 'APPLIED')] }),
  failedArt('C_Failed', { replacements: [rep('K5', 'KEY_NOT_FOUND')] }),
  failedArt('D_Failed', { replacements: [rep('K6', 'FAILED'), rep('K7', 'APPLIED')] }),
]);
/** 치환 문제 0건인데 FAILED 1개: 직전 qa_result 8절의 관찰(배포 실패만 있는 결과) */
const DEPLOY_FAILED_ONLY = result('t-deploy', [
  art('A_Clean', { replacements: [rep('K1', 'APPLIED')] }),
  failedArt('E_DeployFailed', { replacements: [rep('K8', 'APPLIED')], error: { code: 'DEPLOY_FAILED', message: 'deploy failed e' } }),
]);

const region = () => screen.getByRole('region', { name: '이관 결과' });
const failedTile = () => within(region()).getByText('실패', { selector: 'span' }).nextElementSibling;
const failedLabel = () => within(region()).queryByText(/^실패 아티팩트 \d+개$/);
const onlySwitch = () => screen.getByRole('switch', { name: '문제 항목만 보기' });

/** 결과 머리 개수 표시를 한 번에 읽는다: 문제 항목 문구, 실패 아티팩트 문구(없으면 null), 실패 타일 값, 둘이 같은 줄(스위치 옆)에 있는지 */
function headCounts() {
  const problem = within(region()).getByText(/^문제 항목 \d+건$/);
  const failed = failedLabel();
  const switchRow = onlySwitch().closest('div.flex.items-center.gap-3');
  return {
    problem: problem.textContent,
    failed: failed?.textContent ?? null,
    tile: failedTile()?.textContent,
    problemBesideSwitch: switchRow !== null && switchRow.contains(problem),
    failedBesideProblem: failed === null ? null : problem.parentElement === failed.parentElement && problem !== failed,
  };
}

describe('결과 머리의 실패 아티팩트 개수', () => {
  it('REQ-316 AC-1: failedArtifactCount는 status가 FAILED인 아티팩트 수이고 치환 문제 수(totalProblemCount)와 따로 센다', () => {
    expect(failedArtifactCount([])).toBe(0);
    expect(failedArtifactCount(NONE_FAILED.results)).toBe(0);
    expect(failedArtifactCount(ONE_FAILED.results)).toBe(1);
    expect(failedArtifactCount(TWO_FAILED.results)).toBe(2);
    expect(failedArtifactCount(DEPLOY_FAILED_ONLY.results)).toBe(1);
    // 치환 항목의 status FAILED는 아티팩트 수에 들어가지 않는다
    expect(failedArtifactCount([art('X', { replacements: [rep('K', 'FAILED')] })])).toBe(0);
    expect(totalProblemCount(DEPLOY_FAILED_ONLY.results)).toBe(0);
  });

  it('REQ-316 AC-1: FAILED 아티팩트가 0개이면 "실패 아티팩트" 문구가 없고 실패 타일은 0이다', () => {
    render(<TransportResult result={NONE_FAILED} />);
    expect(headCounts()).toEqual({ problem: '문제 항목 0건', failed: null, tile: '0', problemBesideSwitch: true, failedBesideProblem: null });
    expect(screen.queryByText(/실패 아티팩트/)).toBeNull();
  });

  it.each<[string, TransportResponse, string, string]>([
    ['1개', ONE_FAILED, '문제 항목 1건', '실패 아티팩트 1개'],
    ['2개', TWO_FAILED, '문제 항목 2건', '실패 아티팩트 2개'],
  ])('REQ-316 AC-1: FAILED 아티팩트가 %s이면 "문제 항목 N건" 옆에 따로 보이고 값은 실패 타일과 같다', (_m, data, problem, failed) => {
    render(<TransportResult result={data} />);
    const counts = headCounts();
    expect(counts).toEqual({ problem, failed, tile: String(data.summary.failed), problemBesideSwitch: true, failedBesideProblem: true });
    expect(counts.failed).toBe(`실패 아티팩트 ${counts.tile}개`);
    // 별도 요소: "문제 항목 N건" 요소의 글자는 그대로라 기존 getByText 단언이 맞는다
    expect(screen.getByText(problem)).not.toBe(screen.getByText(failed));
    expect(screen.getAllByText(/실패 아티팩트/)).toHaveLength(1);
  });

  it('REQ-316 AC-1·AC-2: 치환 문제 항목이 0건이어도 FAILED 아티팩트가 있으면 "문제 항목 0건"과 "실패 아티팩트 1개"가 함께 보이고 스위치는 켤 수 있다', async () => {
    render(<TransportResult result={DEPLOY_FAILED_ONLY} />);
    expect(headCounts()).toEqual({ problem: '문제 항목 0건', failed: '실패 아티팩트 1개', tile: '1', problemBesideSwitch: true, failedBesideProblem: true });
    expect(onlySwitch()).toBeEnabled();
    await userEvent.click(onlySwitch());
    // 켜면 FAILED 카드만 남고(isProblemArtifact 그대로) 치환 표에는 문제 항목이 없어 "문제 항목 없음"이다
    expect(screen.queryByRole('button', { name: 'A_Clean' })).toBeNull();
    expect(screen.getByRole('button', { name: 'E_DeployFailed' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('문제 항목 없음')).toBeInTheDocument();
    expect(screen.getByText('DEPLOY_FAILED')).toBeInTheDocument();
    expect(headCounts()).toEqual({ problem: '문제 항목 0건', failed: '실패 아티팩트 1개', tile: '1', problemBesideSwitch: true, failedBesideProblem: true });
  });

  it('REQ-316 AC-2: "문제 항목 N건"의 N은 치환 문제만 세고 스위치 켜기·끄기 동작은 그대로이며 켜고 꺼도 실패 아티팩트 수는 바뀌지 않는다', async () => {
    render(<TransportResult result={ONE_FAILED} />);
    expect(screen.getByText('문제 항목 1건')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A_Clean' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(onlySwitch());
    expect(onlySwitch()).toBeChecked();
    expect(screen.queryByRole('button', { name: 'A_Clean' })).toBeNull();
    expect(screen.getByRole('button', { name: 'B_Mismatch' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'C_Failed' })).toHaveAttribute('aria-expanded', 'true');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('K3')).toBeInTheDocument();
    expect(screen.queryByText('K4')).toBeNull();
    expect(headCounts()).toEqual({ problem: '문제 항목 1건', failed: '실패 아티팩트 1개', tile: '1', problemBesideSwitch: true, failedBesideProblem: true });
    await userEvent.click(onlySwitch());
    expect(onlySwitch()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'A_Clean' })).toHaveAttribute('aria-expanded', 'false');
    expect(headCounts()).toEqual({ problem: '문제 항목 1건', failed: '실패 아티팩트 1개', tile: '1', problemBesideSwitch: true, failedBesideProblem: true });
  });

  it('REQ-316 AC-1·AC-2: 새 결과가 나타나면 그 결과의 개수로 바뀌고 FAILED가 없어지면 문구가 사라진다', () => {
    const { rerender } = render(<TransportResult result={TWO_FAILED} />);
    expect(failedLabel()).toHaveTextContent('실패 아티팩트 2개');
    rerender(<TransportResult result={ONE_FAILED} />);
    expect(failedLabel()).toHaveTextContent('실패 아티팩트 1개');
    expect(screen.getByText('문제 항목 1건')).toBeInTheDocument();
    rerender(<TransportResult result={NONE_FAILED} />);
    expect(failedLabel()).toBeNull();
    expect(onlySwitch()).toBeDisabled();
  });

  it('REQ-316 AC-1·AC-2·AC-3·AC-4: 이관 결과 화면과 이력 상세가 같은 개수를 같은 자리에 보인다', async () => {
    const cases = [NONE_FAILED, ONE_FAILED, TWO_FAILED, DEPLOY_FAILED_ONLY];
    const direct = cases.map((data) => {
      const { unmount } = render(<TransportResult result={data} />);
      const counts = headCounts();
      unmount();
      return counts;
    });
    expect(direct.map((c) => c.failed)).toEqual([null, '실패 아티팩트 1개', '실패 아티팩트 2개', '실패 아티팩트 1개']);

    mockApi({ 'GET /transport/history': () => json(cases) });
    render(<HistoryTab />);
    for (let i = 0; i < cases.length; i++) {
      await userEvent.click(await screen.findByRole('button', { name: cases[i].transportId }));
      expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
      expect(headCounts()).toEqual(direct[i]);
      await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    }
  });
});
