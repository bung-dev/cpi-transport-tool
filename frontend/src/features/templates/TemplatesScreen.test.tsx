import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantsResponse } from '../../api/types';
import { json, mockApi, PACKAGES } from '../../test/mockFetch';
import { TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { baseRoutes, renderAt, routeGroup, tpl, type TemplateFixture } from '../../test/appRoutes';

// REQ-413 템플릿 화면, 20261118 S2 REQ-610 템플릿은 경로만(패키지 입력·표시 없음)
afterEach(() => vi.unstubAllGlobals());

const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'DEV', name: 'DEV', source: 'env', apiHost: 'localhost', createdAt: null },
    { id: 'PRD', name: 'PRD', source: 'env', apiHost: 'localhost', createdAt: null },
    { id: 'QAS', name: 'QAS', source: 'registered', apiHost: 'localhost', createdAt: null },
  ],
};
const STATUS = { ...TENANT_STATUS_OK, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) };
const BASE = [
  tpl({ id: 'tp-1', name: '개발에서 운영', sourceTenantId: 'DEV', targetTenantId: 'PRD' }),
  tpl({ id: 'tp-2', name: '품질 경로', sourceTenantId: 'QAS', targetTenantId: 'PRD' }),
  tpl({ id: 'tp-3', name: '삭제된 원본', sourceTenantId: 'OLD', targetTenantId: 'PRD', usable: false, unusableReason: 'SOURCE_TENANT_MISSING' }),
  tpl({ id: 'tp-4', name: '삭제된 대상', sourceTenantId: 'DEV', targetTenantId: 'GONE', usable: false, unusableReason: 'TARGET_TENANT_MISSING' }),
];

function setup(opts: { templates?: TemplateFixture[]; tenants?: TenantsResponse; extra?: Parameters<typeof mockApi>[0] } = {}) {
  let list = [...(opts.templates ?? BASE)];
  const bodies: Array<{ method: string; url: string; body: any }> = [];
  const record = (method: string, url: string) => (init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    bodies.push({ method, url, body });
    if (method === 'POST') {
      const created = tpl({ id: 'tp-new', ...body });
      list = [...list, created];
      return json(created, 201);
    }
    if (method === 'PUT') {
      list = list.map((t) => (`/templates/${t.id}` === url ? { ...t, ...body } : t));
      return json(list.find((t) => `/templates/${t.id}` === url));
    }
    list = list.filter((t) => `/templates/${t.id}` !== url);
    return new Response(null, { status: 204 });
  };
  const fn = mockApi(
    baseRoutes({
      'GET /tenants': () => json(opts.tenants ?? TENANTS),
      'GET /tenants/status': () => json(STATUS),
      'GET /templates': () => json(list),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'GET /packages?tenantId=PRD': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json([]),
      'POST /templates': record('POST', '/templates'),
      'PUT /templates/tp-1': record('PUT', '/templates/tp-1'),
      'PUT /templates/tp-3': record('PUT', '/templates/tp-3'),
      'DELETE /templates/tp-1': record('DELETE', '/templates/tp-1'),
      ...opts.extra,
    }),
  );
  renderAt('#/templates');
  return { fn, bodies };
}
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });
const findRow = (name: string) => screen.findByRole('row', { name: new RegExp(name) });
const drawer = (name: '템플릿 만들기' | '템플릿 수정') => screen.getByRole('dialog', { name });

describe('REQ-413 목록', () => {
  it('REQ-413·REQ-610: 목록은 이름·경로·사용 가능 여부이고 패키지 열·문구가 없다', async () => {
    setup();
    const first = await findRow('개발에서 운영');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['이름', '경로', '상태', '작업']);
    expect(first).toHaveTextContent('DEV → PRD');
    expect(first).toHaveTextContent('사용 가능');
    expect(row('품질 경로')).toHaveTextContent('QAS → PRD');
    expect(screen.queryByText('실행 때 선택')).toBeNull();
    expect(screen.getByRole('button', { name: '템플릿 만들기' })).toBeEnabled();
  });

  it('REQ-413 실패: 사용 불가 템플릿은 이유를 보이고 "이 템플릿으로 이관"은 비활성, 수정은 할 수 있다', async () => {
    setup();
    const src = await findRow('삭제된 원본');
    expect(src).toHaveTextContent('원본 테넌트가 삭제됨');
    expect(within(src).getByRole('button', { name: '이 템플릿으로 이관' })).toBeDisabled();
    expect(within(src).getByRole('button', { name: '수정' })).toBeEnabled();
    expect(row('삭제된 대상')).toHaveTextContent('대상 테넌트가 삭제됨');
    expect(within(row('삭제된 대상')).getByRole('button', { name: '이 템플릿으로 이관' })).toBeDisabled();
    expect(within(row('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 이관' })).toBeEnabled();
  });

  it('REQ-413 실패: 테넌트가 0개면 만들 수 없다는 안내와 테넌트 화면으로 가는 버튼을 보인다', async () => {
    setup({ templates: [], tenants: { store: 'OK', tenants: [] } });
    expect(await screen.findByText('테넌트를 먼저 등록해야 템플릿을 만들 수 있습니다')).toBeInTheDocument();
    const make = screen.queryByRole('button', { name: '템플릿 만들기' });
    if (make) expect(make).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '테넌트 화면으로 이동' }));
    expect(window.location.hash).toBe('#/tenants');
  });

  it('REQ-413 실패: 템플릿 목록 조회 실패는 오류와 "다시 시도"이다', async () => {
    let fail = true;
    setup({ extra: { 'GET /templates': () => (fail ? json({ error: 'TEMPLATE_STORE_UNREADABLE', message: 'broken' }, 500) : json(BASE)) } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('템플릿 저장 파일을 읽지 못했습니다');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await findRow('개발에서 운영')).toBeInTheDocument();
  });
});

