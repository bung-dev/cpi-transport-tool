import { flushSync } from 'react-dom';

// S2 keeps the existing transport form. Commands use its enabled controls so
// validation, the confirmation dialog and request deduplication stay in RunPanel.
const mode = (value: string) => document.querySelector<HTMLInputElement>(`main input[name="runMode"][value="${value}"]`);
function runButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('main button')).find(b => b.textContent === '미리보기 실행' || b.textContent?.endsWith('로 이관'));
}
export function transportCommandReason() {
  if (!document.querySelector('main input[name="package"]:checked')) return '패키지를 먼저 선택하세요';
  if (runButton()?.disabled !== false) return '경로, 아티팩트 선택과 실행 상태를 확인하세요';
  return undefined;
}
export function runTransportCommand(real: boolean) {
  if (transportCommandReason()) return false;
  const radio = mode(real ? 'real' : 'dryRun');
  if (!radio || radio.disabled) return false;
  flushSync(() => radio.click());
  if (real) {
    const deploy = document.querySelector<HTMLInputElement>('main input[role="switch"]:checked');
    if (deploy) flushSync(() => deploy.click());
  }
  runButton()?.click();
  return true;
}
