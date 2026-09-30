import { useState } from 'react';
import { getPackages } from '../../api/client';
import { ErrorAlert } from '../../components/ErrorAlert';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PackagePicker({ selectedId, onSelect }: Props) {
  const { state, retry } = useRemote(getPackages, 'packages');
  const [query, setQuery] = useState('');

  if (state.status === 'loading') return <p role="status">불러오는 중</p>;
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={retry} />;
  if (state.data.length === 0) return <p>패키지가 없습니다</p>;

  // 정규식이 아니라 includes 로 비교한다: ( [ 같은 입력도 글자 그대로 취급된다.
  const q = query.toLowerCase();
  const shown = state.data.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <TextInput label="패키지 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="flex flex-col gap-2 min-w-0" aria-label="패키지 목록">
        {shown.map((p) => (
          <li key={p.id} className="flex items-start gap-2 min-w-0">
            <input
              id={`pkg-${p.id}`}
              type="radio"
              name="package"
              className="mt-1 h-4 w-4 accent-primary"
              checked={selectedId === p.id}
              onChange={() => onSelect(p.id)}
            />
            <label htmlFor={`pkg-${p.id}`} className="text-sm break-all min-w-0">
              <span className="font-medium">{p.name}</span> <span className="text-slate">{p.id}</span>{' '}
              <span className="text-steel">{p.version}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
