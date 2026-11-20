import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import { json, packagesOf } from '../../test/mockFetch';
import { baseRoutes, navLink, renderAt } from '../../test/appRoutes';
import { mockApi } from '../../test/mockFetch';

// 20261120-r1-wording S2 REQ-806(+REQ-805 라우팅): 주소에 조건이 붙은 이관 이력 화면.
// 조건은 해시 `#/history?date=today&mode=…&result=…`이고, 같은 쿼리로 GET /transport/history를 부른다(REQ-804).
afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, over: Partial<TransportResponse> = {}): TransportResponse => ({
  transportId: id,
  packages: packagesOf('PkgTransportDemo'),
  dryRun: false,
  deploy: false,
  startedAt: '2026-11-20T01:00:00Z',
  finishedAt: '2026-11-20T01:00:01Z',
  summary: { total: 1, succeeded: 0, failed: 1 },
  results: [],
  ...over,
});

const Q_FAILED = '?date=today&mode=real&result=failed';
const ALL = [entry('t-fail'), entry('t-ok', { summary: { total: 1, succeeded: 1, failed: 0 } }), entry('t-dry', { dryRun: true })];

const conditionBar = () => screen.queryByRole('group', { name: '이력 조건' });
const dataRows = () => screen.getAllByRole('row').slice(1);
const historyCalls = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls.map(([input]) => String(input)).filter((u) => u.includes('/transport/history'));

