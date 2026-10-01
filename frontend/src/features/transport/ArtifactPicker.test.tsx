import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

afterEach(() => vi.unstubAllGlobals());

const boxes = () => within(screen.getByRole('list', { name: '아티팩트 목록' })).getAllByRole('checkbox') as HTMLInputElement[];

async function openDemo() {
  render(<TransportTab />);
  await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
}

describe('아티팩트 선택', () => {
  it('REQ-004 AC-3: 개별 선택, 전체 선택, 선택 해제', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    expect(boxes().every((b) => !b.checked)).toBe(true);
    await userEvent.click(boxes()[1]);
    expect(boxes()[1]).toBeChecked();
    expect(boxes()[0]).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(boxes().every((b) => b.checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(boxes().every((b) => !b.checked)).toBe(true);
  });

  it('REQ-004 AC-3: 다른 패키지를 고르면 이전 선택이 비워진다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
      'GET /packages/PkgNotInPrd/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    await userEvent.click(screen.getByRole('radio', { name: /Not In PRD/ }));
    await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
    expect(boxes().every((b) => !b.checked)).toBe(true);
  });

  it('REQ-004 AC-4: 아티팩트 조회 오류 후 다시 시도가 같은 packageId로 재조회한다', async () => {
    let n = 0;
    const fn = mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () =>
        ++n === 1 ? json({ error: 'PACKAGE_NOT_FOUND', message: 'Package not found' }, 404) : json(ARTIFACTS),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('패키지를 찾을 수 없습니다');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
    const urls = fn.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/artifacts'));
    expect(urls).toEqual(['/packages/PkgTransportDemo/artifacts', '/packages/PkgTransportDemo/artifacts']);
  });

  it('REQ-104 AC-4: 패키지를 고르기 전에도 아티팩트 카드가 보이고 "패키지를 먼저 선택하세요" 빈 상태를 보인다', async () => {
    mockApi({ 'GET /packages': () => json(PACKAGES) });
    render(<TransportTab />);
    await screen.findByLabelText('패키지 검색');
    expect(screen.getByRole('heading', { name: '아티팩트' })).toBeInTheDocument();
    expect(screen.getByText('패키지를 먼저 선택하세요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '전체 선택' })).toBeNull();
    expect(screen.queryByText(/개 선택 \/ 전체/)).toBeNull();
  });

  it('REQ-104 AC-4: 조회가 성공하면 카드 머리에 "n개 선택 / 전체 m개"와 sm 크기 전체 선택·선택 해제 버튼이 보인다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    expect(screen.getByText('0개 선택 / 전체 2개')).toBeInTheDocument();
    await userEvent.click(boxes()[0]);
    expect(screen.getByText('1개 선택 / 전체 2개')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(screen.getByText('2개 선택 / 전체 2개')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(screen.getByText('0개 선택 / 전체 2개')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 선택' }).className).toContain('h-7');
    expect(screen.getByRole('button', { name: '선택 해제' }).className).toContain('h-7');
  });

  it('REQ-104 AC-4: 행 전체가 클릭 영역인 체크박스 목록이다(id 고정폭·500, name ink-secondary, version 12px ink-tertiary, 행 40px 이상, 360px 안쪽 스크롤)', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    const list = screen.getByRole('list', { name: '아티팩트 목록' });
    expect(list.className).toContain('max-h-[360px]');
    expect(list.className).toContain('overflow-y-auto');
    await userEvent.click(within(list).getByText('Customer Push'));
    expect(boxes()[1]).toBeChecked();
    const row = boxes()[1].closest('label') as HTMLElement;
    expect(row.className).toContain('bg-primary-soft');
    expect(row.className).toContain('min-h-10');
    expect(boxes()[0].closest('label')?.className).toContain('hover:bg-surface-hover');
    expect(within(list).getByText('IF_Order_Sync').className).toContain('font-mono');
    expect(within(list).getByText('IF_Order_Sync').className).toContain('font-medium');
    expect(within(list).getByText('Order Sync').className).toContain('text-ink-secondary');
    expect(within(list).getByText('1.0.3').className).toContain('text-xs');
    expect(within(list).getByText('1.0.3').className).toContain('text-ink-tertiary');
  });

  it('REQ-104 AC-4: 아티팩트가 없으면 "아티팩트가 없습니다"를 보이고 개수는 0개 선택 / 전체 0개다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json([]),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    expect(await screen.findByText('아티팩트가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('0개 선택 / 전체 0개')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '아티팩트 목록' })).toBeNull();
  });

  it('REQ-104 AC-4: 조회 중과 조회 오류에서는 선택 개수와 전체 선택 버튼을 보이지 않는다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => new Promise<Response>((r) => (release = r)),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    expect(screen.queryByText(/개 선택 \/ 전체/)).toBeNull();
    expect(screen.queryByRole('button', { name: '전체 선택' })).toBeNull();
    release(json({ error: 'PACKAGE_NOT_FOUND', message: 'Package not found' }, 404));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/개 선택 \/ 전체/)).toBeNull();
    expect(screen.queryByRole('button', { name: '전체 선택' })).toBeNull();
  });

  it('REQ-107 AC-1: 아티팩트 조회 중에는 목록 행 모양의 스켈레톤 3개 이상과 role=status "불러오는 중"을 보인다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => new Promise<Response>((r) => (release = r)),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('불러오는 중');
    expect(status.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3);
    release(json(ARTIFACTS));
    await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('REQ-107 AC-2: 빈 상태 "패키지를 먼저 선택하세요", "아티팩트가 없습니다"는 EmptyState(아이콘 + 글자, 가운데 정렬, ink-secondary)다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json([]),
    });
    render(<TransportTab />);
    const first = (await screen.findByText('패키지를 먼저 선택하세요')).parentElement as HTMLElement;
    expect(first.className).toContain('text-center');
    expect(first.className).toContain('text-ink-secondary');
    expect(first.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    const none = (await screen.findByText('아티팩트가 없습니다')).parentElement as HTMLElement;
    expect(none.className).toContain('text-center');
    expect(none.className).toContain('text-ink-secondary');
    expect(none.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('REQ-101 AC-4: 아티팩트 id 값은 고정폭 글꼴이다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    expect(screen.getByText('IF_Customer_Push').className).toContain('font-mono');
    expect(screen.getByText('Customer Push').className).not.toContain('font-mono');
  });

  it('REQ-101 AC-6: 아티팩트 행의 배경(hover·선택) 변화에 150ms 전환이 있다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    const row = boxes()[0].closest('label') as HTMLElement;
    expect(row.className).toContain('transition-colors');
    expect(row.className).toContain('duration-150');
  });

  it('REQ-101 AC-7: 아티팩트 행의 체크박스는 input 자체를 그린 모양이고 행·카드 머리 버튼이 외곽선을 지우지 않는다', async () => {
    mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
    });
    await openDemo();
    const box = boxes()[0];
    expect(box.className).toContain('appearance-none');
    expect(`${box.className} ${box.closest('label')?.className}`).not.toMatch(/outline-(none|0|hidden)/);
    expect(screen.getByRole('button', { name: '전체 선택' }).className).not.toMatch(/outline-(none|0|hidden)/);
  });
});
