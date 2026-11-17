import { screen, within } from '@testing-library/react';
import userEvent from './userEvent';
import type { mockApi } from './mockFetch';

// S3b(REQ-420~423) 공용: 새 이관 마법사의 접근 가능한 구조.
// - 단계 줄: <nav aria-label="이관 단계"> 안의 버튼 5개(DOM 순서 = STEP_LABELS). 현재 단계는 aria-current="step".
// - 경로 줄: role=group "이관 경로"(글자 "<원본 이름> → <대상 이름>", 버튼 "경로 변경").
// - 아티팩트 표: role=grid "이관할 아티팩트", 머리 행 없이 아티팩트마다 row 하나(aria-selected).
export const STEP_LABELS = ['템플릿', '패키지', '아티팩트', '미리보기', '실제 이관'] as const;
export type StepLabel = (typeof STEP_LABELS)[number];

export const stepNav = () => screen.getByRole('navigation', { name: '이관 단계' });
export const stepButtons = () => within(stepNav()).getAllByRole('button');
export const stepButton = (label: StepLabel) => stepButtons()[STEP_LABELS.indexOf(label)];
export function currentStep(): StepLabel | null {
  const i = stepButtons().findIndex((b) => b.getAttribute('aria-current') === 'step');
  return i < 0 ? null : STEP_LABELS[i];
}
export const routeBar = () => screen.getByRole('group', { name: '이관 경로' });
export const artifactGrid = () => screen.getByRole('grid', { name: '이관할 아티팩트' });
export const findArtifactGrid = () => screen.findByRole('grid', { name: '이관할 아티팩트' });
export const artifactRows = () => within(artifactGrid()).getAllByRole('row');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const artifactRow = (id: string) => within(artifactGrid()).getByRole('row', { name: new RegExp(`(^|\\s)${escape(id)}(\\s|$)`) });
export const selectedIds = () => artifactRows().filter((r) => r.getAttribute('aria-selected') === 'true');

/** 첫 단계에서 "템플릿 없이 진행"을 누른다. */
export async function startManual() {
  await userEvent.click(await screen.findByRole('button', { name: '템플릿 없이 진행' }));
}
/** 템플릿 없이 진행 → 패키지 선택 → "다음"으로 아티팩트 단계까지 간다. */
export async function toArtifacts(pkg: RegExp = /Transport Demo/) {
  await startManual();
  await userEvent.click(await screen.findByRole('radio', { name: pkg }));
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  return findArtifactGrid();
}

export const postBodies = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls
    .filter(([url, init]) => init?.method === 'POST' && url === '/transport')
    .map(([, init]) => JSON.parse(init?.body as string));