describe('이력 조건 표시 줄 (REQ-806)', () => {
  it('REQ-806: 조건이 붙은 주소로 열면 같은 조건으로 서버에 요청하고, 표 위에 "조건: 오늘 · 실제 이관 · 실패", 건수, "조건 해제"가 보인다', async () => {
    const fn = mockApi(baseRoutes({
      [`GET /transport/history${Q_FAILED}`]: () => json([entry('t-fail')]),
      'GET /transport/history': () => json(ALL),
    }));
    renderAt(`#/history${Q_FAILED}`);
    await screen.findByRole('table');
    const bar = conditionBar()!;
    expect(bar).not.toBeNull();
    expect(bar).toHaveTextContent('조건: 오늘 · 실제 이관 · 실패');
    expect(bar).toHaveTextContent('1건');
    expect(within(bar).getByRole('button', { name: '조건 해제' })).toBeEnabled();
    expect(dataRows()).toHaveLength(1);
    expect(within(dataRows()[0]).getByRole('button', { name: 't-fail' })).toBeInTheDocument();
    expect(historyCalls(fn).every((u) => u.endsWith(`/transport/history${Q_FAILED}`))).toBe(true);
    // 쿼리가 붙어도 주 메뉴는 이관 이력이 현재 화면이다
    expect(navLink('이관 이력')).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['?date=today&mode=preview', '조건: 오늘 · 미리보기'],
    ['?date=today&mode=real', '조건: 오늘 · 실제 이관'],
    ['?date=today&mode=real&result=succeeded', '조건: 오늘 · 실제 이관 · 성공'],
    ['?date=today&mode=real&result=failed', '조건: 오늘 · 실제 이관 · 실패'],
  ])('REQ-806: %s의 조건 표기는 "%s"다', async (query, label) => {
    mockApi(baseRoutes({ [`GET /transport/history${query}`]: () => json([entry('t-1'), entry('t-2')]) }));
    renderAt(`#/history${query}`);
    await screen.findByRole('table');
    expect(conditionBar()).toHaveTextContent(label);
    expect(conditionBar()).toHaveTextContent('2건');
  });

  it('REQ-806: "조건 해제"를 누르면 주소가 #/history가 되고 전체 이력을 다시 읽어 조건 줄이 사라진다', async () => {
    const fn = mockApi(baseRoutes({
      [`GET /transport/history${Q_FAILED}`]: () => json([entry('t-fail')]),
      'GET /transport/history': () => json(ALL),
    }));
    renderAt(`#/history${Q_FAILED}`);
    await screen.findByRole('table');
    await userEvent.click(within(conditionBar()!).getByRole('button', { name: '조건 해제' }));
    await waitFor(() => expect(window.location.hash).toBe('#/history'));
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(conditionBar()).toBeNull();
    expect(historyCalls(fn).at(-1)).toMatch(/\/transport\/history$/);
  });

  it('REQ-806: 걸러진 결과가 0건이면 조건 줄은 남고 "조건에 맞는 이력이 없습니다"가 보인다', async () => {
    mockApi(baseRoutes({ [`GET /transport/history${Q_FAILED}`]: () => json([]) }));
    renderAt(`#/history${Q_FAILED}`);
    expect(await screen.findByText('조건에 맞는 이력이 없습니다')).toBeInTheDocument();
    expect(screen.queryByText('이관 이력이 없습니다')).toBeNull();
    expect(conditionBar()).toHaveTextContent('0건');
    expect(within(conditionBar()!).getByRole('button', { name: '조건 해제' })).toBeEnabled();
  });

  it('REQ-806: 새로고침 버튼은 같은 조건으로 다시 읽는다', async () => {
    const fn = mockApi(baseRoutes({ [`GET /transport/history${Q_FAILED}`]: () => json([entry('t-fail')]) }));
    renderAt(`#/history${Q_FAILED}`);
    await screen.findByRole('table');
    const before = historyCalls(fn).length;
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(historyCalls(fn).length).toBe(before + 1));
    expect(historyCalls(fn).at(-1)!.endsWith(`/transport/history${Q_FAILED}`)).toBe(true);
    expect(conditionBar()).toHaveTextContent('조건: 오늘 · 실제 이관 · 실패');
  });

  it('REQ-806: 걸러진 행의 상세를 열고 목록으로 돌아와도 조건이 유지된다', async () => {
    mockApi(baseRoutes({ [`GET /transport/history${Q_FAILED}`]: () => json([entry('t-fail')]) }));
    renderAt(`#/history${Q_FAILED}`);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 't-fail' }));
    await screen.findByRole('region', { name: '이관 결과' });
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    await screen.findByRole('table');
    expect(conditionBar()).toHaveTextContent('조건: 오늘 · 실제 이관 · 실패');
    expect(window.location.hash).toBe(`#/history${Q_FAILED}`);
  });

  it('REQ-806: 조건 없이 들어오면 조건 줄이 없고 지금 화면과 같다', async () => {
    mockApi(baseRoutes({ 'GET /transport/history': () => json(ALL) }));
    renderAt('#/history');
    await screen.findByRole('table');
    expect(conditionBar()).toBeNull();
    expect(dataRows()).toHaveLength(3);
  });

  it('REQ-806 실패: 잘못된 조건 값은 서버 400을 오류 알림으로 보이고 "조건 해제"로 전체 이력에 돌아갈 수 있다', async () => {
    mockApi(baseRoutes({
      'GET /transport/history?mode=x': () => json({ error: 'INVALID_REQUEST', message: 'Invalid request' }, 400),
      'GET /transport/history': () => json(ALL),
    }));
    renderAt('#/history?mode=x');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(within(conditionBar()!).getByRole('button', { name: '조건 해제' }));
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('REQ-806 실패: 서버 오류면 기존 오류 알림과 다시 시도가 보이고 조건 줄은 남는다', async () => {
    let fail = true;
    mockApi(baseRoutes({
      [`GET /transport/history${Q_FAILED}`]: () => (fail ? json({ error: 'INTERNAL_ERROR', message: 'boom' }, 500) : json([entry('t-fail')])),
    }));
    renderAt(`#/history${Q_FAILED}`);
    const alert = await screen.findByRole('alert');
    expect(conditionBar()).toHaveTextContent('조건: 오늘 · 실제 이관 · 실패');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(dataRows()).toHaveLength(1));
  });
});
