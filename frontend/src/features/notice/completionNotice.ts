import type { TransportJob } from '../../api/types';

const finishedJobs = new Set<string>();
const complete = '(완료) ';
const needsAttention = '(확인 필요) ';

function titlePrefix(title: string) {
  if (title.startsWith(needsAttention)) return needsAttention;
  if (title.startsWith(complete)) return complete;
  return '';
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const prefix = titlePrefix(document.title);
  if (prefix) document.title = document.title.slice(prefix.length);
});

export function noticeJobFinished(job: TransportJob) {
  if (job.status === 'RUNNING' || finishedJobs.has(job.jobId)) return;
  finishedJobs.add(job.jobId);
  if (document.visibilityState !== 'hidden') return;

  const { result } = job;
  const attention = job.status !== 'COMPLETED' || (result?.summary?.failed ?? 0) > 0
    || (result?.summary?.skipped ?? 0) > 0 || (result?.skipped?.length ?? 0) > 0;
  const title = document.title;
  const prefix = titlePrefix(title);
  const next = attention || prefix === needsAttention ? needsAttention : complete;
  if (prefix !== next) document.title = next + title.slice(prefix.length);
}
