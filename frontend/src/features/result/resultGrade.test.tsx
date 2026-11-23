import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportHistoryEntry } from '../../api/types';
import { packagesOf } from '../../test/mockFetch';
import { TransportResult } from './TransportResult';

// 20261121-perf-retry S1, REQ-906 결과 등급:
// 실패 iFlow 카드에 "고쳐야 함"(FIX_REQUIRED) 또는 "다시 시도 가능"(RETRYABLE)이 보이고,
// 결과 머리에 등급별 수 "고쳐야 함 N · 다시 시도 가능 M · 건너뜀 K" 한 줄이 보인다(summary에 등급 수가 있고 실패·건너뜀이 1개 이상일 때).
// 이 변경 전 이력(grade·등급 수 없음)은 지금처럼 "실패"로만 보이고 등급 줄·등급 글자가 없다.
afterEach(() => vi.unstubAllGlobals());

const art = (artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  artifactId, status: 'SUCCESS', action: 'UPDATED', deployStatus: 'NOT_REQUESTED', error: null, configurations: [], ...over,
});
const failed = (artifactId: string, grade: ArtifactResult['grade'], code = 'UPLOAD_FAILED') =>
  art(artifactId, { status: 'FAILED', action: 'NONE', grade, error: { code, message: `${code} ${artifactId}` } });

function entry(results: ArtifactResult[], summary: TransportHistoryEntry['summary']): TransportHistoryEntry {
  return {
    transportId: 't-grade', packages: packagesOf('PkgTransportDemo'), dryRun: false, deploy: false,
    startedAt: '2026-11-21T01:00:00Z', finishedAt: '2026-11-21T01:00:09Z', summary, results,
  };
}

const card = (artifactId: string) => screen.getByRole('button', { name: artifactId }).closest('h4')!.parentElement!.parentElement!;
const region = () => screen.getByRole('region', { name: '이관 결과' });

describe('결과 등급', () => {
  it('REQ-906: 실패 카드에 등급 글자가 보이고 성공 카드에는 없다', () => {
    render(<TransportResult result={entry(
      [art('A_Ok', { grade: 'SUCCESS' }), failed('B_Fix', 'FIX_REQUIRED', 'PACKAGE_NOT_FOUND_IN_TARGET'), failed('C_Retry', 'RETRYABLE', 'DEPLOY_TIMEOUT')],
      { total: 3, succeeded: 1, failed: 2, fixRequired: 1, retryable: 1, skipped: 0 },
    )} />);
    expect(within(card('B_Fix')).getByText('고쳐야 함')).toBeInTheDocument();
    expect(within(card('B_Fix')).queryByText('다시 시도 가능')).toBeNull();
    expect(within(card('C_Retry')).getByText('다시 시도 가능')).toBeInTheDocument();
    expect(within(card('C_Retry')).queryByText('고쳐야 함')).toBeNull();
    expect(within(card('A_Ok')).queryByText('고쳐야 함')).toBeNull();
    expect(within(card('A_Ok')).queryByText('다시 시도 가능')).toBeNull();
  });

  it('REQ-906: 결과 머리에 등급별 수 한 줄이 보인다', () => {
    render(<TransportResult result={entry(
      [art('A_Ok', { grade: 'SUCCESS' }), failed('B_Fix', 'FIX_REQUIRED'), failed('C_Retry', 'RETRYABLE')],
      { total: 3, succeeded: 1, failed: 2, fixRequired: 1, retryable: 1, skipped: 2 },
    )} />);
    expect(within(region()).getByText('고쳐야 함 1 · 다시 시도 가능 1 · 건너뜀 2')).toBeInTheDocument();
  });

  it('REQ-906: 실패도 건너뜀도 없으면 등급 줄이 없다', () => {
    render(<TransportResult result={entry([art('A_Ok', { grade: 'SUCCESS' })],
      { total: 1, succeeded: 1, failed: 0, fixRequired: 0, retryable: 0, skipped: 0 })} />);
    expect(within(region()).queryByText(/^고쳐야 함 \d+ · 다시 시도 가능 \d+ · 건너뜀 \d+$/)).toBeNull();
  });

  it('REQ-906 실패: 이 변경 전 이력(grade·등급 수 없음)은 "실패"로만 보이고 등급 줄·등급 글자가 없다', () => {
    const old = entry([art('A_Ok'), art('B_Old', { status: 'FAILED', action: 'NONE', error: { code: 'UPLOAD_FAILED', message: 'UPLOAD: HTTP 500; CPI call failed' } })],
      { total: 2, succeeded: 1, failed: 1 });
    render(<TransportResult result={old} />);
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(within(card('B_Old')).getByText('UPLOAD_FAILED')).toBeInTheDocument();
    expect(screen.queryByText('고쳐야 함')).toBeNull();
    expect(screen.queryByText('다시 시도 가능')).toBeNull();
    expect(within(region()).queryByText(/고쳐야 함 \d+/)).toBeNull();
  });
});
