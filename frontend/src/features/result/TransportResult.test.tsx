import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryTab } from '../history/HistoryTab';
import { json, mockApi } from '../../test/mockFetch';
import type { ArtifactResult, ReplacementStatus, TransportResponse } from '../../api/types';
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

/**
 * 서버 문자열이 만든 요소가 없는지 "위치"로 확인한다. 아이콘 SVG는 속성(aria-hidden)이 아니라 컴포넌트가 그리는 자리
 * (접기 버튼 안, Callout 박스 바로 아래)에 있는 것만 허용하고 개수도 고정한다. on* 이벤트 속성을 가진 요소는 0개여야 한다.
 */
function expectOnlyComponentIcons(container: HTMLElement, expectedIcons: number) {
  const svgs = Array.from(container.querySelectorAll('svg'));
  expect(svgs).toHaveLength(expectedIcons);
  for (const svg of svgs) {
    const host = svg.parentElement as HTMLElement;
    expect(host.matches('button[aria-expanded], div[class*="bg-danger-bg"]'), host.outerHTML.slice(0, 80)).toBe(true);
  }
  const withHandlers = Array.from(container.querySelectorAll('*')).filter((el) => el.getAttributeNames().some((n) => n.startsWith('on')));
  expect(withHandlers).toEqual([]);
}

