export const ROUTES = [
  ['dashboard', '대시보드'], ['transport', '새 이관'], ['templates', '템플릿'],
  ['history', '이관 이력'], ['tenants', '테넌트'], ['audit', '감사 이력'],
] as const;
export type Route = typeof ROUTES[number][0];
export function readRoute(): Route {
  return ROUTES.find(([id]) => window.location.hash === `#/${id}`)?.[0] ?? 'dashboard';
}
export function navigate(route: Route) { window.location.hash = `#/${route}`; }
