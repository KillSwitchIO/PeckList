import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { CommentBody } from '../tasks/Comments.tsx';

let opened: string[];

beforeEach(() => {
  opened = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    opened.push(this.href);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('smart links in comments (PL-146)', () => {
  it('shows a number in a comment as a button that offers call, text and copy', async () => {
    renderThemed(
      <CommentBody body={'Call **me** at +44 20 7946 0958, or see https://example.com'} />,
    );
    const number = screen.getByRole('button', { name: '+44 20 7946 0958' });
    // Web addresses stay the comment's own links.
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument();
    await userEvent.click(number);
    await screen.findByRole('menu', { name: '+44 20 7946 0958' });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Call' }));
    expect(opened).toEqual(['tel:+442079460958']);
  });

  it('leaves a comment without any as plain text', () => {
    renderThemed(<CommentBody body="Order 5155550123 shipped on 2026-11-17" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Order 5155550123 shipped on 2026-11-17')).toBeInTheDocument();
  });
});
