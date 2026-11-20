import { render, screen, within } from '@testing-library/react';
import App from '../App';
import type { Tenant } from '../api/types';
import { json, mockApi } from './mockFetch';
import { TENANTS_OK, TENANT_STATUS_OK } from './tenantFixtures';

// S2(REQ-410~414) 공용: 화면 위치는 URL 해시다. 테스트는 해시를 정한 뒤 App을 그린다.
export const ROUTES = {
  대시보드: '#/dashboard',
  '새 이관': '#/transport',
  템플릿: '#/templates',
  '이관 이력': '#/history',
  테넌트: '#/tenants',
  '감사 이력': '#/audit',
  // 20261119-transport-speedup S3 REQ-708: 맨 끝 탭
  설정: '#/settings',
} as const;
export type NavName = keyof typeof ROUTES;
export const NAV_NAMES = Object.keys(ROUTES) as NavName[];

export function setHash(hash: string) {
  window.history.replaceState(null, '', hash ? `/${hash}` : '/');
}
export function renderAt(hash: string) {
  setHash(hash);
  return render(<App />);
}
export const mainNav = () => screen.getByRole('navigation', { name: '주 메뉴' });
export const navLink = (name: NavName) => within(mainNav()).getByRole('link', { name });
export const routeGroup = () => within(screen.getByRole('banner')).getByRole('group', { name: '경로' });

export interface TemplateFixture {
  id: string;
  name: string;
  sourceTenantId: string;
  targetTenantId: string;
  createdAt: string;
  updatedAt: string;
  usable: boolean;
  unusableReason?: 'SOURCE_TENANT_MISSING' | 'TARGET_TENANT_MISSING';
}
export const tpl = (over: Partial<TemplateFixture> & Pick<TemplateFixture, 'id' | 'name'>): TemplateFixture => ({
  sourceTenantId: 'DEV',
  targetTenantId: 'PRD',
  createdAt: '2026-11-10T01:00:00Z',
  updatedAt: '2026-11-10T01:00:00Z',
  usable: true,
  ...over,
});

export const REGISTERED: Tenant = { id: 't-new', name: '새 테넌트', apiHost: 'localhost', source: 'registered', createdAt: null };

export const EMPTY_DASHBOARD = {
  nodes: [{ id: 'DEV', name: 'DEV', origin: 'env' }, { id: 'PRD', name: 'PRD', origin: 'env' }],
  edges: [],
  queue: [],
  today: { previews: 0, transports: 0, succeeded: 0, failed: 0 },
};

/** 기본 테넌트 두 개(DEV·PRD, env)와 상태 OK. 추가 경로를 덮어쓸 수 있다. */
export function baseRoutes(extra: Parameters<typeof mockApi>[0] = {}): Parameters<typeof mockApi>[0] {
  return {
    'GET /tenants': () => json(TENANTS_OK),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /templates': () => json([]),
    // S4(REQ-430): 대시보드 화면이 읽는다. 기본은 경로·대기 없는 DEV·PRD 두 노드
    'GET /dashboard': () => json(EMPTY_DASHBOARD),
    ...extra,
  };
}
