import type { JobStage } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import type { Wizard } from './useWizard';

const STAGES: Record<JobStage, string> = {
  WAITING: '대기', DOWNLOAD: '내려받기', CONFIGURATION_READ: '구성 값 읽기', TARGET: '대상 확인',
  UPLOAD: '업로드', DEPLOY: '배포', DONE: '완료', SKIPPED: '건너뜀',
};

export function PreviewProgress({ job, artifacts, onCancel }: {
  job: NonNullable<Wizard['previewJob']>;
  artifacts: Wizard['artifacts'];
  onCancel: () => void;
}) {
  return (
    <Card role={job.items ? 'region' : 'group'} aria-label="미리보기 진행" title={`미리보기 중 ${job.done}/${job.total}`}
      actions={<Button size="sm" disabled={job.cancelRequested} onClick={onCancel}>취소</Button>}>
      <progress aria-label="미리보기 진행률" aria-valuenow={job.done} aria-valuemax={job.total}
        value={job.done} max={job.total || 1} className="block h-2 w-full accent-primary" />
      {job.items === null ? <ListSkeleton /> : <ul aria-label="iFlow 진행" className="mt-3 min-w-0 divide-y divide-hairline">
        {job.items.map(item => {
          const list = artifacts[item.packageId];
          const name = list?.status === 'ok' && list.items.find(a => a.id === item.artifactId)?.name;
          const stage = item.stage === 'DONE' && item.status === 'FAILED' ? '실패' : STAGES[item.stage];
          return (
            <li key={JSON.stringify([item.packageId, item.artifactId])} className="flex min-w-0 items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 break-all">{name || item.artifactId}</span>
              <span className="shrink-0 text-sm text-ink-secondary">{stage}</span>
            </li>
          );
        })}
      </ul>}
    </Card>
  );
}
