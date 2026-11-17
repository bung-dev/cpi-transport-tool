import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { REGISTERED, baseRoutes, renderAt, tpl, type TemplateFixture } from '../../test/appRoutes';
import type { TenantCheck, TenantStore } from '../../api/types';

// REQ-412 테넌트 화면(목록 + 오른쪽 서랍). 이전 REQ-301·302·305·318의 단언을 새 구조로 옮겼다.
const KEY = { oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid: 'test-dummy-client', clientsecret: 'test-dummy-value' } };
afterEach(() => vi.unstubAllGlobals());

interface LiveOpts {
  store?: TenantStore;
  withRegistered?: boolean;
  templates?: TemplateFixture[];
  check?: TenantCheck;
  extra?: Parameters<typeof mockApi>[0];
}
function live({ store = 'OK', withRegistered = false, templates = [], check = 'OK', extra = {} }: LiveOpts = {}) {
  let added = withRegistered;
  const bodies: unknown[] = [];
  const fn = mockApi(
    baseRoutes({
      'GET /tenants': () => json({ store, tenants: added ? [...TENANTS_OK.tenants, REGISTERED] : TENANTS_OK.tenants }),
      'GET /tenants/status': () =>
        json({ ...TENANT_STATUS_OK, tenants: [...TENANT_STATUS_OK.tenants.map((t) => ({ ...t, check })), { ...REGISTERED, check }] }),
      'GET /templates': () => json(templates),
      'POST /tenants': (init) => {
        bodies.push(JSON.parse(init?.body as string));
        added = true;
        return json(REGISTERED, 201);
      },
      ...extra,
    }),
  );
  renderAt('#/tenants');
  return { fn, bodies };
}
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });
const drawer = (name: '테넌트 등록' | '테넌트 수정') => screen.getByRole('dialog', { name });
async function openRegister() {
  await screen.findByRole('row', { name: /DEV/ });
  await userEvent.click(screen.getByRole('button', { name: '테넌트 등록' }));
  return drawer('테넌트 등록');
}
async function fill(d: HTMLElement, name = '새 테넌트', key: unknown = KEY) {
  await userEvent.type(within(d).getByLabelText('이름'), name);
  await userEvent.click(within(d).getByLabelText('서비스 키 붙여넣기'));
  await userEvent.paste(typeof key === 'string' ? key : JSON.stringify(key));
}
const posts = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('REQ-412 목록', () => {
  it('REQ-412: 목록 열은 이름·출처·연결 상태·작업이고 env 테넌트에는 수정·삭제가 없다', async () => {
    live({ withRegistered: true });
    const env = await screen.findByRole('row', { name: /DEV/ });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['이름', '출처', '연결 상태', '작업']);
    expect(within(env).getByText('환경 변수')).toBeInTheDocument();
    expect(within(env).queryByRole('button')).toBeNull();
    const reg = await screen.findByRole('row', { name: /새 테넌트/ });
    expect(within(reg).getByText('등록')).toBeInTheDocument();
    expect(within(reg).getByRole('button', { name: '수정' })).toBeInTheDocument();
    expect(within(reg).getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it.each([
    ['OK', '연결됨', 'success'],
    ['TOKEN_FAILED', '인증 실패', 'danger'],
    ['API_FORBIDDEN', '권한 없음', 'danger'],
    ['UNREACHABLE', '연결 안 됨', 'danger'],
    ['ERROR', '오류', 'danger'],
  ] as const)('REQ-412: 연결 상태 %s는 글자 %s와 %s 톤이다', async (check, label, tone) => {
    live({ check });
    const env = await screen.findByRole('row', { name: /DEV/ });
    const badge = await within(env).findByText(label);
    expect(badge.className).toContain(`bg-${tone}-bg`);
  });

  it('REQ-412 실패: 상태 조회 실패는 "확인 실패" danger 글자다', async () => {
    live({ extra: { 'GET /tenants/status': () => json({}, 500) } });
    const env = await screen.findByRole('row', { name: /DEV/ });
    expect((await within(env).findByText('확인 실패')).className).toContain('bg-danger-bg');
  });

  it('REQ-412 실패: 목록 조회 실패는 오류와 "다시 시도"이고 다시 시도하면 재조회한다', async () => {
    let fail = true;
    const fn = live({ extra: { 'GET /tenants': () => (fail ? json({}, 500) : json(TENANTS_OK)) } }).fn;
    const retry = await within(screen.getByRole('main')).findByRole('button', { name: '다시 시도' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('row', { name: /DEV/ })).toBeInTheDocument();
    expect(fn.mock.calls.filter(([url]) => url === '/tenants')).toHaveLength(2);
  });

  it.each([
    ['NOT_CONFIGURED', '테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다'],
    ['UNREADABLE', '테넌트 저장 파일을 읽지 못했습니다. 저장소 키를 확인하세요'],
  ] as const)('REQ-412: 저장소 %s면 안내를 보이고 등록 버튼이 비활성이다', async (store, text) => {
    live({ store });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '테넌트 등록' })).toBeDisabled();
  });
});

