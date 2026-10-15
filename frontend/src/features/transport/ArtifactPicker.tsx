import { getArtifacts } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CheckboxControl } from '../../components/ui/Checkbox';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';

interface Props {
  /** 선택한 패키지. 아직 고르지 않았으면 null(그때도 카드는 보이고 빈 상태를 보인다) */
  packageId: string | null;
  /** 목록 표시 순서를 유지한 선택 집합 */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

// 목록 행의 모양은 패키지 목록과 같다(REQ-104 AC-4). 행 전체를 label로 감싸고 안쪽 여백으로 포커스 외곽선이 잘리지 않게 한다.
const ROW_BASE =
  'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors duration-150';
const ROW_ON = 'bg-primary-soft';
const ROW_OFF = 'hover:bg-surface-hover';

export function ArtifactPicker({ packageId, selectedIds, onChange }: Props) {
  const { sourceTenantId } = useTenants();
  if (packageId === null || sourceTenantId === null) {
    return (
      <Card title="아티팩트">
        <EmptyState title="패키지를 먼저 선택하세요" />
      </Card>
    );
  }
  return <ArtifactCard source={sourceTenantId} packageId={packageId} selectedIds={selectedIds} onChange={onChange} />;
}

function ArtifactCard({ packageId, selectedIds, onChange, source }: Props & { packageId: string; source: string }) {
  const { state, retry } = useRemote(() => getArtifacts(packageId, source), `artifacts:${source}:${packageId}`);

  if (state.status === 'loading') {
    return (
      <Card title="아티팩트">
        <ListSkeleton />
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card title="아티팩트">
        <ErrorAlert error={state.error} onRetry={retry} />
      </Card>
    );
  }

  const list = state.data;
  const selected = new Set(selectedIds);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(list.filter((a) => next.has(a.id)).map((a) => a.id));
  };

  // 조회가 성공한 상태(0개 포함)에서만 선택 개수와 전체 선택·선택 해제를 보인다(D-019 ①).
  return (
    <Card
      title="아티팩트"
      meta={`${selected.size}개 선택 / 전체 ${list.length}개`}
      actions={
        <>
          <Button size="sm" onClick={() => onChange(list.map((a) => a.id))}>
            전체 선택
          </Button>
          <Button size="sm" onClick={() => onChange([])}>
            선택 해제
          </Button>
        </>
      }
    >
      {list.length === 0 ? (
        <EmptyState title="아티팩트가 없습니다" />
      ) : (
        <ul className="flex max-h-[360px] min-w-0 flex-col gap-0.5 overflow-y-auto" aria-label="아티팩트 목록">
          {list.map((a) => (
            <li key={a.id} className="min-w-0">
              <label className={`${ROW_BASE} ${selected.has(a.id) ? ROW_ON : ROW_OFF}`}>
                <CheckboxControl checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[13px] font-medium break-all">{a.id}</span>
                  <span className="text-ink-secondary break-all">{a.name}</span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-ink-tertiary">{a.version}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
