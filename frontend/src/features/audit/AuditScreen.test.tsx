import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatTime } from '../../lib/formatTime';
import { json, mockApi } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';

// REQ-414 감사 이력 화면
afterEach(() => vi.unstubAllGlobals());

const ENTRIES = [
  { id: 'a-3', time: '2026-11-11T03:00:00Z', category: 'transport', action: 'transport', objectId: 'tr-9', objectName: 'PkgTransportDemo', detail: 'DEV → PRD · 성공 2 · 실패 0' },
  { id: 'a-2', time: '2026-11-11T02:00:00Z', category: 'template', action: 'created', objectId: 'tp-1', objectName: '개발에서 운영', detail: 'DEV → PRD' },
  { id: 'a-1', time: '2026-11-11T01:00:00Z', category: 'tenant', action: 'updated', objectId: 't-new', objectName: '새 테넌트', detail: '서비스 키 교체' },
  { id: 'a-0', time: '2026-11-11T00:00:00Z', category: 'transport', action: 'preview', objectId: 'tr-8', objectName: 'PkgFaultDemo', detail: 'DEV → PRD · 성공 1 · 실패 1' },
];
const byCategory = (c: string) => (c === 'all' ? ENTRIES : ENTRIES.filter((e) => e.category === c));

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const routes: Parameters<typeof mockApi>[0] = {};
  for (const c of ['all', 'tenant', 'template', 'transport']) routes[`GET /audit?category=${c}`] = () => json(byCategory(c));
  const fn = mockApi(baseRoutes({ ...routes, ...extra }));
  renderAt('#/audit');
  return fn;
}
const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('REQ-414 감사 이력', () => {
  it('REQ-414: 분류 필터(전체·테넌트·템플릿·이관)와 시간 역순 목록(시각·분류·동작·대상 이름·내용)이 보인다', async () => {
    const fn = setup();
    await screen.findByRole('cell', { name: 'PkgTransportDemo' });
    const filter = screen.getByRole('radiogroup', { name: '분류' });
    expect(within(filter).getAllByRole('radio').map((r) => r.closest('label')?.textContent?.trim() ?? r.getAttribute('aria-label'))).toEqual(['전체', '테넌트', '템플릿', '이관']);
    expect(within(filter).getByRole('radio', { name: '전체' })).toBeChecked();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['시각', '분류', '동작', '대상 이름', '내용']);
    const rows = bodyRows();
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual([
      formatTime(ENTRIES[0].time), '이관', '실제 이관', 'PkgTransportDemo', 'DEV → PRD · 성공 2 · 실패 0',
    ]);
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent?.trim()).slice(1, 4)).toEqual(['템플릿', '생성', '개발에서 운영']);
    expect(within(rows[2]).getAllByRole('cell').map((c) => c.textContent?.trim()).slice(1, 5)).toEqual(['테넌트', '수정', '새 테넌트', '서비스 키 교체']);
    expect(within(rows[3]).getAllByRole('cell').map((c) => c.textContent?.trim()).slice(1, 3)).toEqual(['이관', '미리보기']);
    expect(fn.mock.calls.map(([u]) => u)).toContain('/audit?category=all');
  });

  it('REQ-414: 서버가 순서를 섞어 보내도 시간 역순으로 보인다', async () => {
    setup({ 'GET /audit?category=all': () => json([ENTRIES[3], ENTRIES[1], ENTRIES[0], ENTRIES[2]]) });
    await screen.findByRole('cell', { name: 'PkgTransportDemo' });
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[3].textContent)).toEqual(['PkgTransportDemo', '개발에서 운영', '새 테넌트', 'PkgFaultDemo']);
  });

  it.each([
    ['테넌트', 'tenant', ['새 테넌트']],
    ['템플릿', 'template', ['개발에서 운영']],
    ['이관', 'transport', ['PkgTransportDemo', 'PkgFaultDemo']],
  ] as const)('REQ-414: 필터 %s를 고르면 category=%s로 조회하고 그 분류만 남는다', async (label, category, names) => {
    const fn = setup();
    await screen.findByRole('cell', { name: 'PkgTransportDemo' });
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '분류' })).getByRole('radio', { name: label }));
    await waitFor(() => expect(bodyRows()).toHaveLength(names.length));
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[3].textContent)).toEqual(names);
    expect(fn.mock.calls.map(([u]) => u)).toContain(`/audit?category=${category}`);
  });

  it('REQ-414 실패: 빈 목록이면 빈 상태 안내를 보인다', async () => {
    setup({ 'GET /audit?category=all': () => json([]) });
    expect(await screen.findByText('감사 이력이 없습니다')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('REQ-414 실패: 조회 실패는 오류와 "다시 시도"이고 다시 시도하면 다시 조회한다', async () => {
    let fail = true;
    const fn = setup({ 'GET /audit?category=all': () => (fail ? json({ error: 'INVALID_REQUEST', message: 'bad' }, 400) : json(ENTRIES)) });
    expect(await screen.findByRole('alert')).toHaveTextContent('요청 값이 올바르지 않습니다');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('cell', { name: 'PkgTransportDemo' })).toBeInTheDocument();
    expect(fn.mock.calls.filter(([u]) => u === '/audit?category=all')).toHaveLength(2);
  });
});
