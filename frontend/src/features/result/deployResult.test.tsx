import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ArtifactError, ArtifactResult, DeployStatus, TransportResponse } from '../../api/types';
import { TransportResult } from './TransportResult';

function result(statuses: DeployStatus[], overrides: Partial<TransportResponse> = {}): TransportResponse {
  const results: ArtifactResult[] = statuses.map((deployStatus, i) => ({
    artifactId: `IF_Deploy_${i}`,
    status: deployStatus === 'ERROR' || deployStatus === 'TIMEOUT' ? 'FAILED' : 'SUCCESS',
    action: 'UPDATED', replacements: [], unmappedKeys: [], deployStatus,
    error: deployStatus === 'ERROR' ? { code: 'DEPLOY_FAILED', message: 'DEPLOY: CPI deployment ERROR' } : null,
  }));
  return {
    transportId: 'deployment-test', packageId: 'PkgFaultDemo', dryRun: false, deploy: true,
    startedAt: '2026-10-14T00:00:00Z', finishedAt: '2026-10-14T00:01:00Z',
    summary: { total: results.length, succeeded: results.filter((r) => r.status === 'SUCCESS').length,
      failed: results.filter((r) => r.status === 'FAILED').length },
    results, ...overrides,
  };
}

function withError(error: ArtifactError | null) {
  const value = result(['ERROR']);
  value.results[0].error = error;
  return value;
}

describe('배포 결과 요약', () => {
  it.each([
    { statuses: ['STARTED', 'STARTED'], text: '배포 성공 2개', tone: 'success' },
    { statuses: ['ERROR', 'STARTED', 'STARTED'], text: '배포 실패 1개 · 배포 성공 2개', tone: 'danger' },
    { statuses: ['TIMEOUT'], text: '시간 초과 1개', tone: 'danger' },
    { statuses: ['ERROR'], text: '배포 실패 1개', tone: 'danger' },
    { statuses: ['ERROR', 'TIMEOUT', 'STARTED', 'NOT_REQUESTED', 'SKIPPED_DRY_RUN'],
      text: '배포 실패 1개 · 시간 초과 1개 · 배포 성공 1개 · 배포 안 됨 2개', tone: 'danger' },
    { statuses: ['STARTED', 'NOT_REQUESTED'], text: '배포 성공 1개 · 배포 안 됨 1개', tone: 'success' },
  ] as { statuses: DeployStatus[]; text: string; tone: string }[])(
    'REQ-309 AC-8·AC-10: $text — 0개 항목 생략과 톤',
    ({ statuses, text, tone }) => {
      render(<TransportResult result={result(statuses)} />);
      const summary = screen.getByText(text);
      expect(summary.tagName).toBe('P');
      expect(summary).toHaveClass(`text-${tone}-fg`);
      expect(summary.textContent).not.toMatch(/(?:^|[^0-9])0개/);
    },
  );

  it.each([
    { label: '드라이런 안의 ERROR', statuses: ['ERROR'], overrides: { dryRun: true } },
    { label: '배포 요청 없음', statuses: ['ERROR'], overrides: { deploy: false } },
    { label: '빈 결과', statuses: [], overrides: {} },
    { label: '배포 전 실패', statuses: ['NOT_REQUESTED'], overrides: {} },
    { label: '드라이런 생략 결과', statuses: ['SKIPPED_DRY_RUN'], overrides: {} },
  ] as { label: string; statuses: DeployStatus[]; overrides: Partial<TransportResponse> }[])(
    'REQ-309 AC-8·AC-10: $label 에는 요약 없음',
    ({ statuses, overrides }) => {
      render(<TransportResult result={result(statuses, overrides)} />);
      expect(screen.queryByText(/^(배포 성공|배포 실패|시간 초과).*개/)).toBeNull();
    },
  );

  it('REQ-309 AC-8·AC-10: 요약은 첫 배지 줄 바로 밖이며 아이콘과 기존 배지는 늘지 않는다', () => {
    const { container } = render(<TransportResult result={result(['ERROR'])} />);
    const section = screen.getByRole('region', { name: '이관 결과' });
    const header = section.firstElementChild as HTMLElement;
    expect(header.tagName).toBe('DIV');
    expect(Array.from(header.querySelectorAll('span.rounded-full')).map((el) => el.textContent)).toEqual(['실제 이관', '배포']);
    const summary = screen.getByText('배포 실패 1개');
    expect(header.nextElementSibling).toBe(summary);
    expect(header).not.toContainElement(summary);
    expect(summary.querySelector('svg')).toBeNull();
    // 접기 버튼 및 기존 오류 Callout의 두 아이콘뿐이다.
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
  });
});

