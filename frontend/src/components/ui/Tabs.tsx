import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

export function Tabs({ tabs, activeId, onChange, children }: Props) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    const target = tabs[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-hairline">
        {tabs.map((t, i) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(t.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`px-4 py-2 text-sm font-medium cursor-pointer -mb-px border-b-2 ${
                active ? 'text-ink border-ink' : 'text-steel border-transparent'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(activeId)} aria-labelledby={tabId(activeId)} className="pt-4">
        {children}
      </div>
    </div>
  );
}
