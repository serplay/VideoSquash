import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders VideoSquash title', () => {
    render(<App />);
    expect(screen.getByText(/VideoSquash/i)).toBeInTheDocument();
  });

  it('shows error when non-video file is selected', () => {
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]');
    
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    
    expect(screen.getByText(/Please upload a valid video file/i)).toBeInTheDocument();
  });

  it('accepts video file and shows its name', () => {
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]');
    
    const file = new File(['(⌐□_□)'], 'test.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', {
      value: [file]
    });
    fireEvent.change(input);
    
    expect(screen.getByText(/Selected: test.mp4/i)).toBeInTheDocument();
  });
});
