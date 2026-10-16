import type { TransportResponse } from '../../api/types';
import { badgeTone } from '../../design/statusBadges';

/** REQ-309 AC-8·AC-9: 결과 화면과 이력은 같은 표시 조건과 배포 건수를 쓴다. */
export function deployOutcome({ dryRun, deploy, results }: Pick<TransportResponse, 'dryRun' | 'deploy' | 'results'>) {
  if (dryRun !== false || deploy !== true) return null;
  let started = 0;
  let errors = 0;
  let timeouts = 0;
  let notDeployed = 0;
  for (const { deployStatus } of results) {
    switch (deployStatus) {
      case 'STARTED': started++; break;
      case 'ERROR': errors++; break;
      case 'TIMEOUT': timeouts++; break;
      default: notDeployed++;
    }
  }
  if (started + errors + timeouts === 0) return null;
  const failures = errors + timeouts;
  const parts = [
    errors > 0 ? `배포 실패 ${errors}개` : null,
    timeouts > 0 ? `시간 초과 ${timeouts}개` : null,
    started > 0 ? `배포 성공 ${started}개` : null,
    notDeployed > 0 ? `배포 안 됨 ${notDeployed}개` : null,
  ];
  return {
    tone: badgeTone('deployStatus', failures > 0 ? 'ERROR' : 'STARTED'),
    summary: parts.filter((part) => part !== null).join(' · '),
    label: failures > 0 ? `실패 ${failures}` : '성공',
  };
}