describe('배포 오류 상세', () => {
  it('REQ-309 AC-7·AC-10: 여러 줄 상세와 서버 태그는 오류 아래 텍스트로 보이고 접기에 따른다', async () => {
    const detail = '첫 줄\n\t둘째 줄 <img src=x onerror=alert(1)>\n<script>alert(2)</script>';
    const { container } = render(<TransportResult result={withError({ code: 'DEPLOY_FAILED', message: 'DEPLOY: CPI deployment ERROR', detail, detailHttpStatus: 200 })} />);
    const heading = screen.getByRole('heading', { level: 5, name: '배포 오류 상세' });
    const text = heading.nextElementSibling as HTMLElement;
    expect(text.textContent).toBe(detail);
    expect(text).toHaveClass('whitespace-pre-wrap', 'break-words', 'min-w-0', 'max-w-full');
    expect(text.parentElement).toHaveClass('min-w-0', 'max-w-full');
    expect(text.className).not.toMatch(/(?:^|\s)(?:h-|max-h-|overflow-)/);
    expect(heading.parentElement?.previousElementSibling).toHaveTextContent('DEPLOY: CPI deployment ERROR');
    expect(container.querySelector('img, script')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'IF_Deploy_0' }));
    expect(screen.queryByRole('heading', { name: '배포 오류 상세' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'IF_Deploy_0' }));
    expect(screen.getByRole('heading', { name: '배포 오류 상세' }).nextElementSibling?.textContent).toBe(detail);
  });

  it('REQ-309 AC-7·AC-10: 4000자 상세와 잘림 표시를 추가 절단 없이 모두 보인다', () => {
    const detail = '가'.repeat(4000) + '…(잘림)';
    render(<TransportResult result={withError({ code: 'DEPLOY_FAILED', message: 'deployment failed', detail, detailHttpStatus: 200 })} />);
    const body = screen.getByRole('heading', { name: '배포 오류 상세' }).nextElementSibling;
    expect(body?.textContent).toBe(detail);
    expect(body).toHaveClass('whitespace-pre-wrap', 'break-words', 'max-w-full', 'min-w-0');
  });

  it.each([
    { detail: null, detailHttpStatus: 404, text: '오류 상세를 가져오지 못했습니다(HTTP 404)' },
    { detail: undefined, detailHttpStatus: 0, text: '오류 상세를 가져오지 못했습니다(응답 없음)' },
    { detail: '', detailHttpStatus: 200, text: '오류 상세를 가져오지 못했습니다(HTTP 200)' },
  ])('REQ-309 AC-7·AC-10: 상세 없음 — $text', ({ detail, detailHttpStatus, text }) => {
    render(<TransportResult result={withError({ code: 'DEPLOY_FAILED', message: 'deployment failed', detail, detailHttpStatus })} />);
    expect(screen.getByRole('heading', { name: '배포 오류 상세' })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    { code: 'DEPLOY_FAILED', message: 'old history entry' },
    { code: 'DEPLOY_FAILED', message: 'call failed', detail: null, detailHttpStatus: null },
    { code: 'DEPLOY_FAILED', message: 'empty detail', detail: '' },
    null,
  ])('REQ-309 AC-7·AC-10: 상세 필드가 없는 기존 오류나 오류 없음에는 영역 없음 (%j)', (error) => {
    render(<TransportResult result={withError(error)} />);
    expect(screen.queryByRole('heading', { name: '배포 오류 상세' })).toBeNull();
    expect(screen.queryByText(/오류 상세를 가져오지 못했습니다/)).toBeNull();
    if (error) expect(screen.getByText(error.message)).toBeInTheDocument();
  });
});
