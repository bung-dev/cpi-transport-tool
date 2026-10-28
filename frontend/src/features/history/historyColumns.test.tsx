import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { HistoryTab } from './HistoryTab';

// jsdom은 배치를 계산하지 않으므로 1280×900·390×844의 실제 넘침 측정은 브라우저 시험이 한다.
// 여기서는 그 배치를 만드는 구조(셀의 줄바꿈 클래스, 표 래퍼의 가로 스크롤, 표 최소 폭, 값 전체 렌더)를 확인한다.

afterEach(() => vi.unstubAllGlobals());

// REQ-317 AC-1 판정 데이터(가장 넓은 행): 패키지 ID 40자, 원본·대상 이름 각 40자, 실제 이관 + 배포 + 배포 실패, 성공 0 / 전체 2 + 실패 2, UUID 36자.
const PACKAGE_ID = 'PkgTransportDemoWithAVeryLongIdentifier1';
const SOURCE_NAME = 'Integration-Suite-Development-Tenant-001';
const TARGET_NAME = '통합스위트운영테넌트-Integration-Production-PRD001';
const TRANSPORT_ID = '3f2b9c1e-7a4d-4e8b-9c2f-1a6d5e7b8c90';

function failed(artifactId: string): ArtifactResult {
  return {
    artifactId, status: 'FAILED', action: 'UPDATED', deployStatus: 'ERROR', replacements: [], unmappedKeys: [],
    error: { code: 'DEPLOY_FAILED', message: 'DEPLOY: CPI deployment ERROR', detail: null, detailHttpStatus: 200 },
  };
}

function widest(over: Partial<TransportResponse> = {}): TransportResponse {
  return {
    transportId: TRANSPORT_ID,
    packageId: PACKAGE_ID,
    sourceTenant: { id: 'src-1', name: SOURCE_NAME },
    targetTenant: { id: 'tgt-1', name: TARGET_NAME },
    dryRun: false,
    deploy: true,
    startedAt: '2026-10-20T14:59:59Z',
    finishedAt: '2026-10-20T15:00:30Z',
    summary: { total: 2, succeeded: 0, failed: 2 },
    results: [failed('IF_Long_Artifact_0'), failed('IF_Long_Artifact_1')],
    ...over,
  };
}

async function showHistory(entries: TransportResponse[]) {
  mockApi({ 'GET /transport/history': () => json(entries) });
  render(<HistoryTab />);
  return screen.findByRole('table');
}

function cellsOf(row: HTMLElement) {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
  const cells = within(row).getAllByRole('cell');
  return Object.fromEntries(headers.map((h, i) => [h, cells[i]])) as Record<string, HTMLElement>;
}

const LONG_COLUMNS = ['패키지', '원본', '대상', '이관 ID'];
const SHORT_COLUMNS = ['시작 시각', '모드', '배포', '결과'];
// 말줄임·잘라 숨기기 클래스. 줄바꿈 방식을 택했으므로 표 안 어디에도 없어야 한다(전체 값이 항상 보인다).
const CLIPPING = /(?:^|\s)(?:truncate|text-ellipsis|text-clip|overflow-hidden|line-clamp-\d+)(?:\s|$)/;

