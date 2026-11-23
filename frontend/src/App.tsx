import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BrandIcon } from './components/ui/icons';
import { Button } from './components/ui/Button';
import { HistoryTab } from './features/history/HistoryTab';
import { ActiveJobBanner, ActiveJobContext, useActiveJob } from './features/job/ActiveJobBanner';
import { JobScreen } from './features/job/JobScreen';
import { Dashboard } from './features/dashboard/Dashboard';
import { TransportWizard } from './features/transport/TransportWizard';
import { useWizard } from './features/transport/useWizard';
import { TenantProvider, useTenants } from './features/tenants/TenantContext';
import { TenantTab } from './features/tenants/TenantTab';
import { StatusChips } from './features/tenants/StatusChips';
import { TemplatesScreen } from './features/templates/TemplatesScreen';
import { AuditScreen } from './features/audit/AuditScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { VersionFooter } from './features/version/VersionFooter';
import { CommandPalette, type Command } from './features/palette/CommandPalette';
import { navigate, readRoute, ROUTES } from './app/routes';
import type { TransportTemplate } from './api/types';

export default function App() {
  return <TenantProvider openTenantsTab={() => navigate('tenants')}><AppShell /></TenantProvider>;
}

function AppShell() {
  const [route, setRoute] = useState(readRoute);
  const [revision, setRevision] = useState(0);
  const [create, setCreate] = useState<'tenant' | 'template' | null>(null);
  const [palette, setPalette] = useState<{ overlaid: boolean } | null>(null);
  const main = useRef<HTMLElement>(null);
  const { tenants, sourceTenantId, targetTenantId, setSourceTenantId, setTargetTenantId, readOnly } = useTenants();
  // 새 이관 마법사의 상태는 여기서 들고 있어 팔레트 명령(미리보기 실행·실제 이관·원본·대상 변경)이 같은 상태로 동작한다(REQ-411).
  const activeJob = useActiveJob();
  const wizard = useWizard(route === 'transport', activeJob?.jobId);
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const change = () => { const next = readRoute(); if (next !== routeRef.current) setCreate(null); setRoute(next); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  function openPalette() {
    setPalette({ overlaid: Boolean(document.querySelector('[role="dialog"], dialog[open]')) });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); e.stopPropagation();
        setPalette(current => current ? null : { overlaid: Boolean(document.querySelector('[role="dialog"], dialog[open]')) });
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
    wizard.applyTemplate(t);
    go('transport');
  }
  /** 새 이관 화면으로 가되, 이미 그 화면이면 다시 마운트하지 않는다(아티팩트 목록을 다시 부르지 않음). */
  function showTransport() { if (route !== 'transport') go('transport'); }
  function command(c: Command) {
    // Recheck live eligibility before closing any draft window.
    if (c.type === 'preview' && wizard.previewReason) return;
    if (c.type === 'real' && (wizard.realReason || readOnly !== false)) return;
    if (c.type === 'source' && c.id === targetTenantId || c.type === 'target' && c.id === sourceTenantId) return;
    if (c.type === 'createTenant' && (tenants.state !== 'success' || tenants.data.store !== 'OK')) return;
    if (c.type === 'createTemplate' && (tenants.state !== 'success' || !tenants.data.tenants.length)) return;
    flushSync(() => setPalette(null));
    if (c.type === 'preview' || c.type === 'real') {
      const open = document.querySelector<HTMLElement>('[role="dialog"], dialog[open]');
      if (open) flushSync(() => open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      flushSync(() => {
        showTransport();
        if (c.type === 'preview') wizard.runPreview();
        else wizard.openConfirm();
      });
      if (c.type === 'preview') main.current?.focus();
      return;
    }
    flushSync(() => {
      if (c.type === 'template') useTemplate(c.template);
      else if (c.type === 'package') { wizard.openPackage(c.package); go('transport'); }
      else if (c.type === 'createTenant') go('tenants', 'tenant');
      else if (c.type === 'createTemplate') go('templates', 'template');
      else if (c.type === 'navigate') { if (c.route === 'transport') wizard.restart(); go(c.route); }
      else if (c.type === 'new') { wizard.restart(); go('transport'); }
      else if (c.type === 'route') { showTransport(); wizard.openRouteDialog(); }
      else if (c.type === 'source' || c.type === 'target') { if (c.type === 'source') setSourceTenantId(c.id); else setTargetTenantId(c.id); if (route !== 'job') go(route); }
    });
    // 경로 선택 창은 열리면서 창 안으로 포커스를 옮긴다.
    if (c.type === 'createTenant' || c.type === 'createTemplate' || c.type === 'route') return;
    main.current?.focus();
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
          e.preventDefault(); if (id === 'transport') wizard.restart(); go(id);
        }}
          className={`shrink-0 rounded-md px-4 py-2 font-medium ${route === id ? 'bg-primary-soft text-primary' : 'text-ink-secondary hover:bg-surface-hover'}`}>{label}</a>)}
      </nav>
      {route !== 'job' && activeJob && <ActiveJobBanner job={activeJob} />}
    </header>
    <main ref={main} tabIndex={-1} className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-8 md:px-6">
      <ActiveJobContext.Provider value={activeJob}>
        <div key={`${route}-${revision}`} className="min-w-0">
          {route === 'dashboard' && <Dashboard onForward={(template, packageId) => {
            wizard.forwardPackage(template, packageId);
            go('transport');
          }} />}
          {route === 'transport' && <TransportWizard wizard={wizard} />}
          {route === 'job' && <JobScreen onNew={() => { wizard.restart(); go('transport'); }} />}
          {route === 'history' && <HistoryTab />}
          {route === 'tenants' && <TenantTab initiallyCreate={create === 'tenant'} />}
          {route === 'templates' && <TemplatesScreen initiallyCreate={create === 'template'} onUse={useTemplate} />}
          {route === 'audit' && <AuditScreen />}
          {route === 'settings' && <SettingsScreen />}
        </div>
      </ActiveJobContext.Provider>
    </main>
    <VersionFooter />
    {palette && <CommandPalette overlaid={palette.overlaid} previewReason={wizard.previewReason} realReason={wizard.realReason} onClose={() => setPalette(null)} onCommand={command} />}
  </div>;
}
