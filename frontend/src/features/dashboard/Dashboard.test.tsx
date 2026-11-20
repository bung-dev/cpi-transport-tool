import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantsResponse, TenantStatusResponse, TransportRequest, TransportResponse } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';
import { baseRoutes, navLink, renderAt, tpl } from '../../test/appRoutes';
import { currentStep, findArtifactGrid, findPackageSection, postBodies, routeBar, stepButton } from '../../test/wizard';

// S4 REQ-430 대시보드. 앱 전체를 #/dashboard로 그려 확인한다.
// 데이터: GET /dashboard(?templateId=)의 nodes·edges·queue·today, GET /templates(이름·필터·0개 판단),
// 테넌트 컨텍스트(이름·호스트·출처·연결 상태), 노드 서랍을 열 때 GET /transport/history(최근 이관).
afterEach(() => vi.unstubAllGlobals());

const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'PRD', name: '운영', source: 'env', apiHost: 'prd.example.test', createdAt: null },
    { id: 'DEV', name: '개발', source: 'env', apiHost: 'dev.example.test', createdAt: null },
    { id: 'QAS', name: '품질', source: 'registered', apiHost: 'qas.example.test', createdAt: '2026-11-10T00:00:00Z' },
    { id: 'LAB', name: '실험', source: 'registered', apiHost: 'lab.example.test', createdAt: '2026-11-10T00:00:00Z' },
  ],
};
const STATUS: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) };
const T_DQ = tpl({ id: 'tp-dq', name: '개발에서 품질', sourceTenantId: 'DEV', targetTenantId: 'QAS' });
const T_QP = tpl({ id: 'tp-qp', name: '품질에서 운영', sourceTenantId: 'QAS', targetTenantId: 'PRD' });
const node = (id: string, name: string, origin: 'env' | 'registered') => ({ id, name, origin });
// 응답의 nodes 순서는 일부러 흐름 순서와 다르게 둔다(화면이 템플릿 흐름 순서로 다시 놓는다).
const NODES = [node('PRD', '운영', 'env'), node('DEV', '개발', 'env'), node('QAS', '품질', 'registered'), node('LAB', '실험', 'registered')];
const Q_QAS = { packageId: 'PkgTransportDemo', atTenantId: 'QAS', nextTemplateId: 'tp-qp', nextTargetTenantId: 'PRD',
  arrivedTransportId: 't-arr-1', arrivedAt: '2026-11-16T01:00:00Z', artifactCount: 2 };
const Q_DEV = { packageId: 'PkgFaultDemo', atTenantId: 'DEV', nextTemplateId: 'tp-dq', nextTargetTenantId: 'QAS',
  arrivedTransportId: 't-arr-2', arrivedAt: '2026-11-16T02:00:00Z', artifactCount: 1 };
const DASH = {
  nodes: NODES,
  edges: [
    { sourceTenantId: 'QAS', targetTenantId: 'PRD', templateIds: ['tp-qp'] },
    { sourceTenantId: 'DEV', targetTenantId: 'QAS', templateIds: ['tp-dq'] },
  ],
  queue: [Q_QAS, Q_DEV],
  today: { previews: 4, transports: 3, succeeded: 2, failed: 1 },
};
const DASH_QP = { ...DASH, edges: [DASH.edges[0]], queue: [Q_QAS] };
const preview = (body: TransportRequest): TransportResponse => ({
  transportId: 't-dry', packages: body.packages.map((p) => ({ packageId: p.packageId, packageName: null, targetPackage: 'NOT_CHECKED' as const })), dryRun: true, deploy: false,
  startedAt: '2026-11-16T03:00:00Z', finishedAt: '2026-11-16T03:00:01Z', summary: { total: 0, succeeded: 0, failed: 0 }, results: [],
  sourceTenant: { id: body.sourceTenantId ?? '', name: '품질' }, targetTenant: { id: body.targetTenantId ?? '', name: '운영' },
});
const hist = (i: number, src: string, tgt: string): TransportResponse => ({
  transportId: `t-h${i}`, packages: [{ packageId: `PkgHist${i}`, packageName: null, targetPackage: null }], dryRun: i % 2 === 0, deploy: false,
  startedAt: `2026-11-1${i}T01:00:00Z`, finishedAt: `2026-11-1${i}T01:00:01Z`, summary: { total: 1, succeeded: 1, failed: 0 }, results: [],
  sourceTenant: { id: src, name: src }, targetTenant: { id: tgt, name: tgt },
});

