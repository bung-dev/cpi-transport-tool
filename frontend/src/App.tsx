import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BrandIcon } from './components/ui/icons';
import { Button } from './components/ui/Button';
import { HistoryTab } from './features/history/HistoryTab';
import { TransportTab } from './features/transport/TransportTab';
import { TenantProvider, useTenants } from './features/tenants/TenantContext';
import { TenantTab } from './features/tenants/TenantTab';
import { StatusChips } from './features/tenants/StatusChips';
import { TemplatesScreen } from './features/templates/TemplatesScreen';
import { AuditScreen } from './features/audit/AuditScreen';
import { CommandPalette, type Command } from './features/palette/CommandPalette';
import { navigate, readRoute, ROUTES } from './app/routes';
import { runTransportCommand, transportCommandReason } from './app/legacyTransport';
import type { ArtifactSummary, TransportTemplate } from './api/types';

export default function App() {
  return <TenantProvider openTenantsTab={() => navigate('tenants')}><AppShell /></TenantProvider>;
}

function AppShell() {
  const [route, setRoute] = useState(readRoute);
  const [revision, setRevision] = useState(0);
  const [create, setCreate] = useState<'tenant' | 'template' | null>(null);
  const [initial, setInitial] = useState<{ source: string | null; package: ArtifactSummary } | null>(null);
  const [palette, setPalette] = useState<{ overlaid: boolean; reason?: string } | null>(null);
  const main = useRef<HTMLElement>(null);
  const { tenants, sourceTenantId, targetTenantId, setSourceTenantId, setTargetTenantId, readOnly } = useTenants();
  useEffect(() => { if (initial && initial.source !== sourceTenantId) setInitial(null); }, [initial, sourceTenantId]);
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const change = () => { const next = readRoute(); if (next !== routeRef.current) { setCreate(null); setInitial(null); } setRoute(next); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  function openPalette() {
    setPalette({ overlaid: Boolean(document.querySelector('[role="dialog"], dialog[open]')), reason: transportCommandReason() });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); e.stopPropagation();
        setPalette(current => current ? null : { overlaid: Boolean(document.querySelector('[role="dialog"], dialog[open]')), reason: transportCommandReason() });
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  function go(next: typeof route, creating: typeof create = null) {
    setCreate(creating); setRoute(next); navigate(next);
    setRevision(n => n + 1);
  }
  function useTemplate(t: TransportTemplate) {
    if (!t.usable) return;
    setSourceTenantId(t.sourceTenantId); setTargetTenantId(t.targetTenantId);
    setInitial(t.packageId ? { source: t.sourceTenantId, package: { id: t.packageId, name: t.packageId, version: '' } } : null);
    go('transport');
  }
  function command(c: Command) {
    // Recheck live eligibility before closing any draft window.
    if ((c.type === 'preview' || c.type === 'real') && (transportCommandReason() || (c.type === 'real' && readOnly !== false))) return;
    if (c.type === 'source' && c.id === targetTenantId || c.type === 'target' && c.id === sourceTenantId) return;
    if (c.type === 'createTenant' && (tenants.state !== 'success' || tenants.data.store !== 'OK')) return;
    if (c.type === 'createTemplate' && (tenants.state !== 'success' || !tenants.data.tenants.length)) return;
    flushSync(() => setPalette(null));
    if (c.type === 'preview' || c.type === 'real') {
      const open = document.querySelector<HTMLElement>('[role="dialog"], dialog[open]');
      if (open) flushSync(() => open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      runTransportCommand(c.type === 'real');
      return;
    }
    flushSync(() => {
      if (c.type === 'template') useTemplate(c.template);
      else if (c.type === 'package') { setInitial({ source: sourceTenantId, package: c.package }); go('transport'); }
      else if (c.type === 'createTenant') go('tenants', 'tenant');
      else if (c.type === 'createTemplate') go('templates', 'template');
      else if (c.type === 'navigate') { setInitial(null); go(c.route); }
      else if (c.type === 'new' || c.type === 'route') { setInitial(null); go('transport'); }
      else if (c.type === 'source' || c.type === 'target') { if (c.type === 'source') setSourceTenantId(c.id); else setTargetTenantId(c.id); setInitial(null); go(route); }
    });
    if (c.type === 'createTenant' || c.type === 'createTemplate') return;
    if (c.type === 'route') main.current?.querySelector<HTMLInputElement>('input[name$="-source"]')?.focus();
    else if (c.type === 'package' || c.type === 'template') {
      // Package options arrive asynchronously; the form remains usable while loading.
      main.current?.focus();
    } else main.current?.focus();
  }
  return <div className="min-h-screen min-w-0 bg-surface text-ink">
    <header className="sticky top-0 z-10 border-b border-hairline bg-canvas">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-4 px-4 py-4 md:px-6">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-on-primary"><BrandIcon /></span><h1 className="text-base font-semibold tracking-tight">CPI Transport Tool</h1></div>
        <div className="min-w-0 sm:ml-auto"><StatusChips /></div>
        <Button aria-keyshortcuts="Control+k Meta+k" aria-haspopup="dialog" onClick={openPalette}>검색 및 명령 <kbd className="ml-2 text-xs">⌘K</kbd></Button>
      </div>
      <nav aria-label="주 메뉴" className="mx-auto flex max-w-[1200px] gap-2 overflow-x-auto px-4 py-2 md:px-6">
        {ROUTES.map(([id, label]) => <a key={id} href={`#/${id}`} aria-current={route === id ? 'page' : undefined} onClick={e => {
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault(); setInitial(null); go(id);
        }}
          className={`shrink-0 rounded-md px-4 py-2 font-medium ${route === id ? 'bg-primary-soft text-primary' : 'text-ink-secondary hover:bg-surface-hover'}`}>{label}</a>)}
      </nav>
    </header>
    <main ref={main} tabIndex={-1} className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-8 md:px-6">
      <div key={`${route}-${revision}`} className="min-w-0">
        {route === 'dashboard' && <section className="rounded-xl border border-hairline bg-canvas p-6"><h2 className="text-2xl font-semibold">대시보드</h2><p className="mt-3 text-ink-secondary">경로를 확인하고 새 이관을 준비하세요. 템플릿과 이관 이력은 주 메뉴에서 확인할 수 있습니다.</p></section>}
        {route === 'transport' && <TransportTab initialPackage={initial?.source === sourceTenantId ? initial.package : null} />}
        {route === 'history' && <HistoryTab />}
        {route === 'tenants' && <TenantTab initiallyCreate={create === 'tenant'} />}
        {route === 'templates' && <TemplatesScreen initiallyCreate={create === 'template'} onUse={useTemplate} />}
        {route === 'audit' && <AuditScreen />}
      </div>
    </main>
    {palette && <CommandPalette overlaid={palette.overlaid} previewReason={palette.reason} realReason={palette.reason} onClose={() => setPalette(null)} onCommand={command} />}
  </div>;
}
