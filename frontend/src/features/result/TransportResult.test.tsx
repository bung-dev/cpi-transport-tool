import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { formatTime } from '../../lib/formatTime';
import { TransportResult } from './TransportResult';

const BASE: TransportResponse = {
  transportId: 't-1',
  packageId: 'PkgTransportDemo',
  dryRun: true,
  deploy: false,
  startedAt: '2026-09-29T07:05:05.351940500Z',
  finishedAt: '2026-09-29T07:05:59.9Z',
  summary: { total: 2, succeeded: 1, failed: 1 },
  results: [
    {
      artifactId: 'IF_Order_Sync',
      status: 'SUCCESS',
      action: 'NONE',
      deployStatus: 'SKIPPED_DRY_RUN',
      error: null,
      replacements: [
        { targetType: 'header', key: 'TargetSystem', status: 'PLANNED', before: 'DEV_ERP', after: 'PRD_ERP', occurrences: 2 },
        { targetType: 'property', key: 'NotExisting', status: 'KEY_NOT_FOUND', before: null, after: null, occurrences: 0 },
      ],
      unmappedKeys: [{ targetType: 'header', key: 'TraceId' }],
    },
    {
      artifactId: 'IF_Failed',
      status: 'FAILED',
      action: 'UPDATED',
      deployStatus: 'ERROR',
      error: { code: 'CONFIGURATION_UPDATE_FAILED', message: 'update failed' },
      replacements: [],
      unmappedKeys: [],
    },
  ],
};

describe('이관 결과', () => {
  it('REQ-006 AC-1: 머리 정보(transportId, packageId, 드라이런/배포 예·아니오, 시각, 요약)', () => {
    render(<TransportResult result={BASE} />);
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    const region = screen.getByRole('region');
    expect(region).toHaveTextContent('transportId: t-1');
    expect(region).toHaveTextContent('packageId: PkgTransportDemo');
    expect(region).toHaveTextContent('드라이런: 예');
    expect(region).toHaveTextContent('배포: 아니오');
    expect(region).toHaveTextContent(`시작: ${formatTime(BASE.startedAt)}`);
    expect(region).toHaveTextContent(`종료: ${formatTime(BASE.finishedAt)}`);
    expect(region).toHaveTextContent('전체: 2');
    expect(region).toHaveTextContent('성공: 1');
    expect(region).toHaveTextContent('실패: 1');
  });

  it('REQ-006 AC-2: 아티팩트 카드에 id, 상태·action·deploy 배지(색은 매핑 모듈), error code/message', () => {
    render(<TransportResult result={BASE} />);
    expect(screen.getByRole('heading', { name: 'IF_Order_Sync' })).toBeInTheDocument();
    expect(screen.getByText('SUCCESS').className).toContain('bg-success-bg');
    expect(screen.getByText('SKIPPED_DRY_RUN').className).toContain('bg-accent-bg');
    expect(screen.getByText('FAILED').className).toContain('bg-danger-bg');
    expect(screen.getByText('ERROR').className).toContain('bg-danger-bg');
    expect(screen.getByText('UPDATED').className).toContain('bg-accent-bg');
    expect(screen.getByText('CONFIGURATION_UPDATE_FAILED')).toBeInTheDocument();
    expect(screen.getByText(/update failed/)).toBeInTheDocument();
  });

  it('REQ-006 AC-3: 치환 표(값·배지), null은 —, unmapped 목록, 빈 목록 안내', () => {
    render(<TransportResult result={BASE} />);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('DEV_ERP')).toBeInTheDocument();
    expect(within(rows[1]).getByText('PLANNED').className).toContain('bg-accent-bg');
    expect(within(rows[2]).getAllByText('—')).toHaveLength(2);
    expect(within(rows[2]).getByText('KEY_NOT_FOUND').className).toContain('bg-neutral-bg');
    expect(screen.getByText('header / TraceId')).toBeInTheDocument();
    expect(screen.getByText('치환 항목 없음')).toBeInTheDocument();
    expect(screen.getByText('매핑되지 않은 키 없음')).toBeInTheDocument();
  });

  it('REQ-006 AC-4: <script>, <img onerror> 등 문자열은 글자 그대로 보이고 요소로 해석되지 않는다', () => {
    const xss: TransportResponse = {
      ...BASE,
      transportId: 't-<img src=x onerror=alert(1)>',
      results: [
        {
          artifactId: '<script>alert(2)</script>',
          status: 'FAILED',
          action: 'NONE',
          deployStatus: 'NOT_REQUESTED',
          error: { code: 'X<i>1</i>', message: '<script>alert(5)</script>' },
          replacements: [
            { targetType: 'header', key: '"><svg onload=alert(3)>', status: 'APPLIED', before: '<b>bold</b>', after: 'javascript:alert(4)', occurrences: 1 },
          ],
          unmappedKeys: [{ targetType: 'property', key: '<iframe src=about:blank>' }],
        },
      ],
    };
    const { container } = render(<TransportResult result={xss} />);
    expect(container).toHaveTextContent('t-<img src=x onerror=alert(1)>');
    expect(container).toHaveTextContent('<script>alert(2)</script>');
    expect(container).toHaveTextContent('"><svg onload=alert(3)>');
    expect(container).toHaveTextContent('<b>bold</b>');
    expect(container).toHaveTextContent('<iframe src=about:blank>');
    expect(container.querySelector('script, img, svg, iframe, b, i')).toBeNull();
  });
});
