import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tenant, TenantsResponse, TenantStatusResponse } from '../../api/types';
import { json, mockApi, PACKAGES } from '../../test/mockFetch';
import { baseRoutes, navLink, renderAt, routeGroup, tpl } from '../../test/appRoutes';

// REQ-411 ⌘K 팔레트
afterEach(() => vi.unstubAllGlobals());

const QAS: Tenant = { id: 'QAS', name: 'QAS', source: 'registered', apiHost: 'localhost', createdAt: null };
const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'DEV', name: 'DEV', source: 'env', apiHost: 'localhost', createdAt: null },
    { id: 'PRD', name: 'PRD', source: 'env', apiHost: 'localhost', createdAt: null },
    QAS,
  ],
};
const STATUS: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) };
const TEMPLATES = [tpl({ id: 'tp-1', name: 'Qas to Prd', sourceTenantId: 'QAS', targetTenantId: 'PRD', packageId: 'PkgTransportDemo' })];

function setup(hash = '', extra: Parameters<typeof mockApi>[0] = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /tenants': () => json(TENANTS),
      'GET /tenants/status': () => json(STATUS),
      'GET /templates': () => json(TEMPLATES),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json([]),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json([]),
      'GET /transport/history': () => json([]),
      'GET /audit?category=all': () => json([]),
      ...extra,
    }),
  );
  renderAt(hash);
  return fn;
}
const ready = () => within(routeGroup()).findByRole('button', { name: '원본 DEV 연결됨' });
const palette = () => screen.getByRole('dialog', { name: '검색 및 명령' });
const input = () => within(palette()).getByRole('combobox', { name: '명령 검색' });
const list = () => within(palette()).getByRole('listbox', { name: '명령 검색 결과' });
const group = (name: string) => within(list()).getByRole('group', { name });
const option = (name: RegExp) => within(list()).getByRole('option', { name });
const activeOption = () => {
  const id = input().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};
async function openWithKeys(keys = '{Control>}k{/Control}') {
  await userEvent.keyboard(keys);
  return palette();
}

describe('REQ-411 열기와 닫기', () => {
  it('REQ-411: Ctrl+K로 열리고 검색 입력에 포커스가 간다', async () => {
    setup();
    await ready();
    await openWithKeys();
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute('aria-controls', list().id);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
  });

  it('REQ-411: ⌘K(Meta+K)로도 열린다', async () => {
    setup();
    await ready();
    await openWithKeys('{Meta>}k{/Meta}');
    expect(input()).toHaveFocus();
  });

  it('REQ-411: 입력란에 포커스가 있어도 Ctrl+K로 열리고, Esc로 닫으면 그 입력란으로 포커스가 돌아간다', async () => {
    setup('#/transport');
    const search = await screen.findByLabelText('패키지 검색');
    search.focus();
    await openWithKeys();
    expect(input()).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '검색 및 명령' })).toBeNull();
    expect(search).toHaveFocus();
  });

  it('REQ-411: 검색 버튼으로 열리고 Esc로 닫으면 검색 버튼으로 포커스가 돌아간다', async () => {
    setup();
    await ready();
    const button = within(screen.getByRole('banner')).getByRole('button', { name: /검색/ });
    await userEvent.click(button);
    expect(input()).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '검색 및 명령' })).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('REQ-411 묶음과 검색', () => {
  it('REQ-411: 묶음은 화면 이동·동작·템플릿·테넌트·패키지이고 각 묶음에 항목이 있다', async () => {
    setup();
    await ready();
    await openWithKeys();
    const names = within(list()).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual(['화면 이동', '동작', '템플릿', '테넌트', '패키지']);
    for (const n of ['대시보드', '새 이관', '템플릿', '이관 이력', '테넌트', '감사 이력']) {
      expect(within(group('화면 이동')).getByRole('option', { name: new RegExp(`^${n}`) })).toBeInTheDocument();
    }
    for (const n of ['새 이관 시작', '원본·대상 변경', '테넌트 등록', '템플릿 만들기', '미리보기 실행']) {
      expect(within(group('동작')).getByRole('option', { name: new RegExp(n) })).toBeInTheDocument();
    }
    expect(within(group('템플릿')).getByRole('option', { name: /Qas to Prd/ })).toBeInTheDocument();
    expect(within(group('테넌트')).getByRole('option', { name: /QAS · 원본으로/ })).toBeInTheDocument();
    expect(within(group('테넌트')).getByRole('option', { name: /QAS · 대상으로/ })).toBeInTheDocument();
    expect(await within(group('패키지')).findByRole('option', { name: /Transport Demo/ })).toBeInTheDocument();
    expect(within(group('패키지')).getAllByRole('option')).toHaveLength(PACKAGES.length);
  });

  it('REQ-411: 검색은 대소문자를 무시하는 포함 검색이고 일치 부분을 강조한다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await within(group('패키지')).findByRole('option', { name: /Transport Demo/ });
    await userEvent.type(input(), 'tRANSPORT d');
    const hit = option(/Transport Demo/);
    expect(hit.querySelector('mark')?.textContent).toBe('Transport D');
    expect(within(list()).queryByRole('option', { name: /Fault Demo/ })).toBeNull();
    expect(within(list()).queryByRole('option', { name: /^대시보드/ })).toBeNull();
  });

  it('REQ-411 실패: 결과가 없으면 "일치하는 항목이 없습니다"를 보인다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.type(input(), 'zzz-없는-항목');
    expect(within(palette()).getByText('일치하는 항목이 없습니다')).toBeInTheDocument();
    expect(within(palette()).queryAllByRole('option')).toHaveLength(0);
  });

  it('REQ-411 실패: 패키지 목록 조회에 실패하면 패키지 묶음에 오류 한 줄을 보이고 나머지 묶음은 동작한다', async () => {
    setup('', { 'GET /packages?tenantId=DEV': () => json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) });
    await ready();
    await openWithKeys();
    expect(await within(group('패키지')).findByText('패키지 목록을 불러오지 못했습니다')).toBeInTheDocument();
    expect(within(group('패키지')).queryAllByRole('option')).toHaveLength(0);
    await userEvent.type(input(), '감사');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/audit');
  });
});

