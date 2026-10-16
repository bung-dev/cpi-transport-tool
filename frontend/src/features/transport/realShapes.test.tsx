import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { TestTenantProvider } from '../../test/tenantProvider';
import { TransportTab } from './TransportTab';

const name = '한글 공백 "따옴표" & 설명';
afterEach(() => vi.unstubAllGlobals());

it('REQ-304 AC-3: 규칙 밖 ID도 목록에 보이고 선택 후 400 오류 제목이 보인다', async () => {
  const id = 'bad id';
  const fn = mockApi({
    'GET /packages?tenantId=DEV': () => json([{ id, name, version: '1' }]),
    'GET /packages/bad%20id/artifacts?tenantId=DEV': () => json({ error: 'INVALID_REQUEST', message: 'Invalid request' }, 400),
  });
  render(<TransportTab />, { wrapper: TestTenantProvider });
  const list = await screen.findByRole('list', { name: '패키지 목록' });
  expect(within(list).getByText(name)).toHaveTextContent(name);
  expect(within(list).getByText(id)).toBeInTheDocument();
  await userEvent.click(within(list).getByRole('radio'));
  expect(await screen.findByText('요청 값이 올바르지 않습니다')).toBeInTheDocument();
  expect(within(list).getByRole('radio')).toBeChecked();
  expect(fn.mock.calls.map(([input]) => input)).toContain('/packages/bad%20id/artifacts?tenantId=DEV');
  expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('REQ-304 AC-3: 한글 공백 따옴표 & 이름을 그대로 표시하고 선택한 ID로 드라이런한다', async () => {
  const artifactName = '아티팩트 "한글 이름" & 설명';
  const fn = mockApi({
    'GET /packages?tenantId=DEV': () => json([{ id: 'Pkg', name, version: '1' }]),
    'GET /packages/Pkg/artifacts?tenantId=DEV': () => json([{ id: 'Flow', name: artifactName, version: '1' }]),
    'POST /transport': () => json({
      transportId: 'shape-dry-run', packageId: 'Pkg', dryRun: true, deploy: false,
      startedAt: '2026-10-16T00:00:00Z', finishedAt: '2026-10-16T00:00:01Z',
      summary: { total: 1, succeeded: 1, failed: 0 }, results: [],
    }),
  });
  render(<TransportTab />, { wrapper: TestTenantProvider });
  const packages = await screen.findByRole('list', { name: '패키지 목록' });
  expect(within(packages).getByText(name)).toHaveTextContent(name);
  await userEvent.click(within(packages).getByRole('radio'));
  const artifacts = await screen.findByRole('list', { name: '아티팩트 목록' });
  expect(within(artifacts).getByText(artifactName)).toHaveTextContent(artifactName);
  await userEvent.click(within(artifacts).getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: '드라이런 실행' }));
  await waitFor(() => expect(screen.getByRole('region', { name: '이관 결과' })).toBeInTheDocument());
  const posts = fn.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1]?.body as string)).toEqual({
    packageId: 'Pkg', artifactIds: ['Flow'], dryRun: true, deploy: false,
    sourceTenantId: 'DEV', targetTenantId: 'PRD',
  });
});
