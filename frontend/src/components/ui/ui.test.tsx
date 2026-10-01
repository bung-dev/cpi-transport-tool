import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';
import { Card } from './Card';
import { Checkbox } from './Checkbox';
import { Table, Td, Th, Tr } from './Table';
import { Tabs } from './Tabs';
import { TextInput } from './TextInput';

describe('공통 컴포넌트 클래스', () => {
  it('REQ-003 AC-3: 주 버튼은 primary 배경, on-primary 글자, 모서리 md, padding 10px 18px', () => {
    render(<Button variant="primary">실행</Button>);
    const cls = screen.getByRole('button', { name: '실행' }).className;
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-on-primary');
    expect(cls).toContain('rounded-md');
    expect(cls).toContain('px-[18px]');
    expect(cls).toContain('py-[10px]');
    expect(cls).toContain('active:bg-primary-pressed');
  });

  it('REQ-003 AC-3: 보조 버튼은 투명 배경과 1px hairline-strong 테두리', () => {
    render(<Button>취소</Button>);
    const cls = screen.getByRole('button', { name: '취소' }).className;
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('border-hairline-strong');
    expect(cls).not.toContain('bg-primary');
  });

  it('REQ-003 AC-3: 텍스트 입력은 높이 44px(h-11), 모서리 md, 포커스 시 primary 테두리, label 연결', () => {
    render(<TextInput label="패키지 검색" />);
    const input = screen.getByLabelText('패키지 검색');
    expect(input.className).toContain('h-11');
    expect(input.className).toContain('rounded-md');
    expect(input.className).toContain('focus:border-primary');
  });

  it('REQ-003 AC-3: 카드는 canvas 배경, hairline 테두리, 모서리 lg', () => {
    render(<Card data-testid="c">x</Card>);
    const cls = screen.getByTestId('c').className;
    expect(cls).toContain('bg-canvas');
    expect(cls).toContain('border-hairline');
    expect(cls).toContain('rounded-lg');
  });

  it('REQ-003 AC-3: 표는 hairline 테두리, 행 구분선, 가로 스크롤 래퍼', () => {
    render(
      <Table>
        <tbody>
          <Tr data-testid="r">
            <Th>h</Th>
            <Td>d</Td>
          </Tr>
        </tbody>
      </Table>,
    );
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(table.parentElement?.className).toContain('border-hairline');
    expect(screen.getByTestId('r').className).toContain('border-hairline');
  });

  it('REQ-009 AC-1: 체크박스는 label과 연결된다', async () => {
    render(<Checkbox label="드라이런" />);
    await userEvent.click(screen.getByLabelText('드라이런'));
    expect(screen.getByLabelText('드라이런')).toBeChecked();
  });

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
