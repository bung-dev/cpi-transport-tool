import { render, screen, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../../api/types';
import { json, mockApi, packagesOf } from '../../test/mockFetch';
import { resultGroup } from '../../test/wizard';
import { HistoryTab } from '../history/HistoryTab';
import { TransportResult } from './TransportResult';

// 20261118 S3 REQ-623 결과·이력의 패키지별 묶음.
// 결과 화면 구조(입력 패키지에 적은 계약): 패키지마다 role=group(접근 이름 = 묶음 제목: 패키지 이름과 ID, 이름이 없으면 ID),
// 제목 아래 대상 패키지 상태 배지(EXISTING 있음 / CREATED 새로 만듦 / CREATE_FAILED 생성 실패 / NOT_FOUND 대상에 없음 /
// CHECK_FAILED 확인 실패, NOT_CHECKED·null은 배지 없음), 그 안에 그 패키지의 아티팩트 카드(h4 = artifactId).
afterEach(() => vi.unstubAllGlobals());

const art = (packageId: string, artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  packageId, artifactId, status: 'SUCCESS', action: 'CREATED', deployStatus: 'NOT_REQUESTED', error: null, configurations: [], ...over,
});
const createFailed = (packageId: string, artifactId: string) => art(packageId, artifactId, {
  status: 'FAILED', action: 'NONE', error: { code: 'PACKAGE_CREATE_FAILED', message: 'TARGET: HTTP 500; CPI call failed' },
});

const REAL: TransportResponse = {
  transportId: 't-multi',
  sourceTenant: { id: 'DEV', name: '개발' },
  targetTenant: { id: 'PRD', name: '운영' },
  packages: [
    { packageId: 'PkgTransportDemo', packageName: 'Transport Demo', targetPackage: 'EXISTING' },
    { packageId: 'PkgNotInPrd', packageName: 'Not In PRD', targetPackage: 'CREATED' },
    { packageId: 'PkgCreateFail', packageName: 'Create Fail', targetPackage: 'CREATE_FAILED' },
  ],
  dryRun: false,
  deploy: false,
  startedAt: '2026-11-18T01:00:00Z',
  finishedAt: '2026-11-18T01:00:05Z',
  summary: { total: 4, succeeded: 3, failed: 1 },
  // 일부러 패키지 순서와 섞어 둔다: 화면은 packages 순서로 묶고, 묶음 안에서는 results 순서를 지킨다
  results: [
    art('PkgNotInPrd', 'IF_New_A'),
    art('PkgTransportDemo', 'IF_Order_Sync'),
    createFailed('PkgCreateFail', 'IF_Fail_A'),
    art('PkgTransportDemo', 'IF_Customer_Push', { configurations: [{ key: 'K', value: null, dataType: 'xsd:string', status: 'FAILED' }] }),
  ],
};
const cardsIn = (group: HTMLElement) => within(group).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

