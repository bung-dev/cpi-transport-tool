import { render, screen, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../../api/types';
import { TransportResult } from './TransportResult';

// S3 REQ-424·REQ-511: 결과 머리(경로·템플릿 이름), "구성 값 문제 N건"·"실패 아티팩트 M개", 왼쪽 탐색 목록 → 오른쪽 상세 카드.
afterEach(() => vi.restoreAllMocks());

const art = (artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  artifactId, status: 'SUCCESS', action: 'NONE', deployStatus: 'SKIPPED_DRY_RUN', error: null, configurations: [], ...over,
});

const RESULT: TransportResponse = {
  sourceTenant: { id: 'DEV', name: '개발' },
  targetTenant: { id: 'QA', name: '품질' },
  template: { id: 'tpl-1', name: '개발→품질 정기' },
  transportId: 't-nav',
  packageId: 'PkgNav',
  dryRun: true,
  deploy: false,
  startedAt: '2026-11-16T01:00:00Z',
  finishedAt: '2026-11-16T01:00:05Z',
  summary: { total: 3, succeeded: 2, failed: 1 },
  results: [
    art('A_Clean', { configurations: [{ key: 'K', value: 'a', dataType: 'xsd:string', status: 'PLANNED' }] }),
    art('B_Mismatch', { configurations: [{ key: 'M', value: 'x', dataType: 'xsd:string', status: 'FAILED' }] }),
    art('C_Failed', { status: 'FAILED', error: { code: 'UPLOAD_FAILED', message: 'boom' } }),
  ],
};

const region = () => screen.getByRole('region', { name: '이관 결과' });
const jumpList = () => within(region()).getByRole('navigation', { name: '결과 바로가기' });
const jumpItems = () => within(jumpList()).getAllByRole('button');
const toggle = (id: string) => within(region()).getByRole('button', { name: id });

describe('결과 머리 (REQ-424)', () => {
  it('REQ-424: 결과 머리에 경로 "원본 → 대상"과 템플릿 이름이 보인다', () => {
    render(<TransportResult result={RESULT} />);
    expect(within(region()).getByText('개발 → 품질')).toBeInTheDocument();
    expect(within(region()).getByText('템플릿 개발→품질 정기')).toBeInTheDocument();
  });

  it('REQ-424: 템플릿 없이 실행한 결과에는 템플릿 표시가 없다', () => {
    const { template: _t, ...noTemplate } = RESULT;
    render(<TransportResult result={noTemplate} />);
    expect(within(region()).getByText('개발 → 품질')).toBeInTheDocument();
    expect(within(region()).queryByText(/^템플릿 /)).toBeNull();
  });

  it('REQ-424, REQ-511: "구성 값 문제 N건"은 구성 값 FAILED만 세고 "실패 아티팩트 M개"는 따로 보인다', () => {
    render(<TransportResult result={RESULT} />);
    expect(within(region()).getByText('구성 값 문제 1건')).toBeInTheDocument();
    expect(within(region()).getByText('실패 아티팩트 1개')).toBeInTheDocument();
    expect(within(region()).queryByText(/^문제 항목 \d+건$/)).toBeNull();
  });
});

