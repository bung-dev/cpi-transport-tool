import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACKAGES, json, mockApi } from './test/mockFetch';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    mockApi({ 'GET /packages': () => json(PACKAGES), 'GET /transport/history': () => json([]) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('REQ-001 AC-2: App이 렌더링된다', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'CPI Transport Tool' })).toBeInTheDocument();
  });

  it('REQ-009 AC-1: 탭은 tablist/tab/aria-selected를 쓰고 기본은 이관', () => {
    render(<App />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['이관', '이력']);
    expect(screen.getByRole('tab', { name: '이관' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'false');
  });

  it('REQ-009 AC-1: 탭을 누르면 패널이 전환되고 이전 패널은 언마운트된다', async () => {
    render(<App />);
    expect(await screen.findByLabelText('패키지 검색')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('이력 탭')).toBeInTheDocument();
    expect(screen.queryByLabelText('패키지 검색')).toBeNull();
  });

  it('REQ-009 AC-3: 본문은 max-w 가운데 정렬, min-w-0, 좌우 padding 16px 이상', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-[1120px]');
    expect(main.className).toContain('mx-auto');
    expect(main.className).toContain('min-w-0');
    expect(main.className).toContain('px-4');
  });
});
