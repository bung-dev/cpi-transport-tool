import type { TransportJob } from '../../api/types';
import { jobHref } from '../../app/routes';

const finishedJobs = new Set<string>();
const complete = '(완료) ';
const needsAttention = '(확인 필요) ';
const preferenceKey = 'cpi-transport.browser-notice';
const statusLabels = { COMPLETED: '완료', CANCELLED: '취소됨', INTERRUPTED: '중단됨' };
let preferenceWriteFailed = false;

type BrowserNoticeSetting = 'off' | 'on' | 'blocked' | 'unsupported';

export function readBrowserNoticeSetting(): BrowserNoticeSetting {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    if (preferenceWriteFailed || localStorage.getItem(preferenceKey) !== 'on') return 'off';
    return Notification.permission === 'granted' ? 'on' : 'blocked';
  } catch {
    return 'off';
  }
}

function savePreference(enabled: boolean): BrowserNoticeSetting {
  try {
    if (enabled) localStorage.setItem(preferenceKey, 'on');
    else localStorage.removeItem(preferenceKey);
    preferenceWriteFailed = false;
    return readBrowserNoticeSetting();
  } catch {
    // 끄기 저장에 실패해도 이 탭에서는 이전 켜짐 값을 사용하지 않는다.
    preferenceWriteFailed = true;
    return 'off';
  }
}

export async function setBrowserNoticeEnabled(enabled: boolean): Promise<BrowserNoticeSetting> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (!enabled) return savePreference(false);
  try {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission() : Notification.permission;
    if (permission === 'granted') return savePreference(true);
  } catch {
    // 권한 요청에 실패하면 거부된 경우와 같은 안내를 보여 준다.
  }
  savePreference(false);
  return 'blocked';
}

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

  if (readBrowserNoticeSetting() !== 'on') return;
  const notificationTitle = `${job.dryRun ? '미리보기' : '실제 이관'} ${statusLabels[job.status]}`;
  const tenants = `${job.sourceTenant?.name ?? ''} → ${job.targetTenant?.name ?? ''}`;
  const summary = result?.summary;
  const body = summary ? `${tenants} · 성공 ${summary.succeeded} · 실패 ${summary.failed}` : tenants;
  const href = job.dryRun ? '#/transport' : jobHref(job.jobId);
  try {
    const notification = new Notification(notificationTitle, { body, tag: job.jobId });
    notification.onclick = () => {
      window.focus();
      if (window.location.hash !== href) window.location.hash = href;
      notification.close();
    };
  } catch {
    // 브라우저가 알림을 만들 수 없어도 탭 제목 표시는 유지한다.
  }
}
