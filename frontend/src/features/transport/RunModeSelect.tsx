import { useId } from 'react';
import { RadioControl } from '../../components/ui/Radio';
import { useReadOnlyState } from '../tenants/TenantContext';

export type RunMode = 'dryRun' | 'real';

interface Option {
  mode: RunMode;
  title: string;
  description: string;
}

const options = (targetName: string): Option[] => [
  { mode: 'dryRun', title: '미리보기', description: `${targetName}에 요청을 보내지 않고 변경 내용만 확인합니다` },
  { mode: 'real', title: '실제 이관', description: `${targetName}에 업로드합니다` },
];

// 선택지 상자: 1px hairline-strong 테두리, 선택된 쪽은 primary 테두리와 primary-soft 배경(REQ-104 AC-5).
// 색 변화에 150ms 전환(REQ-101 AC-6). 클래스는 완성된 문자열로 적는다(ADR-010).
const BOX_BASE =
  'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors duration-150';
const BOX_ON = 'border-primary bg-primary-soft';
const BOX_OFF = 'border-hairline-strong bg-canvas hover:bg-surface-hover';

interface Props {
  targetName?: string;
  mode: RunMode;
  onChange: (mode: RunMode) => void;
}

export function RunModeSelect({ mode, onChange, targetName = 'PRD' }: Props) {
  const { realDisabled, notice } = useReadOnlyState();
  const selectedMode = realDisabled ? 'dryRun' : mode;
  const base = useId();
  const noticeId = `${base}-read-only`;
  const groupId = `${base}-group`;
  return (
    <div className="min-w-0">
      <p id={groupId} className="mb-1.5 text-xs font-medium text-ink-tertiary">
        실행 모드
      </p>
      {/* AI-NOTE: 같은 name의 네이티브 radio라 화살표 키 이동은 브라우저가 처리한다. 선택지 상자 전체를 label로 감싸 어디를 눌러도 선택되고, 접근 가능한 이름은 제목(aria-labelledby)만, 설명은 aria-describedby로 분리한다 (근거: REQ-104 AC-5, wiki/decisions/ADR-012) */}
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
        {options(targetName).map((o) => {
          const titleId = `${base}-${o.mode}-title`;
          const descId = `${base}-${o.mode}-desc`;
          return (
            <label key={o.mode} className={`${BOX_BASE} ${selectedMode === o.mode ? BOX_ON : BOX_OFF}`}>
              <RadioControl
                name="runMode"
                value={o.mode}
                className="mt-0.5"
                checked={selectedMode === o.mode}
                disabled={o.mode === 'real' && realDisabled}
                onChange={() => { if (o.mode === 'dryRun' || !realDisabled) onChange(o.mode); }}
                aria-labelledby={titleId}
                aria-describedby={`${descId}${o.mode === 'real' && notice ? ` ${noticeId}` : ''}`}
              />
              <span className="min-w-0">
                <span id={titleId} className="block font-medium">
                  {o.title}
                </span>
                <span id={descId} className="mt-0.5 block text-xs text-ink-tertiary">
                  {o.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {notice && <p id={noticeId} className="mt-1.5 text-sm text-ink-secondary">{notice}</p>}
    </div>
  );
}