describe('REQ-411 키보드와 실행', () => {
  it('REQ-411: ↑↓로 이동하면 aria-activedescendant와 aria-selected가 따라가고 Enter로 실행한다', async () => {
    setup();
    await ready();
    await openWithKeys();
    const first = activeOption();
    expect(first).not.toBeNull();
    expect(first).toHaveAttribute('role', 'option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    const second = activeOption();
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).not.toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}');
    expect(activeOption()).toBe(first);
    await userEvent.clear(input());
    await userEvent.type(input(), '이관 이력');
    expect(activeOption()).toHaveTextContent('이관 이력');
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: '검색 및 명령' })).toBeNull();
    expect(window.location.hash).toBe('#/history');
    expect(navLink('이관 이력')).toHaveAttribute('aria-current', 'page');
  });

  it('REQ-411: 항목을 마우스로 눌러도 실행된다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.click(within(group('화면 이동')).getByRole('option', { name: /^감사 이력/ }));
    expect(window.location.hash).toBe('#/audit');
    expect(screen.queryByRole('dialog', { name: '검색 및 명령' })).toBeNull();
  });

  it('REQ-411: 패키지 항목 Enter는 그 패키지가 선택된 새 이관 화면을 연다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await within(group('패키지')).findByRole('option', { name: /Transport Demo/ });
    await userEvent.type(input(), 'Transport Demo');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/transport');
    expect(await screen.findByRole('radio', { name: /Transport Demo/ })).toBeChecked();
  });

  it('REQ-411: 템플릿 항목은 그 템플릿의 경로와 패키지로 새 이관 화면을 연다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.type(input(), 'qas to');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/transport');
    expect(await within(routeGroup()).findByRole('button', { name: '원본 QAS 연결됨' })).toBeInTheDocument();
    expect(within(routeGroup()).getByRole('button', { name: '대상 PRD 연결됨' })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /Transport Demo/ })).toBeChecked();
  });

  it('REQ-411: 테넌트 항목으로 대상을 바꾼다. 반대쪽과 같은 테넌트는 비활성이고 이유를 적는다', async () => {
    setup();
    await ready();
    await openWithKeys();
    const same = within(group('테넌트')).getByRole('option', { name: /DEV · 대상으로/ });
    expect(same).toHaveAttribute('aria-disabled', 'true');
    expect(same).toHaveTextContent('원본과 대상은 같을 수 없습니다');
    await userEvent.click(same);
    expect(palette()).toBeInTheDocument();
    await userEvent.click(within(group('테넌트')).getByRole('option', { name: /QAS · 대상으로/ }));
    expect(await within(routeGroup()).findByRole('button', { name: '대상 QAS 연결됨' })).toBeInTheDocument();
  });

  it('REQ-411 실패: 실행할 수 없는 동작(패키지 없는 미리보기)은 비활성이고 이유를 적으며 Enter로 실행되지 않는다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.type(input(), '미리보기 실행');
    const preview = option(/미리보기 실행/);
    expect(preview).toHaveAttribute('aria-disabled', 'true');
    expect(preview).toHaveTextContent('패키지를 먼저 선택하세요');
    await userEvent.keyboard('{Enter}');
    expect(palette()).toBeInTheDocument();
    expect(['', '#/dashboard']).toContain(window.location.hash);
  });

  it('REQ-411: "테넌트 등록" 동작은 테넌트 화면과 등록 서랍을 연다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.type(input(), '테넌트 등록');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/tenants');
    expect(await screen.findByRole('dialog', { name: '테넌트 등록' })).toBeInTheDocument();
  });

  it('REQ-411: "템플릿 만들기" 동작은 템플릿 화면과 만들기 서랍을 연다', async () => {
    setup();
    await ready();
    await openWithKeys();
    await userEvent.type(input(), '템플릿 만들기');
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/templates');
    expect(await screen.findByRole('dialog', { name: '템플릿 만들기' })).toBeInTheDocument();
  });

  it('REQ-411: 서랍 위에서 열면 명령 실행 때 그 창을 닫는다는 안내를 보이고, 실행하면 서랍이 닫힌다', async () => {
    setup('#/tenants');
    await userEvent.click(await screen.findByRole('button', { name: '테넌트 등록' }));
    const drawer = screen.getByRole('dialog', { name: '테넌트 등록' });
    within(drawer).getByLabelText('이름').focus();
    await openWithKeys();
    expect(within(palette()).getByText('명령을 실행하면 열린 창이 닫힙니다')).toBeInTheDocument();
    await userEvent.type(input(), '감사 이력');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '테넌트 등록' })).toBeNull());
    expect(window.location.hash).toBe('#/audit');
  });

  it('REQ-411: 서랍 없이 열면 그 안내가 없다', async () => {
    setup();
    await ready();
    await openWithKeys();
    expect(within(palette()).queryByText('명령을 실행하면 열린 창이 닫힙니다')).toBeNull();
  });
});