describe('REQ-412 등록 서랍', () => {
  it('REQ-412: 서랍에는 이름, 보이는 "파일 선택" 버튼, 끌어놓기 영역, 붙여넣기가 있고 Esc로 닫힌다', async () => {
    live();
    const d = await openRegister();
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(within(d).getByLabelText('이름')).toHaveFocus();
    expect(within(d).getByRole('button', { name: '파일 선택' })).toBeVisible();
    expect(within(d).getByText(/끌어놓으세요/)).toBeInTheDocument();
    expect(within(d).getByLabelText('서비스 키 파일')).toHaveAttribute('type', 'file');
    expect(within(d).getByLabelText('서비스 키 붙여넣기')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '테넌트 등록' })).toBeNull();
    expect(screen.getByRole('button', { name: '테넌트 등록' })).toHaveFocus();
  });

  it('REQ-412: "파일 선택" 버튼은 숨은 파일 입력을 연다', async () => {
    live();
    const d = await openRegister();
    const file = within(d).getByLabelText('서비스 키 파일') as HTMLInputElement;
    const click = vi.spyOn(file, 'click');
    await userEvent.click(within(d).getByRole('button', { name: '파일 선택' }));
    expect(click).toHaveBeenCalled();
  });

  it('REQ-412: 붙여넣기로 등록하면 서랍이 닫히고 목록에 바로 보이며 키 내용은 화면에 남지 않는다(REQ-301·302·305)', async () => {
    const { fn, bodies } = live();
    const d = await openRegister();
    await fill(d);
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    expect(await screen.findByRole('row', { name: /새 테넌트/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '테넌트 등록' })).toBeNull();
    expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: KEY }]);
    expect(document.body.textContent).not.toContain('test-dummy-value');
    expect(screen.queryByDisplayValue(/test-dummy/)).toBeNull();
    expect(fn.mock.calls.filter(([url, init]) => url === '/tenants' && !init?.method)).toHaveLength(2);
    expect(fn.mock.calls.filter(([url]) => url === '/tenants/status')).toHaveLength(2);
    const again = await openRegister();
    expect(within(again).getByLabelText('이름')).toHaveValue('');
    expect(within(again).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
  });

  it('REQ-412: 파일 선택으로 등록하면 파일 이름이 보이고 파일 내용이 붙여넣기보다 우선한다', async () => {
    const { bodies } = live();
    const d = await openRegister();
    await fill(d);
    const fileKey = { oauth: { clientsecret: 'test-dummy-file' } };
    const file = new File([JSON.stringify(fileKey)], 'dummy-key.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(fileKey) });
    await userEvent.upload(within(d).getByLabelText('서비스 키 파일'), file);
    expect(within(d).getByText('dummy-key.json')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    await screen.findByRole('row', { name: /새 테넌트/ });
    expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: fileKey }]);
  });

  it('REQ-412: 끌어놓은 파일은 이름이 보이고 등록에 쓰인다', async () => {
    const { bodies } = live();
    const d = await openRegister();
    await userEvent.type(within(d).getByLabelText('이름'), '새 테넌트');
    const fileKey = { oauth: { clientsecret: 'test-dummy-drop' } };
    const file = new File([JSON.stringify(fileKey)], 'dropped-key.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(fileKey) });
    const zone = within(d).getByText(/끌어놓으세요/);
    fireEvent.dragOver(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(await within(d).findByText('dropped-key.json')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    await screen.findByRole('row', { name: /새 테넌트/ });
    expect(bodies).toEqual([{ name: '새 테넌트', serviceKey: fileKey }]);
  });

  it.each(['{bad', '[]', 'null', '42'])('REQ-412 실패: 서비스 키 %s는 JSON 형식 오류이고 요청하지 않으며 키는 비우고 이름은 유지한다', async (text) => {
    const { fn } = live();
    const d = await openRegister();
    await fill(d, '새 이름', text);
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('서비스 키 JSON 형식이 아닙니다');
    expect(posts(fn)).toHaveLength(0);
    expect(within(d).getByLabelText('이름')).toHaveValue('새 이름');
    expect(within(d).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
  });

  it('REQ-412 실패: 끌어놓은 파일이 JSON이 아니면 형식 오류이고 파일 이름도 비운다', async () => {
    live();
    const d = await openRegister();
    await userEvent.type(within(d).getByLabelText('이름'), '새 이름');
    const file = new File(['not json'], 'broken.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => 'not json' });
    fireEvent.drop(within(d).getByText(/끌어놓으세요/), { dataTransfer: { files: [file], types: ['Files'] } });
    await within(d).findByText('broken.json');
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('서비스 키 JSON 형식이 아닙니다');
    expect(within(d).queryByText('broken.json')).toBeNull();
    expect(within(d).getByLabelText('이름')).toHaveValue('새 이름');
  });

  it.each([
    ['INVALID_SERVICE_KEY', '서비스 키가 올바르지 않습니다'],
    ['TENANT_NAME_DUPLICATE', '같은 이름의 테넌트가 이미 있습니다'],
    ['TENANT_STORE_NOT_CONFIGURED', '테넌트 저장소가 설정되지 않았습니다'],
    ['TENANT_STORE_UNREADABLE', '테넌트 저장 파일을 읽지 못했습니다'],
  ])('REQ-412 실패: 서버 오류 %s는 서랍 안에 제목과 message를 보이고 키는 비우고 이름은 유지한다', async (error, title) => {
    live({ extra: { 'POST /tenants': () => json({ error, message: 'fixed server message' }, 409) } });
    const d = await openRegister();
    await fill(d);
    await userEvent.click(within(d).getByRole('button', { name: '등록' }));
    const alert = await within(d).findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent('fixed server message');
    expect(within(d).getByLabelText('이름')).toHaveValue('새 테넌트');
    expect(within(d).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
    expect(screen.queryByRole('row', { name: /새 테넌트/ })).toBeNull();
  });
});

describe('REQ-412 수정 서랍', () => {
  it.each(['name', 'serviceKey'])('REQ-412: 수정 서랍은 현재 이름과 빈 키 입력으로 열리고 바꾼 %s 필드만 PUT 한다', async (field) => {
    let body: unknown;
    live({ withRegistered: true, extra: { 'PUT /tenants/t-new': (init) => { body = JSON.parse(init?.body as string); return json(REGISTERED); } } });
    await userEvent.click(within(await screen.findByRole('row', { name: /새 테넌트/ })).getByRole('button', { name: '수정' }));
    const d = drawer('테넌트 수정');
    expect(within(d).getByLabelText('이름')).toHaveValue(REGISTERED.name);
    expect(within(d).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
    expect(within(d).getByLabelText('서비스 키 파일')).toHaveValue('');
    if (field === 'name') {
      await userEvent.clear(within(d).getByLabelText('이름'));
      await userEvent.type(within(d).getByLabelText('이름'), '바꾼 이름');
    } else {
      await userEvent.click(within(d).getByLabelText('서비스 키 붙여넣기'));
      await userEvent.paste(JSON.stringify(KEY));
    }
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(body).toEqual(field === 'name' ? { name: '바꾼 이름' } : { serviceKey: KEY }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '테넌트 수정' })).toBeNull());
    expect(document.body.textContent).not.toContain(KEY.oauth.clientsecret);
  });

  it('REQ-412: 수정 취소는 요청 없이 닫히고 다시 열면 현재 이름과 빈 키 입력이다', async () => {
    const { fn } = live({ withRegistered: true });
    const opener = within(await screen.findByRole('row', { name: /새 테넌트/ })).getByRole('button', { name: '수정' });
    await userEvent.click(opener);
    let d = drawer('테넌트 수정');
    await userEvent.clear(within(d).getByLabelText('이름'));
    await userEvent.type(within(d).getByLabelText('이름'), '취소할 이름');
    await userEvent.click(within(d).getByLabelText('서비스 키 붙여넣기'));
    await userEvent.paste(JSON.stringify(KEY));
    await userEvent.click(within(d).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '테넌트 수정' })).toBeNull();
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    d = drawer('테넌트 수정');
    expect(within(d).getByLabelText('이름')).toHaveValue(REGISTERED.name);
    expect(within(d).getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
    expect(fn.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  });
});

describe('REQ-412 삭제', () => {
  const USING = [
    tpl({ id: 'tp-1', name: '등록에서 PRD', sourceTenantId: 't-new', targetTenantId: 'PRD' }),
    tpl({ id: 'tp-2', name: 'DEV에서 등록', sourceTenantId: 'DEV', targetTenantId: 't-new' }),
    tpl({ id: 'tp-3', name: '무관한 템플릿', sourceTenantId: 'DEV', targetTenantId: 'PRD' }),
  ];
  async function openDelete(templates: TemplateFixture[], extra: Parameters<typeof mockApi>[0] = {}) {
    const deletes: string[] = [];
    let removed = false;
    const { fn } = live({
      withRegistered: true,
      templates,
      extra: {
        'GET /tenants': () => json({ store: 'OK', tenants: removed ? TENANTS_OK.tenants : [...TENANTS_OK.tenants, REGISTERED] }),
        'DELETE /tenants/t-new': () => { deletes.push('/tenants/t-new'); removed = true; return new Response(null, { status: 204 }); },
        'DELETE /tenants/t-new?deleteTemplates=true': () => { deletes.push('/tenants/t-new?deleteTemplates=true'); removed = true; return new Response(null, { status: 204 }); },
        ...extra,
      },
    });
    const opener = within(await screen.findByRole('row', { name: /새 테넌트/ })).getByRole('button', { name: '삭제' });
    await userEvent.click(opener);
    return { fn, deletes, opener, dialog: await screen.findByRole('dialog', { name: '테넌트 삭제 확인' }) };
  }

  it('REQ-412: 확인창에 그 테넌트를 쓰는 템플릿 이름과 기본 해제된 "템플릿 2개도 함께 삭제"가 있고, 그대로 삭제하면 deleteTemplates 없이 보낸다', async () => {
    const { dialog, deletes } = await openDelete(USING);
    expect(await within(dialog).findByText('등록에서 PRD')).toBeInTheDocument();
    expect(within(dialog).getByText('DEV에서 등록')).toBeInTheDocument();
    expect(within(dialog).queryByText('무관한 템플릿')).toBeNull();
    const box = within(dialog).getByRole('checkbox', { name: '템플릿 2개도 함께 삭제' });
    expect(box).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '테넌트 삭제 확인' })).toBeNull());
    expect(deletes).toEqual(['/tenants/t-new']);
    await waitFor(() => expect(screen.queryByRole('row', { name: /새 테넌트/ })).toBeNull());
  });

  it('REQ-412 (리뷰 결함): 템플릿 목록을 읽지 못해도 오류를 보이고 기본 삭제(deleteTemplates 없이)는 할 수 있다. 함께 삭제 선택은 없다', async () => {
    const { dialog, deletes } = await openDelete(USING, { 'GET /templates': () => json({ error: 'TEMPLATE_STORE_UNREADABLE', message: 'x' }, 500) });
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    const confirm = within(dialog).getByRole('button', { name: '삭제' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await waitFor(() => expect(deletes).toEqual(['/tenants/t-new']));
  });

  it('REQ-412: 체크하고 삭제하면 deleteTemplates=true로 보낸다', async () => {
    const { dialog, deletes } = await openDelete(USING);
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: '템플릿 2개도 함께 삭제' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(deletes).toEqual(['/tenants/t-new?deleteTemplates=true']));
  });

  it('REQ-412: 쓰는 템플릿이 없으면 체크박스를 보이지 않는다', async () => {
    const { dialog } = await openDelete([USING[2]]);
    await within(dialog).findByText(/새 테넌트/);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('REQ-412: 확인창은 포털 모달이고 취소에 포커스, Tab 순환, Esc·취소는 요청 없이 연 버튼으로 포커스를 돌린다', async () => {
    const { dialog, opener, fn } = await openDelete([]);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(dialog).getByRole('button', { name: '삭제' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '테넌트 삭제 확인' })).toBeNull();
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    await userEvent.click(within(screen.getByRole('dialog', { name: '테넌트 삭제 확인' })).getByRole('button', { name: '취소' }));
    expect(opener).toHaveFocus();
    expect(fn.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });

  it('REQ-412 실패: 삭제 실패는 확인창 안에 오류를 보이고 목록은 바뀌지 않는다', async () => {
    const { dialog } = await openDelete([], {
      'DELETE /tenants/t-new': () => json({ error: 'TENANT_NOT_FOUND', message: 'gone' }, 404),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('테넌트를 찾을 수 없습니다');
    expect(row('새 테넌트')).toBeInTheDocument();
  });
});