describe('탐색 목록과 상세 카드 (REQ-424)', () => {
  it('REQ-424: 왼쪽 "결과 바로가기" 목록에 아티팩트마다 항목이 하나 있고 DOM 순서상 카드보다 앞이다', () => {
    render(<TransportResult result={RESULT} />);
    const items = jumpItems();
    expect(items.map((b) => b.textContent?.split(/\s/)[0])).toEqual(['A_Clean', 'B_Mismatch', 'C_Failed']);
    // 항목 이름은 artifactId만이 아니라 상태 글자를 함께 가진다(카드 접기 버튼과 이름이 겹치지 않는다)
    for (const b of items) expect(b.textContent).not.toBe(b.textContent?.split(/\s/)[0]);
    expect(jumpList().compareDocumentPosition(toggle('A_Clean')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(jumpList().querySelector('svg')).toBeNull();
  });

  it('REQ-424: 접힌 아티팩트의 항목을 누르면 그 카드가 펼쳐지고 카드 위치로 스크롤한다', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<TransportResult result={RESULT} />);
    expect(toggle('A_Clean')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(jumpItems()[0]);
    expect(toggle('A_Clean')).toHaveAttribute('aria-expanded', 'true');
    expect(scroll).toHaveBeenCalled();
    const target = scroll.mock.contexts.at(-1) as Element;
    expect(target).toContainElement(toggle('A_Clean'));
    expect(target).not.toContainElement(toggle('B_Mismatch'));
  });

  it('REQ-424: 이미 펼친 카드의 항목을 눌러도 접히지 않고 그 카드로 스크롤한다', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<TransportResult result={RESULT} />);
    expect(toggle('B_Mismatch')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(jumpItems()[1]);
    expect(toggle('B_Mismatch')).toHaveAttribute('aria-expanded', 'true');
    expect(scroll.mock.contexts.at(-1) as Element).toContainElement(toggle('B_Mismatch'));
  });

  it('REQ-424: 새 결과가 오면 접기·필터가 그 결과의 처음 상태로 돌아가고 목록도 새 결과의 아티팩트다', async () => {
    const { rerender } = render(<TransportResult result={RESULT} />);
    await userEvent.click(jumpItems()[0]);
    await userEvent.click(within(region()).getByRole('switch', { name: '문제 항목만 보기' }));
    const next: TransportResponse = { ...RESULT, transportId: 't-next', results: [art('Z_One'), art('Z_Two')] };
    rerender(<TransportResult result={next} />);
    expect(within(region()).getByRole('switch', { name: '문제 항목만 보기' })).not.toBeChecked();
    expect(toggle('Z_One')).toHaveAttribute('aria-expanded', 'false');
    expect(jumpItems().map((b) => b.textContent?.split(/\s/)[0])).toEqual(['Z_One', 'Z_Two']);
  });
});

describe('민감 값과 알 수 없는 상태 (REQ-424 실패)', () => {
  it('REQ-510: 민감 키의 구성 값도 서버가 보낸 값 그대로 보인다(ADR-003 대체)', () => {
    const sensitive: TransportResponse = {
      ...RESULT,
      results: [art('S_Secret', { configurations: [
        { key: 'Password', value: 'plain-secret-value', dataType: 'xsd:string', status: 'COPIED' },
      ] })],
    };
    render(<TransportResult result={sensitive} />);
    expect(toggle('S_Secret')).toHaveAttribute('aria-expanded', 'true');
    expect(within(region()).getByText('Password')).toBeInTheDocument();
    expect(within(region()).getByText('plain-secret-value')).toBeInTheDocument();
    expect(within(region()).getByText('복사됨').className).toContain('bg-success-bg');
  });

  it('REQ-510: 탐색 목록의 짧은 상태 글자는 "구성 값 n개" 또는 "구성 값 없음"이다', () => {
    const list: TransportResponse = {
      ...RESULT,
      results: [
        art('N_Two', { configurations: [
          { key: 'A', value: 'a', dataType: 'xsd:string', status: 'PLANNED' },
          { key: 'B', value: 'b', dataType: 'xsd:string', status: 'SKIPPED_EMPTY' },
        ] }),
        art('N_None'),
      ],
    };
    render(<TransportResult result={list} />);
    const [two, none] = jumpItems();
    expect(two).toHaveTextContent('구성 값 2개');
    expect(none).toHaveTextContent('구성 값 없음');
    expect(jumpList().textContent).not.toMatch(/치환/);
  });

  it('REQ-424: 알 수 없는 상태 값은 중립 배지로 글자 그대로 보인다', () => {
    const odd = { ...RESULT, results: [art('U_Odd', { status: 'PARTIAL' as ArtifactResult['status'] })] };
    render(<TransportResult result={odd} />);
    const badges = within(region()).getAllByText('PARTIAL');
    expect(badges.some((b) => b.className.includes('bg-neutral-bg'))).toBe(true);
    expect(badges.some((b) => /bg-(success|danger|warning|accent|info)-bg/.test(b.className))).toBe(false);
  });
});
