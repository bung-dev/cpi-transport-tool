import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

afterEach(() => vi.unstubAllGlobals());

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
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(boxes[1]);
    expect(boxes[1]).toBeChecked();
    expect(boxes[0]).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(screen.getAllByRole('checkbox').every((b) => (b as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(screen.getAllByRole('checkbox').every((b) => !(b as HTMLInputElement).checked)).toBe(true);
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
    expect(screen.getAllByRole('checkbox').every((b) => !(b as HTMLInputElement).checked)).toBe(true);
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
});
