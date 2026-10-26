import { useState } from 'react';
import { getPackages } from '../../api/client';
import type { ArtifactSummary } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { RadioControl } from '../../components/ui/Radio';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';
import { hasNoTenants, REGISTER_TENANT_FIRST } from './noTenants';

interface Props {
  selectedId: string | null;
  /** 선택한 패키지의 id와 name(실행 카드 요약에 쓴다) */
  onSelect: (pkg: ArtifactSummary) => void;
}

// 행 전체를 label로 감싸 어디를 눌러도 선택된다(REQ-104 AC-2). 선택된 행은 primary-soft, 아니면 hover surface-hover.
// 행 안쪽 여백(px-2.5)이 있어 360px 스크롤 영역 안에서도 라디오의 포커스 외곽선이 잘리지 않는다(REQ-101 AC-7).
const ROW_BASE =
  'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors duration-150';
const ROW_ON = 'bg-primary-soft';
const ROW_OFF = 'hover:bg-surface-hover';

export function PackagePicker(props: Props) {
  const { tenants, sourceTenantId } = useTenants();
  if (!sourceTenantId) return <EmptyState title={hasNoTenants(tenants) ? REGISTER_TENANT_FIRST : '원본 테넌트를 선택하세요'} />;
  return <PackageList key={sourceTenantId} {...props} source={sourceTenantId} />;
}

function PackageList({ selectedId, onSelect, source }: Props & { source: string }) {
  const { state, retry } = useRemote(() => getPackages(source), 'packages:' + source);
  const [query, setQuery] = useState('');

  if (state.status === 'loading') return <ListSkeleton />;
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={retry} />;
  if (state.data.length === 0) return <EmptyState title="패키지가 없습니다" />;

  // 정규식이 아니라 includes 로 비교한다: ( [ 같은 입력도 글자 그대로 취급된다.
  const q = query.toLowerCase();
  const shown = state.data.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const total = state.data.length;

  return (
    <div className="flex flex-col min-w-0">
      <TextInput
        label="패키지 검색"
        hideLabel
        icon={<SearchIcon />}
        placeholder="이름 또는 ID로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="mt-2.5 mb-1.5 px-0.5 text-xs text-ink-tertiary">
        {query === '' ? `전체 ${total}개` : `${total}개 중 ${shown.length}개`}
      </p>
      {shown.length === 0 ? (
        <EmptyState title="검색 결과가 없습니다" />
      ) : (
        <ul className="flex max-h-[360px] min-w-0 flex-col gap-0.5 overflow-y-auto" aria-label="패키지 목록">
          {shown.map((p) => (
            <li key={p.id} className="min-w-0">
              <label className={`${ROW_BASE} ${selectedId === p.id ? ROW_ON : ROW_OFF}`}>
                <RadioControl name="package" checked={selectedId === p.id} onChange={() => onSelect(p)} />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium break-all">{p.name}</span>
                  <span className="font-mono text-[13px] text-ink-secondary break-all">{p.id}</span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-ink-tertiary">{p.version}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
