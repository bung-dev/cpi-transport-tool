import { useId, type ReactNode } from 'react';
import type { TransportResponse } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { formatTime } from '../../lib/formatTime';
import { ArtifactCard } from './ArtifactCard';

// REQ-105 AC-8, REQ-012 AC-1: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다.
export function TransportResult({ result }: { result: TransportResponse }) {
  const titleId = useId();
  const { total, succeeded, failed } = result.summary;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="mr-1 text-lg font-semibold">
          이관 결과
        </h3>
        {result.dryRun ? <Badge tone="neutral">드라이런</Badge> : <Badge tone="accent">실제 이관</Badge>}
        {result.deploy && <Badge tone="info">배포</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="전체" value={total} />
        <Stat label="성공" value={succeeded} valueClass={succeeded >= 1 ? 'text-success-fg' : 'text-ink'} />
        <Stat label="실패" value={failed} valueClass={failed >= 1 ? 'text-danger-fg' : 'text-ink'} />
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-hairline bg-canvas px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 min-w-0">
        <Meta label="이관 ID">
          <span className="font-mono text-[13px]">{result.transportId}</span>
        </Meta>
        <Meta label="패키지 ID">
          <span className="font-mono text-[13px]">{result.packageId}</span>
        </Meta>
        <Meta label="시작">{formatTime(result.startedAt)}</Meta>
        <Meta label="종료">{formatTime(result.finishedAt)}</Meta>
      </dl>
      <div className="flex flex-col gap-3 min-w-0">
        {result.results.map((r, i) => (
          <ArtifactCard key={`${r.artifactId}-${i}`} r={r} />
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, valueClass = 'text-ink' }: { label: string; value: number; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-hairline bg-canvas px-4 py-3 shadow-xs">
      <span className="text-xs text-ink-tertiary">{label}</span>
      <span className={`block text-2xl font-semibold leading-snug tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-2 lg:grid-cols-1 lg:gap-0.5">
      <dt className="pt-px text-xs text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}
