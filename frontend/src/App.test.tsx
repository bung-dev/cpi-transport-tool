import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import App from './App';

it('REQ-001 AC-2: App이 렌더링된다', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'CPI Transport Tool' })).toBeInTheDocument();
});
