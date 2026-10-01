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
    // 표현이 라벨/값 분리로 바뀌었다(REQ-105 AC-1): 라벨과 값을 각각 확인한다.
    const valueOf = (label: string) => within(region).getByText(label).nextElementSibling;
    expect(valueOf('이관 ID')).toHaveTextContent('t-1');
    expect(valueOf('패키지 ID')).toHaveTextContent('PkgTransportDemo');
    expect(within(region).getByText('드라이런')).toBeInTheDocument();
    expect(within(region).queryByText('실제 이관')).toBeNull();
    expect(within(region).queryByText('배포', { selector: 'span.rounded-full' })).toBeNull();
    expect(valueOf('시작')).toHaveTextContent(formatTime(BASE.startedAt));
    expect(valueOf('종료')).toHaveTextContent(formatTime(BASE.finishedAt));
    expect(valueOf('전체')).toHaveTextContent('2');
    expect(valueOf('성공')).toHaveTextContent('1');
    expect(valueOf('실패')).toHaveTextContent('1');
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
    // 아이콘(aria-hidden SVG)은 화면 구성 요소다. 서버 문자열이 만든 요소(속성 없는 svg 등)만 없어야 한다.
    expect(container.querySelector('script, img, svg:not([aria-hidden="true"]), iframe, b, i')).toBeNull();
  });

  it('REQ-105 AC-1: 모드 배지 — dryRun이면 neutral "드라이런", 실제 이관이면 accent "실제 이관", deploy가 true일 때만 info "배포" 배지를 더 보인다', () => {
    const badges = (c: HTMLElement) => Array.from(c.querySelectorAll('section > div:first-child > span')).map((e) => [e.textContent, e.className]);
    const { container, rerender } = render(<TransportResult result={BASE} />);
    let b = badges(container);
    expect(b).toHaveLength(1);
    expect(b[0][0]).toBe('드라이런');
    expect(b[0][1]).toContain('bg-neutral-bg');
    rerender(<TransportResult result={{ ...BASE, dryRun: false, deploy: false }} />);
    b = badges(container);
    expect(b).toHaveLength(1);
    expect(b[0][0]).toBe('실제 이관');
    expect(b[0][1]).toContain('bg-accent-bg');
    rerender(<TransportResult result={{ ...BASE, dryRun: false, deploy: true }} />);
    b = badges(container);
    expect(b.map((x) => x[0])).toEqual(['실제 이관', '배포']);
    expect(b[1][1]).toContain('bg-info-bg');
    expect(b[1][1]).toContain('text-info-fg');
  });

  it('REQ-105 AC-1: 통계 타일 3개(전체·성공·실패) 숫자는 24px·600이고 성공 ≥ 1은 success-fg, 실패 ≥ 1은 danger-fg, 그 밖은 ink다', () => {
    const num = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;
    const { rerender } = render(<TransportResult result={BASE} />);
    for (const l of ['전체', '성공', '실패']) {
      expect(num(l).className).toContain('text-2xl');
      expect(num(l).className).toContain('font-semibold');
    }
    expect(num('전체').className).toContain('text-ink');
    expect(num('성공').className).toContain('text-success-fg');
    expect(num('실패').className).toContain('text-danger-fg');
    rerender(<TransportResult result={{ ...BASE, summary: { total: 0, succeeded: 0, failed: 0 } }} />);
    expect(num('성공').className).toContain('text-ink');
    expect(num('성공').className).not.toContain('text-success-fg');
    expect(num('실패').className).toContain('text-ink');
    expect(num('실패').className).not.toContain('text-danger-fg');
    expect(num('성공').parentElement?.parentElement?.className).toContain('grid-cols-3');
  });

  it('REQ-105 AC-1: 메타 정보 4개(이관 ID, 패키지 ID, 시작, 종료)의 ID 값은 고정폭이고 시각은 로컬 시간 초 단위다', () => {
    render(<TransportResult result={BASE} />);
    const labels = ['이관 ID', '패키지 ID', '시작', '종료'].map((l) => screen.getByText(l));
    expect(labels.map((e) => e.tagName)).toEqual(['DT', 'DT', 'DT', 'DT']);
    expect(screen.getByText('t-1').className).toContain('font-mono');
    expect(screen.getByText('PkgTransportDemo').className).toContain('font-mono');
    expect(screen.getByText('시작').nextElementSibling).toHaveTextContent(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('REQ-105 AC-2: 아티팩트마다 카드 하나, 머리에 artifactId(h4·고정폭)와 분류 이름이 붙은 배지 3개(값 원문)가 있다', () => {
    render(<TransportResult result={BASE} />);
    const h4s = screen.getAllByRole('heading', { level: 4 });
    expect(h4s.map((h) => h.textContent)).toEqual(['IF_Order_Sync', 'IF_Failed']);
    expect(h4s[0].className).toContain('font-mono');
    const head = h4s[0].parentElement as HTMLElement;
    const labeled = Array.from(head.querySelectorAll(':scope > span')).map((s) => s.textContent);
    expect(labeled).toEqual(['상태SUCCESS', '동작NONE', '배포SKIPPED_DRY_RUN']);
    const labelSpan = within(head).getByText('상태');
    expect(labelSpan.className).toContain('text-xs');
    expect(labelSpan.className).toContain('text-ink-tertiary');
  });

  it('REQ-105 AC-2: status가 FAILED인 카드만 왼쪽에 3px danger-fg 띠가 있다', () => {
    const { container } = render(<TransportResult result={BASE} />);
    const bands = container.querySelectorAll('[data-failed-band]');
    expect(bands).toHaveLength(1);
    expect(bands[0].className).toContain('w-[3px]');
    expect(bands[0].className).toContain('bg-danger-fg');
    expect(bands[0].className).toContain('left-0');
    const failedCard = screen.getByRole('heading', { name: 'IF_Failed' }).closest('div[class*="rounded-lg"]') as HTMLElement;
    expect(failedCard.contains(bands[0])).toBe(true);
    const okCard = screen.getByRole('heading', { name: 'IF_Order_Sync' }).closest('div[class*="rounded-lg"]') as HTMLElement;
    expect(okCard.querySelector('[data-failed-band]')).toBeNull();
  });

  it('REQ-105 AC-4: error가 있으면 danger Callout에 error.code(고정폭)와 error.message를 보인다', () => {
    render(<TransportResult result={BASE} />);
    const code = screen.getByText('CONFIGURATION_UPDATE_FAILED');
    expect(code.className).toContain('font-mono');
    const callout = code.closest('div[class*="bg-danger-bg"]') as HTMLElement;
    expect(callout).not.toBeNull();
    expect(callout).toHaveTextContent('update failed');
    expect(callout.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('REQ-105 AC-4: 치환 항목 표 머리, 키·변경 전·변경 후 고정폭, 횟수 오른쪽 정렬, null은 ink-tertiary "—"', () => {
    render(<TransportResult result={BASE} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '대상 유형',
      '키',
      '상태',
      '변경 전',
      '변경 후',
      '횟수',
    ]);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    const first = within(rows[1]);
    expect(first.getByText('TargetSystem').className).toContain('font-mono');
    expect(first.getByText('DEV_ERP').className).toContain('font-mono');
    expect(first.getByText('PRD_ERP').className).toContain('font-mono');
    expect(first.getByText('2').className).toContain('text-right');
    const dashes = within(rows[2]).getAllByText('—');
    expect(dashes).toHaveLength(2);
    for (const d of dashes) expect(d.className).toContain('text-ink-tertiary');
  });

  it('REQ-105 AC-4: 매핑되지 않은 키는 "targetType / key" neutral 칩(반경 sm·고정폭), 항목이 없으면 안내 문구', () => {
    render(<TransportResult result={BASE} />);
    const chip = screen.getByText('header / TraceId');
    expect(chip.tagName).toBe('LI');
    expect(chip.className).toContain('rounded-sm');
    expect(chip.className).toContain('font-mono');
    expect(chip.className).toContain('bg-neutral-bg');
    expect(screen.getByText('치환 항목 없음')).toBeInTheDocument();
    expect(screen.getByText('매핑되지 않은 키 없음')).toBeInTheDocument();
  });

  it('REQ-105 AC-8: 모든 값은 텍스트 노드로 렌더링한다(<script> 문자열이 글자 그대로 보이고 요소가 생기지 않는다)', () => {
    const result: TransportResponse = {
      ...BASE,
      transportId: '<script>alert(1)</script>',
      packageId: '<img src=x onerror=alert(2)>',
      results: [
        {
          artifactId: '<script>alert(3)</script>',
          status: 'FAILED',
          action: 'NONE',
          deployStatus: 'NOT_REQUESTED',
          error: { code: '<b>code</b>', message: '<iframe src=about:blank></iframe>' },
          replacements: [
            { targetType: 'header', key: '<i>k</i>', status: 'APPLIED', before: '<script>b</script>', after: null, occurrences: 1 },
          ],
          unmappedKeys: [{ targetType: 'property', key: '"><svg onload=alert(4)>' }],
        },
      ],
    };
    const { container } = render(<TransportResult result={result} />);
    for (const t of ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '<script>alert(3)</script>', '<b>code</b>', '<iframe src=about:blank></iframe>', '<i>k</i>', '<script>b</script>', '"><svg onload=alert(4)>']) {
      expect(container).toHaveTextContent(t);
    }
    expect(container.querySelector('script, img, iframe, b, i, svg:not([aria-hidden="true"])')).toBeNull();
  });

  it('REQ-101 AC-4: 결과 값(ID·키·변경 전·후·칩)은 고정폭이고 통계 숫자와 횟수 열은 tabular-nums다', () => {
    render(<TransportResult result={BASE} />);
    for (const t of ['t-1', 'PkgTransportDemo', 'IF_Order_Sync', 'TargetSystem', 'DEV_ERP', 'header / TraceId']) {
      expect(screen.getByText(t).className, t).toContain('font-mono');
    }
    for (const l of ['전체', '성공', '실패']) {
      expect((screen.getByText(l).nextElementSibling as HTMLElement).className).toContain('tabular-nums');
    }
    expect(screen.getByText('2', { selector: 'td' }).className).toContain('tabular-nums');
  });

  it('REQ-101 AC-6: 치환 표의 행은 hover 배경에 150ms 전환이 있다', () => {
    render(<TransportResult result={BASE} />);
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(row.className).toContain('hover:bg-surface-hover');
    expect(row.className).toContain('transition-colors');
    expect(row.className).toContain('duration-150');
  });
});
