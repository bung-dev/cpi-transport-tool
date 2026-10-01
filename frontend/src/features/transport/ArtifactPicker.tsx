import { getArtifacts } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { useRemote } from '../../lib/useRemote';

interface Props {
  packageId: string;
  /** 목록 표시 순서를 유지한 선택 집합 */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function ArtifactPicker({ packageId, selectedIds, onChange }: Props) {
  const { state, retry } = useRemote(() => getArtifacts(packageId), `artifacts:${packageId}`);

  if (state.status === 'loading') return <p role="status">불러오는 중</p>;
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={retry} />;

  const list = state.data;
  const selected = new Set(selectedIds);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(list.filter((a) => next.has(a.id)).map((a) => a.id));
  };

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => onChange(list.map((a) => a.id))}>전체 선택</Button>
        <Button onClick={() => onChange([])}>선택 해제</Button>
      </div>
      <ul className="flex flex-col gap-2 min-w-0" aria-label="아티팩트 목록">
        {list.map((a) => (
          <li key={a.id} className="min-w-0">
            <Checkbox
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              label={
                <>
                  <span className="font-medium">{a.id}</span> <span className="text-ink-secondary">{a.name}</span>{' '}
                  <span className="text-ink-tertiary">{a.version}</span>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
