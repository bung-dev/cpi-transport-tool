import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';
import { Callout } from './Callout';
import { Card } from './Card';
import { Checkbox, CheckboxControl } from './Checkbox';
import { EmptyState } from './EmptyState';
import { AlertCircleIcon, ArrowLeftIcon, BrandIcon, ChevronDownIcon, InboxIcon, InfoIcon, RefreshIcon, SearchIcon, WarningIcon } from './icons';
import { Radio, RadioControl } from './Radio';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { Switch, SwitchControl } from './Switch';
import { Table, Td, Th, Tr } from './Table';
import { Tabs } from './Tabs';
import { TextInput } from './TextInput';

describe('Button', () => {
  it('REQ-103 AC-1: primary는 primary 배경·on-primary 글자, hover primary-hover, 누름 primary-pressed, 반경 md, 높이 36px, 14px·500', () => {
    render(<Button variant="primary">실행</Button>);
    const cls = screen.getByRole('button', { name: '실행' }).className;
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-on-primary');
    expect(cls).toContain('enabled:hover:bg-primary-hover');
    expect(cls).toContain('enabled:active:bg-primary-pressed');
    expect(cls).toContain('rounded-md');
    expect(cls).toContain('h-9');
    expect(cls).toContain('text-sm');
    expect(cls).toContain('font-medium');
  });

  it('REQ-103 AC-1: secondary는 canvas 배경·1px hairline-strong 테두리, hover surface-hover', () => {
    render(<Button>취소</Button>);
    const cls = screen.getByRole('button', { name: '취소' }).className;
    expect(cls).toContain('bg-canvas');
    expect(cls).toContain('border border-hairline-strong');
    expect(cls).toContain('enabled:hover:bg-surface-hover');
    expect(cls).not.toContain('bg-primary');
  });

  it('REQ-103 AC-1: ghost는 투명 배경, hover surface-hover', () => {
    render(<Button variant="ghost">목록으로</Button>);
    const cls = screen.getByRole('button', { name: '목록으로' }).className;
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('enabled:hover:bg-surface-hover');
    expect(cls).not.toContain('border-hairline-strong');
  });

  it('REQ-103 AC-1: sm 크기는 높이 28px·반경 sm·13px', () => {
    render(<Button size="sm">전체 선택</Button>);
    const cls = screen.getByRole('button', { name: '전체 선택' }).className;
    expect(cls).toContain('h-7');
    expect(cls).toContain('rounded-sm');
    expect(cls).toContain('text-[13px]');
    expect(cls).not.toContain('h-9');
  });

  it('REQ-103 AC-1: 비활성은 not-allowed·ink-disabled이고 변형별 배경을 쓰며 hover 변화는 enabled에만 걸린다', () => {
    render(
      <>
        <Button variant="primary" disabled>
          주</Button>
        <Button variant="secondary" disabled>
          보조</Button>
        <Button variant="ghost" disabled>
          투명</Button>
      </>,
    );
    for (const name of ['주', '보조', '투명']) {
      const b = screen.getByRole('button', { name });
      expect(b).toBeDisabled();
      expect(b.className).toContain('disabled:cursor-not-allowed');
      expect(b.className).toContain('disabled:text-ink-disabled');
      expect(b.className).not.toMatch(/(^|\s)hover:/);
    }
    expect(screen.getByRole('button', { name: '주' }).className).toContain('disabled:bg-surface-hover');
    const secondary = screen.getByRole('button', { name: '보조' }).className;
    expect(secondary).toContain('disabled:bg-canvas');
    expect(secondary).toContain('disabled:border-hairline');
  });

  it('REQ-103 AC-1: loading이면 스피너가 보이고 aria-busy="true"이며 클릭할 수 없다', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        이관
      </Button>,
    );
    const b = screen.getByRole('button', { name: '이관' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toBeDisabled();
    expect(container.querySelector('svg[data-spinner]')).not.toBeNull();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('REQ-103 AC-1: loading이 아니면 스피너와 aria-busy가 없고 전체 폭 옵션이 있다', () => {
    const { container } = render(
      <Button variant="primary" fullWidth>
        실행
      </Button>,
    );
    const b = screen.getByRole('button', { name: '실행' });
    expect(b).not.toHaveAttribute('aria-busy');
    expect(container.querySelector('svg')).toBeNull();
    expect(b.className).toContain('w-full');
  });
});

describe('Checkbox, Radio, Switch', () => {
  it('REQ-009 AC-1: 체크박스는 label과 연결된다', async () => {
    render(<Checkbox label="드라이런" />);
    await userEvent.click(screen.getByLabelText('드라이런'));
    expect(screen.getByLabelText('드라이런')).toBeChecked();
  });

  it('REQ-103 AC-2: Checkbox는 네이티브 checkbox, 16px·control-border 테두리·선택 시 primary 채움, Space로 조작된다', async () => {
    render(<Checkbox label="약관" />);
    const box = screen.getByRole('checkbox', { name: '약관' });
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(box.className).toContain('h-4');
    expect(box.className).toContain('w-4');
    expect(box.className).toContain('border-control-border');
    expect(box.className).toContain('checked:bg-primary');
    expect(box.className).toContain('after:border-on-primary');
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
  });

  it('REQ-103 AC-2: Radio는 네이티브 radio, 16px·control-border 테두리·선택 시 primary 채움과 on-primary 점, 같은 name은 한 그룹', async () => {
    render(
      <>
        <Radio name="mode" label="드라이런" defaultChecked />
        <Radio name="mode" label="실제 이관" />
      </>,
    );
    const a = screen.getByRole('radio', { name: '드라이런' });
    const b = screen.getByRole('radio', { name: '실제 이관' });
    expect(a).toHaveAttribute('type', 'radio');
    expect(a.className).toContain('rounded-full');
    expect(a.className).toContain('border-control-border');
    expect(a.className).toContain('checked:bg-primary');
    expect(a.className).toContain('after:bg-on-primary');
    await userEvent.click(b);
    expect(b).toBeChecked();
    expect(a).not.toBeChecked();
  });

  it('REQ-103 AC-2: Switch는 role="switch"인 네이티브 checkbox, 트랙 36×20px·꺼짐 control-border·켜짐 primary, label·Space 조작', async () => {
    render(<Switch label="배포" description="이관 후 PRD에 배포합니다" />);
    const sw = screen.getByRole('switch', { name: '배포' });
    expect(sw.tagName).toBe('INPUT');
    expect(sw).toHaveAttribute('type', 'checkbox');
    expect(sw.className).toContain('h-5');
    expect(sw.className).toContain('w-9');
    expect(sw.className).toContain('bg-control-border');
    expect(sw.className).toContain('checked:bg-primary');
    expect(sw).toHaveAccessibleDescription('이관 후 PRD에 배포합니다');
    expect(sw).not.toBeChecked();
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByText('배포'));
    expect(sw).not.toBeChecked();
  });

  it('REQ-103 AC-2: 컨트롤만 따로 쓰면 행 전체 label이 컨트롤을 조작한다', async () => {
    render(
      <>
        <label>
          <CheckboxControl />
          <span>체크 행</span>
        </label>
        <label>
          <RadioControl name="r" />
          <span>라디오 행</span>
        </label>
        <label>
          <SwitchControl />
          <span>스위치 행</span>
        </label>
      </>,
    );
    await userEvent.click(screen.getByText('체크 행'));
    await userEvent.click(screen.getByText('라디오 행'));
    await userEvent.click(screen.getByText('스위치 행'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('radio')).toBeChecked();
    expect(screen.getByRole('switch')).toBeChecked();
  });
});

describe('TextInput', () => {
  it('REQ-103 AC-3: 높이 40px, 반경 md, 1px control-border, 포커스에서 primary 테두리와 primary-soft 3px 링, placeholder ink-tertiary, label 연결', () => {
    render(<TextInput label="패키지 검색" placeholder="이름 또는 ID로 검색" />);
    const input = screen.getByLabelText('패키지 검색');
    expect(input.className).toContain('h-10');
    expect(input.className).toContain('rounded-md');
    expect(input.className).toContain('border-control-border');
    expect(input.className).toContain('focus:border-primary');
    expect(input.className).toContain('focus:ring-3');
    expect(input.className).toContain('focus:ring-primary-soft');
    expect(input.className).toContain('placeholder:text-ink-tertiary');
    expect(screen.getByPlaceholderText('이름 또는 ID로 검색')).toBe(input);
  });

  it('REQ-103 AC-3: 앞쪽 아이콘 자리가 있고 보이지 않는 label 옵션도 label로 연결된다', () => {
    const { container } = render(<TextInput label="검색" hideLabel icon={<SearchIcon />} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('검색').className).toContain('sr-only');
    expect(screen.getByLabelText('검색').className).toContain('pl-9');
  });
});

describe('Card', () => {
  it('REQ-103 AC-5: canvas 배경, 1px hairline 테두리, 반경 lg, shadow-xs, 안쪽 여백 20px(640px 미만 16px)', () => {
    render(<Card data-testid="c">x</Card>);
    const cls = screen.getByTestId('c').className;
    expect(cls).toContain('bg-canvas');
    expect(cls).toContain('border border-hairline');
    expect(cls).toContain('rounded-lg');
    expect(cls).toContain('shadow-xs');
    expect(cls).toContain('p-4');
    expect(cls).toContain('sm:p-5');
  });

  it('REQ-103 AC-5: 제목(기본 h3)과 오른쪽 동작 영역이 있는 머리를 지원한다', () => {
    render(
      <Card title="아티팩트" actions={<button type="button">전체 선택</button>}>
        본문
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: '아티팩트' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 선택' }).parentElement?.className).toContain('ml-auto');
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  it('REQ-103 AC-5: 제목도 동작도 없으면 머리를 그리지 않고 제목 수준을 고를 수 있다', () => {
    const { rerender } = render(<Card>본문만</Card>);
    expect(screen.queryByRole('heading')).toBeNull();
    rerender(
      <Card title="상세" titleAs="h4">
        본문
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 4, name: '상세' })).toBeInTheDocument();
  });
});

describe('Table', () => {
  it('REQ-103 AC-6: 반경 lg·hairline 테두리의 가로 스크롤 래퍼, 머리 칸 surface·12px·500·ink-tertiary, 행 구분선, 행 hover surface-hover, 숫자 칸 오른쪽 정렬', () => {
    render(
      <Table>
        <thead>
          <Tr>
            <Th>이름</Th>
            <Th numeric>횟수</Th>
          </Tr>
        </thead>
        <tbody>
          <Tr data-testid="r">
            <Td>a</Td>
            <Td numeric>3</Td>
          </Tr>
        </tbody>
      </Table>,
    );
    const wrapper = screen.getByRole('table').parentElement;
    expect(wrapper?.className).toContain('overflow-x-auto');
    expect(wrapper?.className).toContain('border border-hairline');
    expect(wrapper?.className).toContain('rounded-lg');
    const th = screen.getByRole('columnheader', { name: '이름' }).className;
    expect(th).toContain('bg-surface');
    expect(th).toContain('text-xs');
    expect(th).toContain('font-medium');
    expect(th).toContain('text-ink-tertiary');
    const tr = screen.getByTestId('r').className;
    expect(tr).toContain('border-t border-hairline');
    expect(tr).toContain('hover:bg-surface-hover');
    expect(screen.getByRole('columnheader', { name: '횟수' }).className).toContain('text-right');
    expect(screen.getByRole('cell', { name: '3' }).className).toContain('text-right');
  });
});

describe('Skeleton, Spinner, EmptyState, Callout, 아이콘', () => {
  it('REQ-103 AC-7: Skeleton은 자리 표시 블록이고 깜빡임 애니메이션이 있으며 스크린 리더에는 숨긴다', () => {
    const { container } = render(<Skeleton className="h-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('animate-pulse');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('REQ-103 AC-7: Spinner는 currentColor SVG이고 회전 애니메이션이 있다', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.getAttribute('class')).toContain('animate-spin');
  });

  it('REQ-103 AC-7: EmptyState는 아이콘 + 제목 + 선택적 설명을 가운데 정렬 ink-secondary로 보인다', () => {
    const { container, rerender } = render(<EmptyState title="패키지가 없습니다" />);
    expect(screen.getByText('패키지가 없습니다')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('text-center');
    expect((container.firstElementChild as HTMLElement).className).toContain('text-ink-secondary');
    expect(screen.queryByText('설명 문장')).toBeNull();
    rerender(<EmptyState title="이관 이력이 없습니다" description="설명 문장" />);
    expect(screen.getByText('설명 문장')).toBeInTheDocument();
  });

  it.each([
    ['danger', 'bg-danger-bg', 'text-danger-fg'],
    ['warning', 'bg-warning-bg', 'text-warning-fg'],
    ['info', 'bg-info-bg', 'text-info-fg'],
  ] as const)('REQ-103 AC-7: Callout %s는 색조 클래스, 아이콘, 굵기 600 제목, 본문을 보인다', (tone, bg, fg) => {
    const { container } = render(
      <Callout tone={tone} title="제목" data-testid="co">
        본문 글자
      </Callout>,
    );
    const el = screen.getByTestId('co');
    expect(el.className).toContain(bg);
    expect(el.className).toContain(fg);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('제목').className).toContain('font-semibold');
    expect(screen.getByText('본문 글자')).toBeInTheDocument();
  });

  it('REQ-103 AC-7: 아이콘은 frontend/src 안의 인라인 SVG이고 currentColor·aria-hidden이다', () => {
    const icons = [BrandIcon, SearchIcon, RefreshIcon, ArrowLeftIcon, AlertCircleIcon, WarningIcon, InfoIcon, InboxIcon, ChevronDownIcon];
    for (const Icon of icons) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, Icon.name).not.toBeNull();
      expect(svg).toHaveAttribute('stroke', 'currentColor');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('img')).toBeNull();
      unmount();
    }
  });
});

describe('글자 크기·전환·포커스 클래스', () => {
  it('REQ-101 AC-4: 카드 제목 16px·600, 표 머리 12px·500, 보조 설명 12px, 숫자 칸 tabular-nums', () => {
    render(
      <>
        <Card title="실행" meta="보조">
          x
        </Card>
        <Table>
          <thead>
            <Tr>
              <Th numeric>횟수</Th>
            </Tr>
          </thead>
          <tbody>
            <Tr>
              <Td numeric>1</Td>
              <Td>b</Td>
            </Tr>
          </tbody>
        </Table>
      </>,
    );
    const title = screen.getByRole('heading', { name: '실행' }).className;
    expect(title).toContain('text-base');
    expect(title).toContain('font-semibold');
    expect(screen.getByText('보조').className).toContain('text-xs');
    expect(screen.getByRole('columnheader').className).toContain('text-xs');
    expect(screen.getByRole('cell', { name: '1' }).className).toContain('tabular-nums');
    expect(screen.getByRole('cell', { name: 'b' }).className).not.toContain('tabular-nums');
  });

  it('REQ-101 AC-6: 버튼·입력·체크박스·라디오·스위치·표 행의 색·배경·그림자 변화에 150ms 전환이 있다', () => {
    render(
      <>
        <Button>버튼</Button>
        <TextInput label="입력" />
        <Checkbox label="체크" />
        <Radio label="라디오" name="n" />
        <Switch label="스위치" />
        <Table>
          <tbody>
            <Tr data-testid="row">
              <Td>x</Td>
            </Tr>
          </tbody>
        </Table>
      </>,
    );
    const targets = [
      screen.getByRole('button', { name: '버튼' }),
      screen.getByLabelText('입력'),
      screen.getByRole('checkbox', { name: '체크' }),
      screen.getByRole('radio', { name: '라디오' }),
      screen.getByRole('switch', { name: '스위치' }),
      screen.getByTestId('row'),
    ];
    for (const el of targets) {
      expect(el.className, el.outerHTML.slice(0, 60)).toMatch(/(^|\s)transition(-colors)?(\s|$)/);
      expect(el.className).toContain('duration-150');
    }
    expect(screen.getByRole('switch').className).toContain('after:transition-transform');
    expect(screen.getByRole('switch').className).toContain('after:duration-150');
  });

  it('REQ-101 AC-7: 공통 컨트롤은 전역 포커스 외곽선을 지우지 않는다', () => {
    render(
      <>
        <Button variant="primary">b</Button>
        <TextInput label="입력" />
        <Checkbox label="체크" />
        <Radio label="라디오" name="n" />
        <Switch label="스위치" />
      </>,
    );
    const controls = [
      screen.getByRole('button'),
      screen.getByLabelText('입력'),
      screen.getByRole('checkbox'),
      screen.getByRole('radio'),
      screen.getByRole('switch'),
    ];
    for (const el of controls) expect(el.className, el.outerHTML.slice(0, 60)).not.toMatch(/outline-(none|0|hidden)|focus:outline|focus-visible:outline-none/);
  });

  it('REQ-101 AC-7: 체크박스·라디오·스위치는 숨기지 않고 input 자체를 그린 모양이라 포커스 외곽선이 그 모양에 그려진다', () => {
    render(
      <>
        <Checkbox label="체크" />
        <Radio label="라디오" name="n" />
        <Switch label="스위치" />
      </>,
    );
    for (const el of [screen.getByRole('checkbox'), screen.getByRole('radio'), screen.getByRole('switch')]) {
      expect(el.className).toContain('appearance-none');
      expect(el.className).not.toMatch(/(^|\s)(sr-only|hidden|invisible|opacity-0)(\s|$)/);
    }
  });
});

describe('Tabs', () => {
  it('REQ-003 AC-3: 탭은 tablist/tab/aria-selected/tabpanel과 활성 탭 ink 밑줄, 화살표 키 이동', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: 'a', label: '이관' },
          { id: 'b', label: '이력' },
        ]}
        activeId="a"
        onChange={onChange}
      >
        내용
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const a = screen.getByRole('tab', { name: '이관' });
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'false');
    expect(a.className).toContain('border-ink');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('내용');
    a.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
