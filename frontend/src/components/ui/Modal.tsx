import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Native top-layer dialog, with a fallback for environments without showModal. */
export function Modal({ title, children, onClose, drawer = false, busy = false, palette = false }: {
  title: string; children: ReactNode; onClose: () => void; drawer?: boolean; busy?: boolean; palette?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLElement>('input:not([type=file]), textarea, select, button')?.focus();
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>('main');
      target?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} aria-modal="true" aria-labelledby={id}
    className={`app-modal ${drawer ? 'app-drawer' : ''} ${palette ? 'app-palette' : ''}`}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onClose(); }
      if (e.key !== 'Tab') return;
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('input:not(:disabled):not([type=file]), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
    <h2 id={id} className="mb-5 text-xl font-semibold">{title}</h2>
    {children}
  </dialog>, document.body);
}