describe('이력 목록 열 표시 (REQ-317)', () => {
  it('REQ-317 AC-1·AC-3: 가장 넓은 행에서 긴 텍스트 셀(패키지·원본·대상·이관 ID)은 줄바꿈을 허용하고 짧은 셀(시작 시각·모드·배포·결과)은 줄바꿈하지 않는다', async () => {
    expect([PACKAGE_ID, SOURCE_NAME, TARGET_NAME].map((v) => v.length)).toEqual([40, 40, 40]);
    expect(TRANSPORT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await showHistory([widest()]);
    const row = screen.getAllByRole('row')[1];
    const cells = cellsOf(row);
    expect(Object.keys(cells)).toEqual(['시작 시각', '패키지', '원본', '대상', '모드', '배포', '결과', '이관 ID']);

    for (const column of LONG_COLUMNS) {
      const cell = cells[column];
      expect(cell, column).toHaveClass('break-all');
      expect(cell, column).not.toHaveClass('whitespace-nowrap');
      expect(cell, column).not.toHaveClass('whitespace-pre');
    }
    for (const column of SHORT_COLUMNS) {
      expect(cells[column], column).toHaveClass('whitespace-nowrap');
    }
    // 이관 ID 버튼 자신도 줄바꿈을 막지 않는다(셀 안에서 UUID가 여러 줄로 나뉠 수 있다).
    const idButton = within(cells['이관 ID']).getByRole('button');
    expect(idButton).toHaveClass('break-all');
    expect(idButton.className).not.toMatch(/(?:^|\s)whitespace-(?:nowrap|pre)(?:\s|$)/);
    for (const el of [screen.getByRole('table'), ...screen.getByRole('table').querySelectorAll('*')]) {
      expect(el.getAttribute('class') ?? '').not.toMatch(CLIPPING);
    }
  });

  it('REQ-317 AC-1·AC-3: 판정 데이터의 모든 값이 줄이지 않은 전체 문자열로 보이고 짧은 셀의 배지 구성은 그대로다', async () => {
    await showHistory([widest()]);
    const cells = cellsOf(screen.getAllByRole('row')[1]);
    expect(cells['패키지'].textContent).toBe(PACKAGE_ID);
    expect(cells['원본'].textContent).toBe(SOURCE_NAME);
    expect(cells['대상'].textContent).toBe(TARGET_NAME);
    expect(cells['이관 ID'].textContent).toBe(TRANSPORT_ID);
    expect(cells['모드'].textContent).toBe('실제 이관');
    expect(within(cells['배포']).getByText('배포')).toHaveClass('bg-info-bg');
    expect(within(cells['배포']).getByText('실패 2')).toHaveClass('bg-danger-bg');
    expect(within(cells['결과']).getByText('성공 0 / 전체 2')).toBeInTheDocument();
    expect(within(cells['결과']).getByText('실패 2')).toHaveClass('bg-danger-bg');
    // 짧은 셀 안의 배지 묶음은 한 줄로 유지된다(셀이 nowrap이고 묶음은 inline-flex).
    for (const column of ['배포', '결과']) {
      expect(cells[column].firstElementChild, column).toHaveClass('inline-flex', 'items-center', 'gap-2');
    }
  });

  it('REQ-317 AC-1·AC-3: 이관 ID는 버튼으로 전체 UUID가 접근 가능한 이름이고 Enter·클릭으로 같은 상세가 열린다(현재 버튼 동작 유지)', async () => {
    await showHistory([widest(), widest({ transportId: 'b7e0c1d2-0000-4000-8000-000000000002', dryRun: true, deploy: false })]);
    const button = screen.getByRole('button', { name: TRANSPORT_ID });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button.closest('tr')).not.toHaveAttribute('tabindex');
    button.focus();
    await userEvent.keyboard('{Enter}');
    const region = screen.getByRole('region', { name: '이관 결과' });
    expect(within(region).getByText('이관 ID').nextElementSibling).toHaveTextContent(TRANSPORT_ID);
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(screen.getByRole('button', { name: TRANSPORT_ID })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'b7e0c1d2-0000-4000-8000-000000000002' }));
    expect(within(screen.getByRole('region', { name: '이관 결과' })).getByText('이관 ID').nextElementSibling)
      .toHaveTextContent('b7e0c1d2-0000-4000-8000-000000000002');
  });

  it('REQ-317 AC-2·AC-3: 좁은 폭에서는 표 래퍼 안에서 가로로 스크롤한다 — 래퍼 overflow-x-auto, 표 w-full·min-w-[720px], 열 머리는 줄바꿈하지 않고 바깥 컨테이너는 min-w-0', async () => {
    const table = await showHistory([widest()]);
    const wrapper = table.parentElement!;
    expect(wrapper).toHaveClass('overflow-x-auto', 'rounded-lg', 'border', 'border-hairline');
    expect(wrapper.className).not.toMatch(/(?:^|\s)overflow-(?:hidden|visible|clip)(?:\s|$)/);
    expect(table).toHaveClass('w-full', 'min-w-[720px]');
    // 표 래퍼가 부모 폭을 넘지 않게 하는 바깥 컨테이너(flex 열·탭 루트)는 min-w-0이다(REQ-108 AC-1 유지).
    expect(wrapper.parentElement).toHaveClass('flex', 'flex-col', 'min-w-0');
    expect(wrapper.parentElement!.parentElement).toHaveClass('min-w-0');
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header, header.textContent ?? '').toHaveClass('whitespace-nowrap');
    }
    // 긴 텍스트 셀은 최소 폭 하한(min-w-28)을 가져 좁은 폭의 가로 스크롤에서 몇 글자 폭으로 눌리지 않는다.
    const cells = cellsOf(screen.getAllByRole('row')[1]);
    for (const column of LONG_COLUMNS) {
      expect(cells[column], column).toHaveClass('min-w-28');
    }
    // 열 너비를 코드에 고정하지 않는다(데이터 길이에 맞춰 자동 배분, table-layout auto).
    expect(table.className).not.toMatch(/(?:^|\s)table-fixed(?:\s|$)/);
  });
});
