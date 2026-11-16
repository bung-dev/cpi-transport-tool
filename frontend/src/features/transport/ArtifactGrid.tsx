import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ArtifactSummary } from '../../api/types';

interface Props {
  artifacts: ArtifactSummary[];
  /** 목록 순서를 유지한 선택 */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

// AI-NOTE: 한 열 grid. 행 하나만 tabindex=0(로빙)이라 표의 Tab 진입점은 하나이고, 행 안에는 포커스 가능한 요소를 두지 않는다. 선택은 aria-selected와 보이는 ✓ 표시로 함께 나타낸다(색만으로 구분하지 않음) (근거: REQ-422, ADR-012, REQ-108 AC-3)
export function ArtifactGrid({ artifacts, selectedIds, onChange }: Props) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  const selected = new Set(selectedIds);
  const active = Math.min(focusIndex, Math.max(0, artifacts.length - 1));

  const emit = (next: Set<string>) => onChange(artifacts.filter(a => next.has(a.id)).map(a => a.id));
  const toggle = (i: number) => {
    const next = new Set(selected);
    const id = artifacts[i].id;
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAnchor(i);
    emit(next);
  };
  const addRange = (from: number, to: number) => {
    const next = new Set(selected);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(artifacts[i].id);
    emit(next);
  };
  const move = (i: number) => {
    setFocusIndex(i);
    rows.current[i]?.focus();
  };

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>, i: number) {
    const last = artifacts.length - 1;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      emit(new Set(artifacts.map(a => a.id)));
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(last, i + 1) : Math.max(0, i - 1);
      if (e.shiftKey) addRange(anchor, next);
      move(next);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(e.key === 'Home' ? 0 : last);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle(i);
    }
  }

  function onClick(e: MouseEvent<HTMLTableRowElement>, i: number) {
    setFocusIndex(i);
    if (e.shiftKey) addRange(anchor, i);
    else toggle(i);
  }

  return (
    <table role="grid" aria-label="이관할 아티팩트" aria-multiselectable="true" className="w-full min-w-0 border-separate border-spacing-y-0.5">
      <tbody>
        {artifacts.map((a, i) => {
          const on = selected.has(a.id);
          return (
            <tr key={a.id} ref={el => { rows.current[i] = el; }} aria-selected={on} tabIndex={i === active ? 0 : -1}
              onClick={e => onClick(e, i)} onKeyDown={e => onKeyDown(e, i)} onFocus={() => setFocusIndex(i)}
              className={`cursor-pointer select-none transition-colors duration-150 ${on ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`}>
              <td role="gridcell" className="rounded-md px-2.5 py-1.5">
                <span className="flex min-h-7 min-w-0 items-center gap-2.5">
                  <span className="grid h-4 w-4 shrink-0 place-items-center text-primary">
                    {on && <span data-check-mark aria-hidden="true">✓</span>}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[13px] font-medium break-all">{a.id}</span>{' '}
                    <span className="text-ink-secondary break-all">{a.name}</span>
                  </span>{' '}
                  <span className="ml-auto shrink-0 text-xs text-ink-tertiary">{a.version}</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