function routes(extra: Parameters<typeof mockApi>[0] = {}) {
  return baseRoutes({
    'GET /tenants': () => json(TENANTS),
    'GET /tenants/status': () => json(STATUS),
    'GET /templates': () => json([T_DQ, T_QP]),
    'GET /dashboard': () => json(DASH),
    'GET /dashboard?templateId=tp-qp': () => json(DASH_QP),
    ...extra,
  });
}
const mapRegion = () => screen.findByRole('region', { name: '이관 경로' });
const flowList = async () => within(await mapRegion()).getByRole('list', { name: '경로의 테넌트' });
const nodeButton = (name: string) => within(screen.getByRole('region', { name: '이관 경로' })).getByRole('button', { name: new RegExp(`^${name}`) });
const queueRegion = () => screen.findByRole('region', { name: '대기 항목' });
const itemNames = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('REQ-430 대시보드', () => {
  it('REQ-430: 머리(h2 대시보드), 오늘 요약(미리보기·실제 이관·성공·실패 수)이 보인다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 2, name: '대시보드' })).toBeInTheDocument();
    const today = await screen.findByRole('region', { name: '오늘 요약' });
    await waitFor(() => expect(today).toHaveTextContent(/미리보기\s*4/));
    expect(today).toHaveTextContent(/실제 이관\s*3/);
    expect(today).toHaveTextContent(/성공\s*2/);
    expect(today).toHaveTextContent(/실패\s*1/);
  });

  it('REQ-430: 노드는 템플릿 흐름 순서(개발 → 품질 → 운영)로 놓이고, 어느 템플릿에도 없는 테넌트(실험)는 끝에 따로 있다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    const flow = await flowList();
    await waitFor(() => expect(within(flow).getAllByRole('listitem')).toHaveLength(3));
    const names = itemNames(flow);
    expect(names[0]).toMatch(/^개발/);
    expect(names[1]).toMatch(/^품질/);
    expect(names[2]).toMatch(/^운영/);
    const loose = within(await mapRegion()).getByRole('list', { name: '경로 없는 테넌트' });
    expect(itemNames(loose)).toHaveLength(1);
    expect(itemNames(loose)[0]).toMatch(/^실험/);
    expect(flow.compareDocumentPosition(loose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('REQ-430: 노드 카드는 이름, 연결 상태, 대기 수(그 노드로 가져올 대기 항목)를 보이고 호스트는 보이지 않는다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    await flowList();
    await waitFor(() => expect(nodeButton('운영')).toHaveTextContent('연결됨'));
    expect(nodeButton('운영')).toHaveTextContent('대기 1건');
    expect(nodeButton('품질')).toHaveTextContent('대기 1건');
    expect(nodeButton('개발')).toHaveTextContent('대기 0건');
    const map = await mapRegion();
    for (const t of TENANTS.tenants) expect(map.textContent).not.toContain(t.apiHost);
  });

  it('REQ-430: 템플릿 경로(화살표)는 "<원본> → <대상>"과 그 경로의 템플릿 이름으로 보인다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    const edges = within(await mapRegion()).getByRole('list', { name: '템플릿 경로' });
    await waitFor(() => expect(within(edges).getAllByRole('listitem')).toHaveLength(2));
    const texts = itemNames(edges);
    expect(texts.some((t) => t.includes('개발 → 품질') && t.includes('개발에서 품질'))).toBe(true);
    expect(texts.some((t) => t.includes('품질 → 운영') && t.includes('품질에서 운영'))).toBe(true);
  });

  it('REQ-430: 대기 항목은 패키지, 경로, 템플릿, 아티팩트 수와 "전달" 버튼으로 보인다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    const queue = within(await queueRegion());
    await waitFor(() => expect(queue.getAllByRole('listitem')).toHaveLength(2));
    const item = queue.getAllByRole('listitem').find((li) => li.textContent?.includes('PkgTransportDemo'))!;
    expect(item).toHaveTextContent('품질 → 운영');
    expect(item).toHaveTextContent('품질에서 운영');
    expect(item).toHaveTextContent('아티팩트 2개');
    expect(within(item).getByRole('button', { name: '전달' })).toBeEnabled();
  });

  it('REQ-430: "전달"은 그 템플릿·패키지로 채운 마법사의 아티팩트 단계를 연다. 자동 실행은 없고, 미리보기는 templateId를 보낸다', async () => {
    const fn = mockApi(routes({
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json(ARTIFACTS),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'POST /transport': (init) => json(preview(JSON.parse(String(init?.body)))),
    }));
    renderAt('#/dashboard');
    const queue = within(await queueRegion());
    await waitFor(() => expect(queue.getAllByRole('listitem')).toHaveLength(2));
    const item = queue.getAllByRole('listitem').find((li) => li.textContent?.includes('PkgTransportDemo'))!;
    await userEvent.click(within(item).getByRole('button', { name: '전달' }));
    await waitFor(() => expect(window.location.hash).toBe('#/transport'));
    await findArtifactGrid();
    expect(currentStep()).toBe('아티팩트');
    expect(routeBar()).toHaveTextContent('품질 → 운영');
    expect(stepButton('템플릿')).toHaveTextContent('품질에서 운영');
    expect(stepButton('패키지')).toHaveTextContent(/PkgTransportDemo|Transport Demo/);
    expect(postBodies(fn)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([{ packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true, deploy: false, sourceTenantId: 'QAS', targetTenantId: 'PRD', templateId: 'tp-qp' }]);
  });

  it('REQ-612: "전달"로 연 새 이관에서 패키지 단계로 가면 그 패키지가 선택돼 있고 패키지를 더 골라 함께 미리보기할 수 있다(템플릿 연결 유지)', async () => {
    const fn = mockApi(routes({
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json(ARTIFACTS),
      'GET /packages/PkgFaultDemo/artifacts?tenantId=QAS': () => json([{ id: 'IF_Fault', name: 'Fault', version: '1.0.0' }]),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'POST /transport': (init) => json(preview(JSON.parse(String(init?.body)))),
    }));
    renderAt('#/dashboard');
    const queue = within(await queueRegion());
    await waitFor(() => expect(queue.getAllByRole('listitem')).toHaveLength(2));
    const item = queue.getAllByRole('listitem').find((li) => li.textContent?.includes('PkgTransportDemo'))!;
    await userEvent.click(within(item).getByRole('button', { name: '전달' }));
    await findArtifactGrid();
    await userEvent.click(stepButton('패키지'));
    expect(await screen.findByRole('checkbox', { name: /Transport Demo/ })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: /Fault Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await findPackageSection('PkgFaultDemo');
    await findPackageSection('PkgTransportDemo');
    expect(stepButton('패키지')).toHaveTextContent('Transport Demo 외 1개');
    expect(postBodies(fn)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([{
      packages: [{ packageId: 'PkgTransportDemo' }, { packageId: 'PkgFaultDemo' }],
      dryRun: true, deploy: false, sourceTenantId: 'QAS', targetTenantId: 'PRD', templateId: 'tp-qp',
    }]);
  });

  it('REQ-430: 템플릿 필터는 모든 템플릿과 각 템플릿을 고를 수 있고, 고르면 그 템플릿의 경로와 대기 항목만 남는다', async () => {
    const fn = mockApi(routes());
    renderAt('#/dashboard');
    const filter = await screen.findByRole('combobox', { name: '템플릿별 보기' });
    await waitFor(() => expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['모든 템플릿', '개발에서 품질', '품질에서 운영']));
    await userEvent.selectOptions(filter, '품질에서 운영');
    expect(fn.mock.calls.some(([url]) => url === '/dashboard?templateId=tp-qp')).toBe(true);
    const edges = within(await mapRegion()).getByRole('list', { name: '템플릿 경로' });
    await waitFor(() => expect(within(edges).getAllByRole('listitem')).toHaveLength(1));
    expect(itemNames(edges)[0]).toContain('품질 → 운영');
    const queue = within(await queueRegion());
    await waitFor(() => expect(queue.getAllByRole('listitem')).toHaveLength(1));
    expect(queue.getByRole('listitem')).toHaveTextContent('PkgTransportDemo');
  });

  it('REQ-430: 노드를 누르면 서랍에 호스트, 출처, 마지막 연결 확인, 이 노드를 쓰는 템플릿, 이 노드의 대기 항목, 최근 이관 5건이 보인다', async () => {
    const history = [1, 2, 3, 4, 5, 6].map((i) => hist(i, 'QAS', 'PRD')).concat([hist(7, 'DEV', 'LAB')]);
    mockApi(routes({ 'GET /transport/history': () => json(history) }));
    renderAt('#/dashboard');
    await flowList();
    await userEvent.click(nodeButton('품질'));
    const drawer = await screen.findByRole('dialog', { name: '품질' });
    expect(drawer).toHaveTextContent('qas.example.test');
    expect(drawer).toHaveTextContent('등록');
    expect(within(drawer).getByText('마지막 연결 확인')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('연결됨');
    const templates = within(drawer).getByRole('list', { name: '이 노드를 쓰는 템플릿' });
    expect(itemNames(templates).sort()).toEqual(['개발에서 품질', '품질에서 운영']);
    const waiting = within(drawer).getByRole('list', { name: '이 노드의 대기 항목' });
    expect(itemNames(waiting)).toHaveLength(1);
    // 이 노드(품질)에 있는 항목(atTenantId=QAS): PkgTransportDemo. 품질로 가져올 PkgFaultDemo(at DEV)는 여기 없다
    expect(itemNames(waiting)[0]).toContain('PkgTransportDemo');
    expect(waiting.textContent).not.toContain('PkgFaultDemo');
    const recent = within(drawer).getByRole('list', { name: '최근 이관' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(5));
    // 최근 것부터 5건(startedAt 내림차순): 6,5,4,3,2. 품질이 쓰이지 않은 7번(개발 → 실험)은 없다
    expect(itemNames(recent)[0]).toContain('PkgHist6');
    expect(recent.textContent).not.toContain('PkgHist1');
    expect(recent.textContent).not.toContain('PkgHist7');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '품질' })).toBeNull());
  });

  it('REQ-430: 출처가 환경 변수인 노드의 서랍은 "환경 변수"를 보인다', async () => {
    mockApi(routes({ 'GET /transport/history': () => json([]) }));
    renderAt('#/dashboard');
    await flowList();
    await userEvent.click(nodeButton('개발'));
    const drawer = await screen.findByRole('dialog', { name: '개발' });
    expect(drawer).toHaveTextContent('dev.example.test');
    expect(drawer).toHaveTextContent('환경 변수');
  });
});

