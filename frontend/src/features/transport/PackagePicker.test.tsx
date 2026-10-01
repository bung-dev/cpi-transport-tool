import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

afterEach(() => vi.unstubAllGlobals());

// 실행 카드의 실행 모드 라디오와 구분하려고 패키지 목록 안의 라디오만 센다.
const pkgRadios = () => within(screen.getByRole('list', { name: '패키지 목록' })).queryAllByRole('radio');

describe('패키지 목록', () => {
  it('REQ-004 AC-1: 조회 중에는 불러오는 중(role=status)을 보인다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ 'GET /packages': () => new Promise<Response>((r) => (release = r)) });
    render(<TransportTab />);
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중');
    release(json(PACKAGES));
    await screen.findByLabelText('패키지 검색');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('REQ-004 AC-1: 패키지 목록(id, name, version)을 radio로 보이고 fetch는 1회', async () => {
    const fn = mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const radio = await screen.findByRole('radio', { name: /Transport Demo/ });
    expect(radio).toHaveAttribute('name', 'package');
    expect(screen.getByRole('radio', { name: /PkgTransportDemo/ })).toBeInTheDocument();
    expect(pkgRadios()).toHaveLength(3);
    expect(screen.getAllByText('1.0.0')).toHaveLength(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('REQ-004 AC-1: 빈 배열이면 패키지가 없습니다', async () => {
    mockApi({ 'GET /packages': () => json([]) });
    render(<TransportTab />);
    expect(await screen.findByText('패키지가 없습니다')).toBeInTheDocument();
  });

  it('REQ-004 AC-2: id 또는 name에 대소문자 무시로 필터하고 API 추가 호출이 없다', async () => {
    const fn = mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const input = await screen.findByLabelText('패키지 검색');
    await userEvent.type(input, 'FAULT');
    expect(pkgRadios()).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /PkgFaultDemo/ })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'not in');
    expect(screen.getByRole('radio', { name: /PkgNotInPrd/ })).toBeInTheDocument();
    expect(pkgRadios()).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('REQ-004 AC-2: 정규식 특수문자 입력도 글자 그대로 비교하고 예외가 없다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const input = await screen.findByLabelText('패키지 검색');
    await userEvent.type(input, '([[');
    expect(screen.queryByRole('list', { name: '패키지 목록' })).toBeNull();
    expect(input).toBeInTheDocument();
  });

  it('REQ-004 AC-4: 오류 후 다시 시도가 같은 URL을 다시 호출한다', async () => {
    let n = 0;
    const fn = mockApi({
      'GET /packages': () =>
        ++n === 1 ? json({ error: 'CPI_UNAVAILABLE', message: 'CPI unavailable' }, 502) : json(PACKAGES),
    });
    render(<TransportTab />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    expect(alert).toHaveTextContent('CPI unavailable');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByRole('list', { name: '패키지 목록' });
    expect(pkgRadios()).toHaveLength(3);
    expect(fn.mock.calls.map((c) => String(c[0]))).toEqual(['/packages', '/packages']);
  });

  it('REQ-004 AC-3: 패키지를 고르면 아티팩트를 1회 조회해 보인다', async () => {
    const fn = mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
    expect(screen.getByRole('checkbox', { name: /Customer Push/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /2\.1\.0/ })).toBeInTheDocument();
    expect(fn.mock.calls.filter((c) => String(c[0]).endsWith('/artifacts'))).toHaveLength(1);
  });

  it('REQ-004 AC-3: 빠르게 다른 패키지를 고르면 마지막 선택의 응답만 반영한다', async () => {
    let releaseFirst: (r: Response) => void = () => {};
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => new Promise<Response>((r) => (releaseFirst = r)),
      'GET /packages/PkgNotInPrd/artifacts': () => json([{ id: 'IF_Orphan', name: 'IF_Orphan', version: '1' }]),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Not In PRD/ }));
    await screen.findByRole('checkbox', { name: /IF_Orphan/ });
    releaseFirst(json(ARTIFACTS));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '아티팩트 목록' })).getAllByRole('checkbox')).toHaveLength(1),
    );
    expect(screen.queryByRole('checkbox', { name: /IF_Order_Sync/ })).toBeNull();
  });

  it('REQ-104 AC-2: 행의 어느 곳(이름·ID·버전)을 눌러도 그 패키지가 선택되고 선택된 행은 primary-soft다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES), 'GET /packages/PkgFaultDemo/artifacts': () => json([]) });
    render(<TransportTab />);
    const list = await screen.findByRole('list', { name: '패키지 목록' });
    const rowOf = (text: string) => within(list).getByText(text).closest('label') as HTMLElement;
    await userEvent.click(within(list).getByText('Fault Demo'));
    expect(screen.getByRole('radio', { name: /Fault Demo/ })).toBeChecked();
    expect(rowOf('Fault Demo').className).toContain('bg-primary-soft');
    expect(rowOf('Transport Demo').className).not.toContain('bg-primary-soft');
    await userEvent.click(within(list).getByText('PkgNotInPrd'));
    expect(screen.getByRole('radio', { name: /Not In PRD/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Fault Demo/ })).not.toBeChecked();
    expect(pkgRadios().filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
  });

  it('REQ-104 AC-2: 라디오의 접근 가능한 이름에 name, id, version이 모두 들어가고 행은 40px 이상·hover surface-hover·목록은 360px 안쪽 스크롤이다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const radio = await screen.findByRole('radio', { name: /Transport Demo/ });
    expect(radio).toHaveAccessibleName(/Transport Demo/);
    expect(radio).toHaveAccessibleName(/PkgTransportDemo/);
    expect(radio).toHaveAccessibleName(/1\.0\.0/);
    const row = radio.closest('label') as HTMLElement;
    expect(row.className).toContain('min-h-10');
    expect(row.className).toContain('hover:bg-surface-hover');
    expect(row.className).toContain('cursor-pointer');
    const list = screen.getByRole('list', { name: '패키지 목록' });
    expect(list.className).toContain('max-h-[360px]');
    expect(list.className).toContain('overflow-y-auto');
    expect(screen.getByText('Transport Demo').className).toContain('font-medium');
    expect(screen.getByText('PkgTransportDemo').className).toContain('text-ink-secondary');
    expect(within(list).getAllByText('1.0.0')[0].className).toContain('text-ink-tertiary');
    expect(within(list).getAllByText('1.0.0')[0].className).toContain('text-xs');
  });

  it('REQ-104 AC-3: 검색 입력은 돋보기 아이콘·placeholder·연결된 label이 있고 개수 문구가 "전체 N개" → "N개 중 M개"로 바뀐다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const input = await screen.findByLabelText('패키지 검색');
    expect(input).toHaveAttribute('placeholder', '이름 또는 ID로 검색');
    expect(input.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('전체 3개')).toBeInTheDocument();
    await userEvent.type(input, 'fault');
    expect(screen.getByText('3개 중 1개')).toBeInTheDocument();
    expect(screen.queryByText('전체 3개')).toBeNull();
    await userEvent.clear(input);
    expect(screen.getByText('전체 3개')).toBeInTheDocument();
  });

  it('REQ-104 AC-3: 검색 결과가 0개면 목록 대신 "검색 결과가 없습니다"를 보인다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    await userEvent.type(await screen.findByLabelText('패키지 검색'), 'zzz');
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('3개 중 0개')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '패키지 목록' })).toBeNull();
  });

  it('REQ-107 AC-1: 패키지 조회 중에는 목록 행 모양의 스켈레톤 3개 이상과 role=status "불러오는 중"을 보인다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ 'GET /packages': () => new Promise<Response>((r) => (release = r)) });
    render(<TransportTab />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('불러오는 중');
    expect(status.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3);
    expect(status.querySelectorAll('div.h-10').length).toBeGreaterThanOrEqual(3);
    release(json(PACKAGES));
    await screen.findByLabelText('패키지 검색');
  });

  it('REQ-107 AC-2: 빈 상태 "패키지가 없습니다", "검색 결과가 없습니다"는 EmptyState(아이콘 + 글자, 가운데 정렬, ink-secondary)다', async () => {
    mockApi({ 'GET /packages': () => json([]) });
    const { unmount } = render(<TransportTab />);
    const empty = (await screen.findByText('패키지가 없습니다')).parentElement as HTMLElement;
    expect(empty.className).toContain('text-center');
    expect(empty.className).toContain('text-ink-secondary');
    expect(empty.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    unmount();
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    await userEvent.type(await screen.findByLabelText('패키지 검색'), 'zzz');
    const none = screen.getByText('검색 결과가 없습니다').parentElement as HTMLElement;
    expect(none.className).toContain('text-center');
    expect(none.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('REQ-101 AC-4: 패키지 id 값은 고정폭 글꼴이다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    await screen.findByLabelText('패키지 검색');
    expect(screen.getByText('PkgTransportDemo').className).toContain('font-mono');
    expect(screen.getByText('Transport Demo').className).not.toContain('font-mono');
  });

  it('REQ-101 AC-6: 패키지 행의 배경(hover·선택) 변화에 150ms 전환이 있다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const row = (await screen.findByRole('radio', { name: /Transport Demo/ })).closest('label') as HTMLElement;
    expect(row.className).toContain('transition-colors');
    expect(row.className).toContain('duration-150');
  });

  it('REQ-101 AC-7: 패키지 행의 라디오는 input 자체를 그린 모양이고 외곽선을 지우지 않으며 검색 입력도 잘리지 않는다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const radio = await screen.findByRole('radio', { name: /Transport Demo/ });
    expect(radio.className).toContain('appearance-none');
    const row = radio.closest('label') as HTMLElement;
    expect(row.className).toContain('px-2.5');
    expect(`${row.className} ${radio.className}`).not.toMatch(/outline-(none|0|hidden)/);
    const input = screen.getByLabelText('패키지 검색');
    expect(input.className).not.toMatch(/outline-(none|0|hidden)/);
    expect(input.parentElement?.className).not.toContain('overflow-hidden');
  });
});
