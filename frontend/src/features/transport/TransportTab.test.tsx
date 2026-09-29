import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TransportTab } from './TransportTab';

afterEach(() => vi.unstubAllGlobals());

describe('이관 탭 통합', () => {
  it('REQ-005 AC-4: 선택 후 실행하면 응답이 같은 탭 아래 이관 결과로 표시된다', async () => {
    const result = {
      transportId: 't-9',
      packageId: 'PkgTransportDemo',
      dryRun: true,
      deploy: false,
      startedAt: '2026-09-29T07:05:05.351940500Z',
      finishedAt: '2026-09-29T07:05:06Z',
      summary: { total: 1, succeeded: 1, failed: 0 },
      results: [],
    };
    const fn = mockApi({
      'GET /packages': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts': () => json(ARTIFACTS),
      'POST /transport': () => json(result),
    });
    render(<TransportTab />);
    await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /IF_Customer_Push/ }));
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    expect(await screen.findByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '이관 결과' })).toHaveTextContent('transportId: t-9');
    const post = fn.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      packageId: 'PkgTransportDemo',
      artifactIds: ['IF_Customer_Push'],
      dryRun: true,
      deploy: false,
    });
  });
});
