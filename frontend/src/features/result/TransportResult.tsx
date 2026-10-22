import { useId, useState, type ReactNode } from 'react';
import type { TransportResponse } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { formatTime } from '../../lib/formatTime';
import { ArtifactCard } from './ArtifactCard';
import { deployOutcome } from './deployOutcome';
import { initialExpanded, isProblemArtifact, totalProblemCount } from './problems';
import { useReadOnlyState } from '../tenants/TenantContext';

// REQ-105 AC-8, REQ-012 AC-1: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다.
interface Props {
  result: TransportResponse;
  /** 이관 탭이 넘긴다. 미리보기 결과의 머리에 "이 구성으로 실제 이관" 버튼을 보인다. 이력 상세는 넘기지 않는다(REQ-105 AC-6). */
  onOpenReal?: () => void;
}

export function TransportResult({ result, onOpenReal }: Props) {
  const titleId = useId();
  const noticeId = `${titleId}-read-only`;
  const { realDisabled, notice } = useReadOnlyState();
  const { total, succeeded, failed } = result.summary;
  const outcome = deployOutcome(result);

  // 접기·펼치기와 "문제 항목만 보기" 상태. 새 결과가 나타나면 그 결과의 처음 상태로 초기화한다(REQ-105 AC-5).
  // 렌더 중 이전 결과와 비교해 상태를 맞추는 방식이라 결과가 바뀐 같은 렌더에서 옛 상태가 한 번도 보이지 않는다.
  const [seen, setSeen] = useState(result);
  const [expanded, setExpanded] = useState<boolean[]>(() => initialExpanded(result.results));
  const [onlyProblems, setOnlyProblems] = useState(false);
  let expandedNow = expanded;
  let onlyNow = onlyProblems;
  if (seen !== result) {
    setSeen(result);
    expandedNow = initialExpanded(result.results);
    onlyNow = false;
    setExpanded(expandedNow);
    setOnlyProblems(false);
  }

  const problemTotal = totalProblemCount(result.results);
  const hasProblemArtifact = result.results.some(isProblemArtifact);
  const setAll = (value: boolean) => setExpanded(result.results.map(() => value));

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="mr-1 text-lg font-semibold">
          이관 결과
        </h3>
        {result.dryRun ? <Badge tone="neutral">미리보기</Badge> : <Badge tone="accent">실제 이관</Badge>}
        {result.deploy && <Badge tone="info">배포</Badge>}
        {onOpenReal && result.dryRun && (
          <Button className="ml-auto" disabled={realDisabled} aria-describedby={notice ? noticeId : undefined} onClick={() => { if (!realDisabled) onOpenReal(); }}>
            이 구성으로 실제 이관
          </Button>
        )}
      </div>
      {outcome && <p className={outcome.tone === 'success' ? 'text-success-fg' : 'text-danger-fg'}>{outcome.summary}</p>}
      {onOpenReal && result.dryRun && notice && <p id={noticeId} className="text-sm text-ink-secondary">{notice}</p>}
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
        <Meta label="원본 테넌트">{result.sourceTenant?.name ?? '-'}</Meta>
        <Meta label="대상 테넌트">{result.targetTenant?.name ?? '-'}</Meta>
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <Switch
            label="문제 항목만 보기"
            checked={onlyNow}
            disabled={!hasProblemArtifact}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          <span className="text-xs text-ink-tertiary">문제 항목 {problemTotal}건</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" disabled={onlyNow} onClick={() => setAll(true)}>
            모두 펼치기
          </Button>
          <Button variant="ghost" size="sm" disabled={onlyNow} onClick={() => setAll(false)}>
            모두 접기
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        {result.results.map((r, i) => {
          // 켜진 동안에는 문제 아티팩트의 카드만 남고 모두 펼쳐진 채 고정된다. 끄면 켜기 직전 상태(expanded)로 돌아간다.
          if (onlyNow && !isProblemArtifact(r)) return null;
          return (
            <ArtifactCard
              key={`${r.artifactId}-${i}`}
              r={r}
              expanded={onlyNow || (expandedNow[i] ?? false)}
              onToggle={() => setExpanded(expandedNow.map((v, j) => (j === i ? !v : v)))}
              onlyProblems={onlyNow}
            />
          );
        })}
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
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-2 lg:grid-cols-1 lg:gap-0.5">
      <dt className="pt-px text-xs text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}