describe('REQ-623 결과의 패키지별 묶음', () => {
  it('REQ-623: 패키지마다 묶음 제목(이름·ID)과 그 아래 그 패키지의 아티팩트 카드를 packages 순서로 보인다', () => {
    render(<TransportResult result={REAL} />);
    const groups = ['PkgTransportDemo', 'PkgNotInPrd', 'PkgCreateFail'].map(resultGroup);
    expect(groups[0]).toHaveAccessibleName(expect.stringContaining('Transport Demo'));
    expect(groups[1]).toHaveAccessibleName(expect.stringContaining('Not In PRD'));
    expect(groups[0].compareDocumentPosition(groups[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groups[1].compareDocumentPosition(groups[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cardsIn(groups[0])).toEqual(['IF_Order_Sync', 'IF_Customer_Push']);
    expect(cardsIn(groups[1])).toEqual(['IF_New_A']);
    expect(cardsIn(groups[2])).toEqual(['IF_Fail_A']);
    // 묶음 제목의 패키지 ID는 고정폭이다
    expect(within(groups[1]).getByText('PkgNotInPrd').className).toContain('font-mono');
  });

  it.each([
    ['EXISTING', '있음'],
    ['CREATED', '새로 만듦'],
    ['CREATE_FAILED', '생성 실패'],
    ['NOT_FOUND', '대상에 없음'],
    ['CHECK_FAILED', '확인 실패'],
  ] as const)('REQ-623: 대상 패키지 상태 %s는 묶음 배지 "%s"다', (targetPackage, label) => {
    const result: TransportResponse = {
      ...REAL,
      packages: [{ packageId: 'PkgOne', packageName: 'One', targetPackage }],
      summary: { total: 1, succeeded: 1, failed: 0 },
      results: [art('PkgOne', 'IF_One')],
    };
    render(<TransportResult result={result} />);
    expect(within(resultGroup('PkgOne')).getByText(label)).toBeInTheDocument();
  });

  it('REQ-623: 미리보기(NOT_CHECKED)와 예전 형식 기록(이름·상태 null)은 배지가 없고, 이름이 없으면 ID로 묶는다', () => {
    const preview: TransportResponse = {
      ...REAL, dryRun: true,
      packages: [{ packageId: 'PkgA', packageName: 'A 패키지', targetPackage: 'NOT_CHECKED' }, ...packagesOf('PkgOld')],
      summary: { total: 2, succeeded: 2, failed: 0 },
      results: [art('PkgA', 'IF_A'), art('PkgOld', 'IF_Old')],
    };
    render(<TransportResult result={preview} />);
    for (const id of ['PkgA', 'PkgOld']) {
      const group = resultGroup(id);
      for (const label of ['있음', '새로 만듦', '생성 실패', '대상에 없음', '확인 실패']) expect(group, `${id} ${label}`).not.toHaveTextContent(label);
    }
    expect(resultGroup('PkgOld')).toHaveAccessibleName(expect.stringContaining('PkgOld'));
  });

  it('REQ-623: packageId 없는 결과(예전 응답 모양)는 첫 패키지 묶음에 든다', () => {
    const result: TransportResponse = {
      ...REAL, packages: packagesOf('PkgOld'), summary: { total: 1, succeeded: 1, failed: 0 },
      results: [{ artifactId: 'IF_NoPkg', status: 'SUCCESS', action: 'NONE', deployStatus: 'NOT_REQUESTED', error: null, configurations: [] }],
    };
    render(<TransportResult result={result} />);
    expect(cardsIn(resultGroup('PkgOld'))).toEqual(['IF_NoPkg']);
  });

  it('REQ-623: 상단 합계·"구성 값 문제 N건"·"실패 아티팩트 M개"는 전체 합계이고, "문제 항목만 보기"는 묶음 안의 문제 카드만 남긴다', async () => {
    render(<TransportResult result={REAL} />);
    const region = screen.getByRole('region', { name: '이관 결과' });
    // 문제 카드는 처음부터 펼쳐져 구성 값 배지 "실패"도 같은 글자다. 상단 합계 타일은 DOM에서 먼저 나온다.
    const valueOf = (label: string) => within(region).getAllByText(label)[0].nextElementSibling;
    expect(valueOf('전체')).toHaveTextContent('4');
    expect(valueOf('성공')).toHaveTextContent('3');
    expect(valueOf('실패')).toHaveTextContent('1');
    expect(region).toHaveTextContent('구성 값 문제 1건');
    expect(region).toHaveTextContent('실패 아티팩트 1개');
    expect(valueOf('패키지')).toHaveTextContent('Transport Demo 외 2개');
    await userEvent.click(screen.getByRole('switch', { name: '문제 항목만 보기' }));
    expect(cardsIn(resultGroup('PkgTransportDemo'))).toEqual(['IF_Customer_Push']);
    expect(cardsIn(resultGroup('PkgCreateFail'))).toEqual(['IF_Fail_A']);
    expect(within(region).queryByRole('heading', { level: 4, name: 'IF_New_A' })).toBeNull();
    expect(within(region).queryByRole('heading', { level: 4, name: 'IF_Order_Sync' })).toBeNull();
  });

  it('REQ-623: PACKAGE_CREATE_FAILED 오류는 제목 "패키지 생성 실패"와 코드를 함께 보인다(사람 결정 2026-11-18). 다른 코드는 지금처럼 코드만이다', () => {
    const other = art('PkgTransportDemo', 'IF_Other', { status: 'FAILED', error: { code: 'CONFIGURATION_UPDATE_FAILED', message: 'update failed' } });
    render(<TransportResult result={{ ...REAL, results: [...REAL.results, other], summary: { total: 5, succeeded: 3, failed: 2 } }} />);
    const failGroup = resultGroup('PkgCreateFail');
    expect(within(failGroup).getByText('패키지 생성 실패')).toBeInTheDocument();
    expect(within(failGroup).getByText('PACKAGE_CREATE_FAILED')).toBeInTheDocument();
    expect(failGroup).toHaveTextContent('TARGET: HTTP 500; CPI call failed');
    const transport = resultGroup('PkgTransportDemo');
    expect(within(transport).getByText('CONFIGURATION_UPDATE_FAILED')).toBeInTheDocument();
    expect(transport).not.toHaveTextContent('패키지 생성 실패');
  });

  it('REQ-623: 375px 폭에서 넘치지 않도록 묶음 제목의 이름·ID는 줄바꿈되고(break-all) 고정 폭·nowrap을 쓰지 않는다', () => {
    const long = 'PkgWithAVeryLongIdentifierThatMustWrapOnNarrowScreens_0001';
    render(<TransportResult result={{ ...REAL, packages: [{ packageId: long, packageName: long, targetPackage: 'CREATED' }], results: [art(long, 'IF_X')] }} />);
    const group = resultGroup(long);
    const idText = within(group).getAllByText(long).find((el) => el.className.includes('font-mono'))!;
    expect(idText.className).toMatch(/break-all/);
    // 묶음 제목은 group의 aria-labelledby가 가리키는 요소다(카드 안은 기존 규칙이라 여기서 보지 않는다)
    const title = document.getElementById(group.getAttribute('aria-labelledby') ?? '') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title).toContainElement(idText);
    for (const el of [group, title, ...Array.from(title.querySelectorAll<HTMLElement>('*'))]) {
      expect(el.className, el.outerHTML.slice(0, 80)).not.toMatch(/(?:^|\s)(?:whitespace-nowrap|truncate|w-\[\d+px\]|min-w-\[\d+px\])(?:\s|$)/);
    }
  });
});

describe('REQ-623 이관 이력', () => {
  const entry = (id: string, packages: TransportResponse['packages']): TransportResponse => ({
    ...REAL, transportId: id, packages, results: [],
  });

  it('REQ-623: 이력 목록의 패키지 열은 1개면 이름(없으면 ID), 여러 개면 "<첫 이름> 외 n개"다', async () => {
    mockApi({ 'GET /transport/history': () => json([
      entry('t-multi', REAL.packages),
      entry('t-one', [{ packageId: 'PkgOne', packageName: 'One 패키지', targetPackage: 'EXISTING' }]),
      entry('t-old', packagesOf('PkgOld')),
      entry('t-multi-old', packagesOf('PkgX', 'PkgY')),
    ]) });
    render(<HistoryTab />);
    await screen.findByRole('table');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const col = headers.indexOf('패키지');
    const cell = (i: number) => within(screen.getAllByRole('row')[i + 1]).getAllByRole('cell')[col].textContent;
    expect([cell(0), cell(1), cell(2), cell(3)]).toEqual(['Transport Demo 외 2개', 'One 패키지', 'PkgOld', 'PkgX 외 1개']);
  });

  it('REQ-623: 이력에서 연 결과도 패키지별로 묶이고 배지가 보이며, 목록으로 돌아갔다가 다시 열어도 같다', async () => {
    const fn = mockApi({ 'GET /transport/history': () => json([REAL, entry('t-old', packagesOf('PkgOld'))]) });
    render(<HistoryTab />);
    await userEvent.click(await screen.findByRole('button', { name: 't-multi' }));
    expect(within(resultGroup('PkgNotInPrd')).getByText('새로 만듦')).toBeInTheDocument();
    expect(within(resultGroup('PkgCreateFail')).getByText('생성 실패')).toBeInTheDocument();
    expect(within(resultGroup('PkgTransportDemo')).getByText('있음')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    await userEvent.click(screen.getByRole('button', { name: 't-old' }));
    expect(resultGroup('PkgOld')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    await userEvent.click(screen.getByRole('button', { name: 't-multi' }));
    expect(cardsIn(resultGroup('PkgTransportDemo'))).toEqual(['IF_Order_Sync', 'IF_Customer_Push']);
    expect(fn.mock.calls.filter(([u]) => String(u) === '/transport/history')).toHaveLength(1);
  });
});