describe('REQ-430 실패와 빈 상태', () => {
  it('REQ-430 실패: 대기 항목이 0개면 빈 상태를 보인다', async () => {
    mockApi(routes({ 'GET /dashboard': () => json({ ...DASH, queue: [] }) }));
    renderAt('#/dashboard');
    expect(await within(await queueRegion()).findByText('대기 항목이 없습니다')).toBeInTheDocument();
  });

  it('REQ-430 실패: 템플릿이 0개면 "템플릿을 만들면 경로와 대기 항목이 보입니다"와 만들기 버튼(템플릿 화면으로)', async () => {
    mockApi(routes({ 'GET /templates': () => json([]), 'GET /dashboard': () => json({ ...DASH, edges: [], queue: [] }) }));
    renderAt('#/dashboard');
    expect(await screen.findByText('템플릿을 만들면 경로와 대기 항목이 보입니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '템플릿 만들기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/templates'));
  });

  it('REQ-430 실패 / REQ-312: 테넌트 목록을 읽었고 0개면 등록 안내와 테넌트 화면 이동 버튼', async () => {
    mockApi(routes({
      'GET /tenants': () => json({ store: 'OK', tenants: [] }),
      'GET /tenants/status': () => json({ readOnly: false, tenants: [] }),
      'GET /templates': () => json([]),
      'GET /dashboard': () => json({ nodes: [], edges: [], queue: [], today: { previews: 0, transports: 0, succeeded: 0, failed: 0 } }),
    }));
    renderAt('#/dashboard');
    expect(await screen.findByText('먼저 테넌트를 등록하세요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '테넌트 화면으로 이동' }));
    await waitFor(() => expect(window.location.hash).toBe('#/tenants'));
  });

  it('테넌트가 0개면 첫 화면은 시작 안내(순서 3단계)만 보이고 빈 요약·경로·대기 항목·템플릿 안내는 그리지 않는다', async () => {
    mockApi(routes({
      'GET /tenants': () => json({ store: 'OK', tenants: [] }),
      'GET /tenants/status': () => json({ readOnly: true, tenants: [] }),
      'GET /templates': () => json([]),
      'GET /dashboard': () => json({ nodes: [], edges: [], queue: [], today: { previews: 0, transports: 0, succeeded: 0, failed: 0 } }),
    }));
    renderAt('#/dashboard');
    const start = await screen.findByRole('region', { name: '시작하기' });
    const steps = within(within(start).getByRole('list')).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringContaining('테넌트 등록'), expect.stringContaining('미리보기'), expect.stringContaining('실제 이관'),
    ]);
    expect(within(start).getByText('먼저 테넌트를 등록하세요')).toBeInTheDocument();
    expect(within(start).getByRole('button', { name: '테넌트 화면으로 이동' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: '오늘 요약' })).toBeNull());
    expect(screen.queryByRole('region', { name: '이관 경로' })).toBeNull();
    expect(screen.queryByRole('region', { name: '대기 항목' })).toBeNull();
    expect(screen.queryByText('템플릿을 만들면 경로와 대기 항목이 보입니다')).toBeNull();
  });

  it('테넌트가 0개이고 저장소 키가 없으면 시작 안내에 등록할 수 없는 이유를 보인다', async () => {
    mockApi(routes({
      'GET /tenants': () => json({ store: 'NOT_CONFIGURED', tenants: [] }),
      'GET /tenants/status': () => json({ readOnly: true, tenants: [] }),
    }));
    renderAt('#/dashboard');
    const start = await screen.findByRole('region', { name: '시작하기' });
    expect(within(start).getByText('테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다')).toBeInTheDocument();
    expect(within(start).queryByText('먼저 테넌트를 등록하세요')).toBeNull();
  });

  it('테넌트 목록을 읽지 못하면 대시보드에 그 오류와 "다시 시도"를 보이고, 다시 시도하면 목록을 다시 읽는다', async () => {
    let fail = true;
    const fn = mockApi(routes({ 'GET /tenants': () => (fail ? json({ error: 'TENANT_STORE_UNREADABLE', message: 'x' }, 409) : json({ store: 'OK', tenants: [] })) }));
    renderAt('#/dashboard');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('테넌트 저장 파일을 읽지 못했습니다');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('region', { name: '시작하기' })).toBeInTheDocument();
    expect(fn.mock.calls.filter(([url]) => url === '/tenants').length).toBeGreaterThanOrEqual(2);
  });

  it('테넌트가 있으면 시작 안내를 그리지 않는다', async () => {
    mockApi(routes());
    renderAt('#/dashboard');
    await screen.findByRole('region', { name: '오늘 요약' });
    expect(screen.queryByRole('region', { name: '시작하기' })).toBeNull();
  });

  it('REQ-430 실패 / REQ-312: 테넌트 목록을 읽는 중이거나 읽기에 실패하면 등록 안내를 쓰지 않는다', async () => {
    let release!: (r: Response) => void;
    mockApi(routes({ 'GET /tenants': () => new Promise<Response>((r) => { release = r; }) }));
    renderAt('#/dashboard');
    await screen.findByRole('region', { name: '오늘 요약' });
    expect(screen.queryByText('먼저 테넌트를 등록하세요')).toBeNull();
    release(json({}, 500));
    await waitFor(() => expect(screen.queryByText('먼저 테넌트를 등록하세요')).toBeNull());
  });

  it('REQ-430 실패: 대시보드 조회가 실패하면 오류와 "다시 시도"를 보이고, 다시 시도하면 다시 요청한다. 내비게이션은 동작한다', async () => {
    let fail = true;
    const fn = mockApi(routes({ 'GET /dashboard': () => (fail ? json({ error: 'INTERNAL', message: 'boom' }, 500) : json(DASH)) }));
    renderAt('#/dashboard');
    const alert = await screen.findByRole('alert');
    fail = false;
    expect(alert).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await flowList();
    expect(fn.mock.calls.filter(([url]) => url === '/dashboard').length).toBeGreaterThanOrEqual(2);
    await userEvent.click(navLink('템플릿'));
    expect(await within(screen.getByRole('main')).findByRole('heading', { level: 2, name: '템플릿' })).toBeInTheDocument();
  });

  it('REQ-430 실패: 연결 확인에 실패한 노드는 "확인 실패" 글자와 아이콘을 보인다. 그 노드로 가는 전달은 되지만 실제 이관은 막힌다', async () => {
    mockApi(routes({
      'GET /tenants/status': () => json({}, 500),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json(ARTIFACTS),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'POST /transport': (init) => json(preview(JSON.parse(String(init?.body)))),
    }));
    renderAt('#/dashboard');
    await flowList();
    await waitFor(() => expect(nodeButton('운영')).toHaveTextContent('확인 실패'));
    expect(nodeButton('운영').querySelector('svg, [data-badge-dot]')).not.toBeNull();
    const queue = within(await queueRegion());
    const item = queue.getAllByRole('listitem').find((li) => li.textContent?.includes('PkgTransportDemo'))!;
    const forward = within(item).getByRole('button', { name: '전달' });
    expect(forward).toBeEnabled();
    await userEvent.click(forward);
    await findArtifactGrid();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeDisabled();
    expect(stepButton('실제 이관')).toBeEnabled();
    await userEvent.click(stepButton('실제 이관'));
    expect(screen.getByRole('button', { name: '실제 이관 실행' })).toBeDisabled();
  });

  it('REQ-430 실패(노드별, 사람 결정 2026-11-16): 한 노드의 연결 확인이 OK가 아니면 그 노드에 "확인 실패" 글자와 아이콘. 그 노드로 가는 전달은 되지만 실제 이관은 막힌다', async () => {
    const status: TenantStatusResponse = { readOnly: false, tenants: STATUS.tenants.map((t) => (t.id === 'PRD' ? { ...t, check: 'TOKEN_FAILED' as const } : t)) };
    mockApi(routes({
      'GET /tenants/status': () => json(status),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json(ARTIFACTS),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'POST /transport': (init) => json(preview(JSON.parse(String(init?.body)))),
    }));
    renderAt('#/dashboard');
    await flowList();
    await waitFor(() => expect(nodeButton('운영')).toHaveTextContent('확인 실패'));
    expect(nodeButton('운영').querySelector('svg, [data-badge-dot]')).not.toBeNull();
    expect(nodeButton('품질')).toHaveTextContent('연결됨');
    const queue = within(await queueRegion());
    const item = queue.getAllByRole('listitem').find((li) => li.textContent?.includes('PkgTransportDemo'))!;
    const forward = within(item).getByRole('button', { name: '전달' });
    expect(forward).toBeEnabled();
    await userEvent.click(forward);
    await findArtifactGrid();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const region = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeDisabled();
    await userEvent.click(stepButton('실제 이관'));
    expect(screen.getByRole('button', { name: '실제 이관 실행' })).toBeDisabled();
  });
});
