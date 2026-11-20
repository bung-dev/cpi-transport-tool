import { packageSummary } from '../../lib/packageSummary';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { TransportHistoryEntry } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { formatTime } from '../../lib/formatTime';
import { ArtifactCard } from './ArtifactCard';
import { deployOutcome } from './deployOutcome';
import { failedArtifactCount, initialExpanded, isProblemArtifact, totalProblemCount } from './problems';
import { useReadOnlyState } from '../tenants/TenantContext';

// REQ-105 AC-8, REQ-012 AC-1: 서버 값은 모두 JSX 텍스트 노드로만 렌더링한다.
interface Props {
  result: TransportHistoryEntry;
  /** 이관 탭이 넘긴다. 미리보기 결과의 머리에 "이 구성으로 실제 이관" 버튼을 보인다. 이력 상세는 넘기지 않는다(REQ-105 AC-6). */
  onOpenReal?: () => void;
}

export function TransportResult({ result, onOpenReal }: Props) {
  const titleId = useId();
  const noticeId = `${titleId}-read-only`;
  const { realDisabled, notice } = useReadOnlyState();
  const summary = result.summary;
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
  const failedArtifacts = failedArtifactCount(result.results);
  const hasProblemArtifact = result.results.some(isProblemArtifact);
  const setAll = (value: boolean) => setExpanded(result.results.map(() => value));
  // 탐색 목록에서 고른 아티팩트의 카드 요소(인덱스 → 카드를 감싼 요소)
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const jumpTo = (i: number) => {
    // 토글이 아니라 펼침으로 맞춘다(이미 펼침이면 그대로).
    if (!expandedNow[i]) setExpanded(expandedNow.map((v, j) => (j === i ? true : v)));
    // 결과로 스크롤하는 규칙과 같게 동작 줄이기 설정이면 즉시 이동한다(REQ-105 AC-7).
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cardRefs.current.get(i)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const route = `${result.sourceTenant?.name ?? '-'} → ${result.targetTenant?.name ?? '-'}`;

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
      {/* 경로·템플릿은 메타 dl 밖에 둔다(dl의 용어 목록과 순서는 그대로, REQ-424). 머리 줄 바로 다음은 배포 결과 요약 자리라 그 뒤에 둔다(REQ-309 AC-8). */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <p className="min-w-0 break-all font-medium">{route}</p>
        {result.template && <p className="min-w-0 break-all text-ink-secondary">{`템플릿 ${result.template.name}`}</p>}
      </div>
      {summary && <div className="grid grid-cols-3 gap-3">
        <Stat label="전체" value={summary.total} />
        <Stat label="성공" value={summary.succeeded} valueClass={summary.succeeded >= 1 ? 'text-success-fg' : 'text-ink'} />
        <Stat label="실패" value={summary.failed} valueClass={summary.failed >= 1 ? 'text-danger-fg' : 'text-ink'} />
      </div>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-hairline bg-canvas px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 min-w-0">
        <Meta label="이관 ID">
          <span className="font-mono text-[13px]">{result.transportId}</span>
        </Meta>
        <Meta label="패키지">
          <span className="font-mono text-[13px]">{packageSummary(result.packages)}</span>
        </Meta>
        <Meta label="시작">{formatTime(result.startedAt)}</Meta>
        <Meta label="종료">{formatTime(result.finishedAt)}</Meta>
        <Meta label="원본 테넌트">{result.sourceTenant?.name ?? '-'}</Meta>
        <Meta label="대상 테넌트">{result.targetTenant?.name ?? '-'}</Meta>
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Switch
            label="문제 항목만 보기"
            checked={onlyNow}
            disabled={!hasProblemArtifact}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          <span className="text-xs text-ink-tertiary">Externalized Parameters 문제 {problemTotal}건</span>
          {/* REQ-511: 구성 값 문제 수와 실패 아티팩트 수는 별도로 보인다. 필터를 켜면 FAILED 카드도 남는다. */}
          {failedArtifacts >= 1 && <span className="text-xs font-medium text-danger-fg">실패 아티팩트 {failedArtifacts}개</span>}
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
      {/* 넓은 폭: 왼쪽 탐색 목록·오른쪽 상세 카드 2열. 좁은 폭: 1열로 쌓는다(REQ-424). */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="결과 바로가기" className="min-w-0 self-start rounded-lg border border-hairline bg-canvas p-2">
          <ul className="flex flex-col gap-0.5">
            {result.results.map((r, i) => {
              if (onlyNow && !isProblemArtifact(r)) return null;
              return (
                <li key={`${r.artifactId}-${i}`}>
                  <button
                    type="button"
                    aria-label={`${r.artifactId} 바로가기`}
                    onClick={() => jumpTo(i)}
                    className={`w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs break-all transition-colors duration-150 hover:bg-neutral-bg ${r.status === 'FAILED' ? 'text-danger-fg' : 'text-ink-secondary'}`}
                  >
                    {r.artifactId}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 min-w-0">
          {result.packages.map((pkg, packageIndex) => (
            <div key={pkg.packageId} role="group" aria-labelledby={`${titleId}-package-${packageIndex}`} className="flex min-w-0 flex-col gap-3">
              <h3 id={`${titleId}-package-${packageIndex}`} className="min-w-0 break-all font-semibold">
                {pkg.packageName && <span className="break-all">{pkg.packageName} </span>}
                <span className="font-mono break-all">{pkg.packageId}</span>
              </h3>
              {!result.dryRun && pkg.targetPackage && pkg.targetPackage !== 'NOT_CHECKED' &&
                <div><StatusBadge kind="targetPackage" value={pkg.targetPackage} /></div>}
              {result.results.map((r, i) => {
                if ((r.packageId ?? result.packages[0]?.packageId) !== pkg.packageId) return null;
                // 켜진 동안에는 문제 아티팩트의 카드만 남고 모두 펼쳐진 채 고정된다. 끄면 켜기 직전 상태(expanded)로 돌아간다.
                if (onlyNow && !isProblemArtifact(r)) return null;
                return (
                  <div
                    key={`${r.artifactId}-${i}`}
                    className="min-w-0 scroll-mt-[76px]"
                    ref={(el) => {
                      if (el) cardRefs.current.set(i, el);
                      else cardRefs.current.delete(i);
                    }}
                  >
                    <ArtifactCard
                      r={r}
                      expanded={onlyNow || (expandedNow[i] ?? false)}
                      onToggle={() => setExpanded(expandedNow.map((v, j) => (j === i ? !v : v)))}
                      onlyProblems={onlyNow}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
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
