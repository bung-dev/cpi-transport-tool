import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

// 탭 목록은 상단 바에, 탭 패널은 본문에 두므로 둘로 나눈다. 두 컴포넌트는 idBase로 aria-controls/aria-labelledby를 맞춘다.
const tabId = (base: string, id: string) => `${base}-tab-${id}`;
const panelId = (base: string, id: string) => `${base}-panel-${id}`;

interface ListProps {
  /** useId()로 만든 값. TabPanel과 같은 값을 넘긴다. */
  idBase: string;
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  label?: string;
}

// REQ-102 AC-2: 세그먼트 컨트롤 모양. 컨테이너에 overflow-hidden을 두지 않아 포커스 외곽선이 잘리지 않는다(REQ-101 AC-7).
// AI-NOTE: 선택된 탭만 Tab 정지(tabIndex 0)이고 좌우 화살표로 이동한다. 이 키보드 동작은 ADR-012의 결정이다 (근거: REQ-009 AC-2, wiki/decisions/ADR-012)
export function TabList({ idBase, tabs, activeId, onChange, label = '화면' }: ListProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    const target = tabs[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-lg border border-hairline bg-surface p-[3px]"
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={tabId(idBase, t.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(idBase, t.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`h-7 cursor-pointer rounded-md px-3.5 text-[13px] font-medium transition duration-150 ${
              active ? 'bg-canvas text-ink shadow-xs' : 'bg-transparent text-ink-secondary hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

interface PanelProps {
  idBase: string;
  activeId: string;
  children: ReactNode;
}

export function TabPanel({ idBase, activeId, children }: PanelProps) {
  return (
    <div role="tabpanel" id={panelId(idBase, activeId)} aria-labelledby={tabId(idBase, activeId)}>
      {children}
    </div>
  );
}
