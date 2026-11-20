export const ROUTES = [
  ['dashboard', '대시보드'], ['transport', '새 이관'], ['templates', '템플릿'],
  ['history', '이관 이력'], ['tenants', '테넌트'], ['audit', '감사 이력'],
  ['settings', '설정'],
] as const;
export type Route = typeof ROUTES[number][0] | 'job';
export function readRoute(): Route {
  const [path] = window.location.hash.split('?');
  if (path === '#/job') return 'job';
  return ROUTES.find(([id]) => path === `#/${id}`)?.[0] ?? 'dashboard';
}
export function readQuery(): string {
  const hash = window.location.hash;
  const start = hash.indexOf('?');
  return start === -1 ? '' : hash.slice(start + 1);
}
export function subscribeToHashChange(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
export function navigate(route: Route) { window.location.hash = `#/${route}`; }
export function jobHref(jobId: string) { return `#/job?id=${encodeURIComponent(jobId)}`; }