afterEach(() => vi.unstubAllGlobals());

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
    expect(container.querySelector('script, img, iframe, b, i')).toBeNull();
    // 아이콘 SVG는 컴포넌트가 그린 자리(접기 버튼, 오류 Callout)의 2개뿐이다: 서버 문자열이 svg 요소를 만들지 않는다.
    expectOnlyComponentIcons(container, 2);
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
    expect(container.querySelector('script, img, iframe, b, i')).toBeNull();
    expectOnlyComponentIcons(container, 2);
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

  // REQ-105 AC-3·AC-5용 결과: A(문제 없음, 접힘) / B(VALUE_MISMATCH 1건, 펼침) / C(FAILED·치환 없음, 펼침) / D(PLANNED만, 접힘)
  const art = (artifactId: string, over: Partial<ArtifactResult>): ArtifactResult => ({
    artifactId,
    status: 'SUCCESS',
    action: 'NONE',
    deployStatus: 'NOT_REQUESTED',
    error: null,
    replacements: [],
    unmappedKeys: [],
    ...over,
  });
  const rep = (key: string, status: ReplacementStatus): ArtifactResult['replacements'][number] => ({
    targetType: 'header',
    key,
    status,
    before: 'a',
    after: 'b',
    occurrences: 1,
  });
  const MIXED: TransportResponse = {
    ...BASE,
    summary: { total: 4, succeeded: 3, failed: 1 },
    results: [
      art('A_Clean', { replacements: [rep('K1', 'APPLIED'), rep('K2', 'SENSITIVE_SKIPPED')] }),
      art('B_Mismatch', {
        replacements: [rep('K3', 'VALUE_MISMATCH'), rep('K4', 'APPLIED')],
        unmappedKeys: [{ targetType: 'property', key: 'Mode' }],
      }),
      art('C_Failed', { status: 'FAILED', error: { code: 'ERR_C', message: 'failed c' } }),
      art('D_Planned', { replacements: [rep('K5', 'PLANNED')], unmappedKeys: [{ targetType: 'header', key: 'T1' }, { targetType: 'header', key: 'T2' }] }),
    ],
  };
  const toggle = (id: string) => screen.getByRole('button', { name: id });
  const expandedOf = (id: string) => toggle(id).getAttribute('aria-expanded');
  const onlySwitch = () => screen.getByRole('switch', { name: '문제 항목만 보기' });

  it('REQ-105 AC-3: 처음 상태 — 문제 아티팩트는 펼침, 그 밖은 접힘이고 artifactId 버튼이 aria-expanded로 알린다', () => {
    render(<TransportResult result={MIXED} />);
    expect(expandedOf('A_Clean')).toBe('false');
    expect(expandedOf('B_Mismatch')).toBe('true');
    expect(expandedOf('C_Failed')).toBe('true');
    expect(expandedOf('D_Planned')).toBe('false');
    expect(screen.getByRole('heading', { level: 4, name: 'B_Mismatch' })).toContainElement(toggle('B_Mismatch'));
    // 펼친 카드만 치환 표 소제목을 보인다
    expect(screen.getAllByRole('heading', { level: 5, name: '치환 항목' })).toHaveLength(2);
  });

  it('REQ-105 AC-3: 아티팩트가 1개뿐이면 문제가 없어도 펼침이다', () => {
    render(<TransportResult result={{ ...MIXED, results: [MIXED.results[0]] }} />);
    expect(expandedOf('A_Clean')).toBe('true');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('REQ-105 AC-3: Enter와 Space로 접기·펼치기가 전환된다', async () => {
    render(<TransportResult result={MIXED} />);
    toggle('A_Clean').focus();
    await userEvent.keyboard('{Enter}');
    expect(expandedOf('A_Clean')).toBe('true');
    await userEvent.keyboard(' ');
    expect(expandedOf('A_Clean')).toBe('false');
    await userEvent.click(toggle('B_Mismatch'));
    expect(expandedOf('B_Mismatch')).toBe('false');
    expect(expandedOf('C_Failed')).toBe('true');
  });

  it('REQ-105 AC-3: 접힌 카드에는 머리와 요약 한 줄 "치환 n건 · 문제 m건 · 매핑되지 않은 키 k개"만 보이고 펼치면 요약 줄이 없다', async () => {
    render(<TransportResult result={MIXED} />);
    expect(screen.getByText('치환 2건 · 문제 0건 · 매핑되지 않은 키 0개')).toBeInTheDocument();
    expect(screen.getByText('치환 1건 · 문제 0건 · 매핑되지 않은 키 2개')).toBeInTheDocument();
    expect(screen.queryByText(/치환 2건 · 문제 1건/)).toBeNull();
    // 접힌 카드 A에는 표·소제목·칩이 없다. 머리(h4, 배지)만 있다
    const cardA = toggle('A_Clean').closest('div[class*="rounded-lg"]') as HTMLElement;
    expect(cardA.querySelector('table, h5, ul')).toBeNull();
    expect(within(cardA).getByText('SUCCESS')).toBeInTheDocument();
    await userEvent.click(toggle('A_Clean'));
    expect(screen.queryByText('치환 2건 · 문제 0건 · 매핑되지 않은 키 0개')).toBeNull();
    await userEvent.click(toggle('B_Mismatch'));
    expect(screen.getByText('치환 2건 · 문제 1건 · 매핑되지 않은 키 1개')).toBeInTheDocument();
  });

  it('REQ-105 AC-3: 결과 머리에 sm ghost 버튼 "모두 펼치기"·"모두 접기"가 있고 전체를 바꾼다', async () => {
    render(<TransportResult result={MIXED} />);
    const all = screen.getByRole('button', { name: '모두 펼치기' });
    const none = screen.getByRole('button', { name: '모두 접기' });
    for (const b of [all, none]) {
      expect(b.className).toContain('h-7');
      expect(b.className).toContain('bg-transparent');
    }
    await userEvent.click(all);
    for (const id of ['A_Clean', 'B_Mismatch', 'C_Failed', 'D_Planned']) expect(expandedOf(id)).toBe('true');
    await userEvent.click(none);
    for (const id of ['A_Clean', 'B_Mismatch', 'C_Failed', 'D_Planned']) expect(expandedOf(id)).toBe('false');
  });

  it('REQ-101 AC-6: artifactId 접기 버튼은 글자색 전환 150ms가 있고 포커스 외곽선을 지우지 않는다', () => {
    render(<TransportResult result={MIXED} />);
    const b = toggle('A_Clean');
    expect(b.className).toContain('transition-colors');
    expect(b.className).toContain('duration-150');
    expect(b.className).not.toMatch(/outline-(none|0|hidden)/);
  });

  it('REQ-105 AC-5: 결과 머리에 스위치 "문제 항목만 보기"와 결과 전체의 "문제 항목 m건"이 있다', () => {
    render(<TransportResult result={MIXED} />);
    expect(onlySwitch()).not.toBeChecked();
    expect(onlySwitch()).toBeEnabled();
    expect(screen.getByText('문제 항목 1건')).toBeInTheDocument();
  });

  it('REQ-105 AC-5: 켜면 문제 아티팩트의 카드만 남고 모두 펼쳐지며 치환 표에는 문제 항목 행만 보이고 문제 항목이 없는 FAILED 카드는 "문제 항목 없음"이다', async () => {
    render(<TransportResult result={MIXED} />);
    await userEvent.click(onlySwitch());
    expect(onlySwitch()).toBeChecked();
    expect(screen.queryByRole('button', { name: 'A_Clean' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'D_Planned' })).toBeNull();
    expect(expandedOf('B_Mismatch')).toBe('true');
    expect(expandedOf('C_Failed')).toBe('true');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('K3')).toBeInTheDocument();
    expect(screen.queryByText('K4')).toBeNull();
    expect(screen.getByText('문제 항목 없음')).toBeInTheDocument();
  });

  it('REQ-105 AC-5: 켜진 동안에도 남은 카드의 오류 Callout과 매핑되지 않은 키 목록은 그대로 보인다', async () => {
    render(<TransportResult result={MIXED} />);
    await userEvent.click(onlySwitch());
    expect(screen.getByText('ERR_C')).toBeInTheDocument();
    expect(screen.getByText('failed c')).toBeInTheDocument();
    expect(screen.getByText('property / Mode')).toBeInTheDocument();
    expect(screen.getByText('매핑되지 않은 키 없음')).toBeInTheDocument();
  });

  it('REQ-105 AC-5: 켜진 동안 개별 접기 버튼과 모두 펼치기·모두 접기는 비활성이고 끄면 켜기 직전의 접기·펼치기 상태로 돌아간다', async () => {
    render(<TransportResult result={MIXED} />);
    await userEvent.click(toggle('B_Mismatch')); // B 접기
    await userEvent.click(toggle('A_Clean')); // A 펼치기
    await userEvent.click(onlySwitch());
    expect(toggle('B_Mismatch')).toBeDisabled();
    expect(toggle('C_Failed')).toBeDisabled();
    expect(screen.getByRole('button', { name: '모두 펼치기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '모두 접기' })).toBeDisabled();
    expect(expandedOf('B_Mismatch')).toBe('true');
    await userEvent.click(onlySwitch());
    expect(onlySwitch()).not.toBeChecked();
    expect(expandedOf('A_Clean')).toBe('true');
    expect(expandedOf('B_Mismatch')).toBe('false');
    expect(expandedOf('C_Failed')).toBe('true');
    expect(expandedOf('D_Planned')).toBe('false');
    expect(toggle('B_Mismatch')).toBeEnabled();
    expect(screen.getByRole('button', { name: '모두 펼치기' })).toBeEnabled();
    // 필터 중 걸러졌던 행도 다시 보인다: A는 펼쳐져 K1·K2 전체 행, B는 접혀 있어 표가 없다
    expect(within(screen.getByRole('table')).getByText('K2')).toBeInTheDocument();
    expect(screen.queryByText('K4')).toBeNull();
  });

  it('REQ-105 AC-5: 문제 아티팩트가 하나도 없으면 스위치는 비활성이고 건수는 0건이다', () => {
    render(<TransportResult result={{ ...MIXED, results: [MIXED.results[0], MIXED.results[3]] }} />);
    expect(onlySwitch()).toBeDisabled();
    expect(screen.getByText('문제 항목 0건')).toBeInTheDocument();
  });

  it('REQ-105 AC-5: 새 결과가 나타나면 스위치는 꺼지고 접기·펼치기는 그 결과의 처음 상태다', async () => {
    const { rerender } = render(<TransportResult result={MIXED} />);
    await userEvent.click(toggle('A_Clean'));
    await userEvent.click(onlySwitch());
    expect(onlySwitch()).toBeChecked();
    rerender(<TransportResult result={{ ...MIXED, transportId: 't-next' }} />);
    expect(onlySwitch()).not.toBeChecked();
    expect(expandedOf('A_Clean')).toBe('false');
    expect(expandedOf('B_Mismatch')).toBe('true');
    expect(screen.getByRole('button', { name: 'D_Planned' })).toBeInTheDocument();
  });

  it('REQ-105 AC-6: 이력 상세의 결과에는 드라이런 결과여도 "이 구성으로 실제 이관" 버튼이 없다', async () => {
    mockApi({ 'GET /transport/history': () => json([{ ...BASE, transportId: 't-1', dryRun: true }, { ...BASE, transportId: 't-2', dryRun: false }]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-1' }));
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    await userEvent.click(screen.getByRole('button', { name: 't-2' }));
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });

  it('REQ-105 AC-7: 이력 상세를 열 때는 결과로 스크롤하지 않는다', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    mockApi({ 'GET /transport/history': () => json([{ ...BASE, transportId: 't-1' }]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-1' }));
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('REQ-105 AC-6: onOpenReal을 넘기지 않으면 드라이런 결과여도 버튼이 없고, 넘기면 드라이런 결과에만 버튼이 있다', async () => {
    const onOpenReal = vi.fn();
    const { rerender } = render(<TransportResult result={BASE} />);
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    rerender(<TransportResult result={BASE} onOpenReal={onOpenReal} />);
    await userEvent.click(screen.getByRole('button', { name: '이 구성으로 실제 이관' }));
    expect(onOpenReal).toHaveBeenCalledTimes(1);
    rerender(<TransportResult result={{ ...BASE, dryRun: false }} onOpenReal={onOpenReal} />);
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
  });
});
