import { useState } from 'react';
import { getAudit } from '../../api/client';
import type { AuditCategory } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, Th, Tr, Td } from '../../components/ui/Table';
import { useRemote } from '../../lib/useRemote';
import { formatTime } from '../../lib/formatTime';

const categories = { all: '전체', tenant: '테넌트', template: '템플릿', transport: '이관' };
const actions = { created: '생성', updated: '수정', deleted: '삭제', preview: '미리보기', transport: '실제 이관' };
export function AuditScreen() {
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const { state, retry } = useRemote(() => getAudit(category), category);
  return <section className="grid min-w-0 gap-5">
    <PageHeader title="감사 이력" description="테넌트, 템플릿과 이관 작업의 기록을 확인합니다." />
    <div role="radiogroup" aria-label="분류" className="flex flex-wrap gap-4">
      {Object.entries(categories).map(([value, label]) => <label key={value} className="flex items-center gap-2">
        <input type="radio" name="audit-category" value={value} checked={category === value} onChange={() => setCategory(value as typeof category)} />{label}
      </label>)}
    </div>
    {state.status === 'loading' && <p role="status">불러오는 중</p>}
    {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
    {state.status === 'ok' && (state.data.length === 0 ? <p className="rounded-xl border border-hairline bg-canvas p-10 text-center text-ink-secondary">감사 이력이 없습니다</p> :
      <Table className="min-w-[720px]"><thead><Tr>{['시각', '분류', '동작', '대상 이름', '내용'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead><tbody>
        {[...state.data].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).map(a => <Tr key={a.id}>
          <Td className="whitespace-nowrap">{formatTime(a.time)}</Td><Td>{categories[a.category]}</Td><Td>{actions[a.action]}</Td><Td>{a.objectName}</Td><Td>{a.detail}</Td>
        </Tr>)}
      </tbody></Table>)}
  </section>;
}
