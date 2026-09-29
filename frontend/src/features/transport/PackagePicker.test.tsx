import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getAllByRole('radio')).toHaveLength(3);
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
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /PkgFaultDemo/ })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'not in');
    expect(screen.getByRole('radio', { name: /PkgNotInPrd/ })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('REQ-004 AC-2: 정규식 특수문자 입력도 글자 그대로 비교하고 예외가 없다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    const input = await screen.findByLabelText('패키지 검색');
    await userEvent.type(input, '([[');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
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
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
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
});