describe('REQ-413 만들기·수정·삭제', () => {
  it('REQ-413·REQ-610: 만들기 서랍은 이름·원본·대상만 받고 저장하면 경로만 POST 하고 목록에 반영된다(패키지 조회 없음)', async () => {
    const { fn, bodies } = setup();
    await findRow('개발에서 운영');
    await userEvent.click(screen.getByRole('button', { name: '템플릿 만들기' }));
    const d = drawer('템플릿 만들기');
    expect(d).toHaveAttribute('aria-modal', 'true');
    await userEvent.type(within(d).getByLabelText('이름'), '새 경로');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '원본' }), 'QAS');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '대상' }), 'DEV');
    expect(within(d).getAllByRole('combobox')).toHaveLength(2);
    expect(within(d).queryByRole('combobox', { name: '패키지' })).toBeNull();
    expect(within(d).queryByText(/패키지/)).toBeNull();
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '템플릿 만들기' })).toBeNull());
    expect(bodies).toEqual([{ method: 'POST', url: '/templates', body: { name: '새 경로', sourceTenantId: 'QAS', targetTenantId: 'DEV' } }]);
    expect(await findRow('새 경로')).toHaveTextContent('QAS → DEV');
    expect(fn.mock.calls.some(([url]) => String(url).startsWith('/packages'))).toBe(false);
  });

  it('REQ-413 실패: 원본과 대상이 같으면 서랍 안에 경고를 보이고 저장할 수 없다', async () => {
    const { bodies } = setup();
    await findRow('개발에서 운영');
    await userEvent.click(screen.getByRole('button', { name: '템플릿 만들기' }));
    const d = drawer('템플릿 만들기');
    await userEvent.type(within(d).getByLabelText('이름'), '같은 경로');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '원본' }), 'DEV');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '대상' }), 'DEV');
    expect(within(d).getByText('원본과 대상이 같습니다')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: '저장' })).toBeDisabled();
    expect(bodies).toHaveLength(0);
  });

  it('REQ-413 실패: 이름 중복은 서버 오류를 서랍 안에 보이고 입력을 유지한다', async () => {
    setup({ extra: { 'POST /templates': () => json({ error: 'TEMPLATE_NAME_DUPLICATE', message: 'dup' }, 409) } });
    await findRow('개발에서 운영');
    await userEvent.click(screen.getByRole('button', { name: '템플릿 만들기' }));
    const d = drawer('템플릿 만들기');
    await userEvent.type(within(d).getByLabelText('이름'), '개발에서 운영');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '원본' }), 'DEV');
    await userEvent.selectOptions(within(d).getByRole('combobox', { name: '대상' }), 'PRD');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('같은 이름의 템플릿이 이미 있습니다');
    expect(within(d).getByLabelText('이름')).toHaveValue('개발에서 운영');
    expect(within(d).getByRole('combobox', { name: '원본' })).toHaveValue('DEV');
  });

  it('REQ-413: 수정 서랍은 현재 값으로 열리고 저장하면 PUT 하고 목록에 반영된다', async () => {
    const { bodies } = setup();
    await userEvent.click(within(await findRow('개발에서 운영')).getByRole('button', { name: '수정' }));
    const d = drawer('템플릿 수정');
    expect(within(d).getByLabelText('이름')).toHaveValue('개발에서 운영');
    expect(within(d).getByRole('combobox', { name: '원본' })).toHaveValue('DEV');
    expect(within(d).getByRole('combobox', { name: '대상' })).toHaveValue('PRD');
    expect(within(d).queryByRole('combobox', { name: '패키지' })).toBeNull();
    await userEvent.clear(within(d).getByLabelText('이름'));
    await userEvent.type(within(d).getByLabelText('이름'), '이름 바꿈');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '템플릿 수정' })).toBeNull());
    expect(bodies[0]).toEqual({ method: 'PUT', url: '/templates/tp-1', body: { name: '이름 바꿈', sourceTenantId: 'DEV', targetTenantId: 'PRD' } });
    expect(await findRow('이름 바꿈')).toBeInTheDocument();
  });

  it('REQ-413: 삭제는 확인창을 거치고 확인하면 DELETE 후 목록에서 사라진다', async () => {
    const { bodies } = setup();
    await userEvent.click(within(await findRow('개발에서 운영')).getByRole('button', { name: '삭제' }));
    const dialog = screen.getByRole('dialog', { name: '템플릿 삭제 확인' });
    expect(dialog).toHaveTextContent('개발에서 운영');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(bodies).toHaveLength(0);
    await userEvent.click(within(row('개발에서 운영')).getByRole('button', { name: '삭제' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '템플릿 삭제 확인' })).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /개발에서 운영/ })).toBeNull());
    expect(bodies).toEqual([{ method: 'DELETE', url: '/templates/tp-1', body: undefined }]);
  });

  it('REQ-413·REQ-610: "이 템플릿으로 이관"은 템플릿의 경로만 채운 새 이관 화면을 열고 패키지는 비어 있다', async () => {
    setup({ extra: { 'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json([]) } });
    await userEvent.click(within(await findRow('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 이관' }));
    expect(window.location.hash).toBe('#/transport');
    expect(within(routeGroup()).getByRole('button', { name: /^원본 DEV/ })).toBeInTheDocument();
    expect(within(routeGroup()).getByRole('button', { name: /^대상 PRD/ })).toBeInTheDocument();
    const radios = await screen.findAllByRole('radio', { name: /Demo/ });
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });
});
