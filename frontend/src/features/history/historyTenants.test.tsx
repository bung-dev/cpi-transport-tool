import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { TransportResult } from '../result/TransportResult';
import { HistoryTab } from './HistoryTab';

const old: TransportResponse = { transportId: 't-old', packageId: 'P', dryRun: true, deploy: false,
  startedAt: '2026-10-07T00:00:00Z', finishedAt: '2026-10-07T00:00:01Z', summary: { total: 0, succeeded: 0, failed: 0 }, results: [] };
const named: TransportResponse = { ...old, transportId: 't-named', sourceTenant: { id: 'deleted-source', name: '원본 당시 이름' },
  targetTenant: { id: 'renamed-target', name: '<b>대상 당시 이름</b>' } };
afterEach(() => vi.unstubAllGlobals());

it('REQ-308 AC-6·AC-7: 패키지 뒤 원본 대상 열과 이관 시점 이름을 보이고 기존 항목은 -다', async () => {
  const fn = mockApi({ 'GET /transport/history': () => json([named, old]) });
  render(<HistoryTab />);
  await screen.findByRole('table');
  expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['시작 시각', '패키지', '원본', '대상', '모드', '배포', '결과', '이관 ID']);
  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getAllByRole('cell').slice(1, 4).map(c => c.textContent)).toEqual(['P', '원본 당시 이름', '<b>대상 당시 이름</b>']);
  expect(within(rows[1]).getAllByRole('cell').slice(1, 4).map(c => c.textContent)).toEqual(['P', '-', '-']);
  expect(screen.getByText('<b>대상 당시 이름</b>').querySelector('b')).toBeNull();
  expect(fn).toHaveBeenCalledTimes(1);
});

it.each([['기록된 이름', named], ['필드 없는 기존 항목', old]] as const)('REQ-308 AC-6·AC-7: %s 상세 메타와 기존 네 행 순서를 보존한다', async (_, entry) => {
  const fn = mockApi({ 'GET /transport/history': () => json([entry]) });
  render(<HistoryTab />);
  await userEvent.click(await screen.findByRole('button', { name: entry.transportId }));
  const result = screen.getByRole('region', { name: '이관 결과' });
  expect(within(result).getAllByRole('term').map(t => t.textContent)).toEqual(['이관 ID', '패키지 ID', '시작', '종료', '원본 테넌트', '대상 테넌트']);
  expect(within(result).getByText('원본 테넌트').nextElementSibling?.textContent).toBe(entry.sourceTenant?.name ?? '-');
  expect(within(result).getByText('대상 테넌트').nextElementSibling?.textContent).toBe(entry.targetTenant?.name ?? '-');
  expect(fn).toHaveBeenCalledTimes(1);
});

it('REQ-308 AC-6·AC-7: 이관 결과도 응답의 테넌트 이름을 텍스트로 보인다', () => {
  render(<TransportResult result={named} />);
  expect(screen.getByText('원본 테넌트').nextElementSibling).toHaveTextContent('원본 당시 이름');
  const target = screen.getByText('대상 테넌트').nextElementSibling!;
  expect(target.textContent).toBe('<b>대상 당시 이름</b>');
  expect(target.querySelector('b')).toBeNull();
});
