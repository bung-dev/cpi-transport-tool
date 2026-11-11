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
  packageId: string | null;
  createdAt: string;
  updatedAt: string;
  usable: boolean;
  unusableReason?: 'SOURCE_TENANT_MISSING' | 'TARGET_TENANT_MISSING';
}
export const tpl = (over: Partial<TemplateFixture> & Pick<TemplateFixture, 'id' | 'name'>): TemplateFixture => ({
  sourceTenantId: 'DEV',
  targetTenantId: 'PRD',
  packageId: null,
  createdAt: '2026-11-10T01:00:00Z',
  updatedAt: '2026-11-10T01:00:00Z',
  usable: true,
  ...over,
});

export const REGISTERED: Tenant = { id: 't-new', name: '새 테넌트', apiHost: 'localhost', source: 'registered', createdAt: null };

/** 기본 테넌트 두 개(DEV·PRD, env)와 상태 OK. 추가 경로를 덮어쓸 수 있다. */
export function baseRoutes(extra: Parameters<typeof mockApi>[0] = {}): Parameters<typeof mockApi>[0] {
  return {
    'GET /tenants': () => json(TENANTS_OK),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /templates': () => json([]),
    ...extra,
  };
}
