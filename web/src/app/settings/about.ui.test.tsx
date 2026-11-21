import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockViewport, renderApp } from '../../test/renderApp.tsx';
import { sourceUrl } from '../layout/appVersion.ts';

beforeEach(() => {
  localStorage.clear();
  mockViewport('desktop');
});

describe('About PeckList: the source offer the AGPL asks for', () => {
  it('has the version, the source of this build, the license and the changelog', async () => {
    await renderApp('/settings/about');
    const about = await screen.findByRole('region', { name: 'About PeckList' });
    expect(about).toHaveTextContent('GNU AGPL-3.0-or-later');
    expect(within(about).getByText('Web app version')).toBeInTheDocument();
    const source = within(about).getByRole('link', { name: /Source code/ });
    expect(source).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/gitlab\.com\/killswitch10\/pecklist/),
    );
    expect(source).toHaveAttribute('target', '_blank');
    expect(within(about).getByRole('link', { name: /License/ })).toHaveAttribute(
      'href',
      'https://gitlab.com/killswitch10/pecklist/-/blob/main/LICENSE',
    );
    expect(within(about).getByRole('link', { name: /What's new/ })).toHaveAttribute(
      'href',
      'https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md',
    );
  });

  it('is a subject of its own, just before Support', async () => {
    await renderApp('/settings');
    const list = await screen.findByRole('navigation', { name: 'Settings' });
    const subjects = within(list)
      .getAllByRole('link')
      .map((link) => link.textContent ?? '');
    const about = subjects.findIndex((text) => text.includes('About PeckList'));
    expect(about).toBeGreaterThan(-1);
    expect(subjects.slice(about + 1).every((text) => text.includes('Support PeckList'))).toBe(true);
  });

  it("links a build's own commit, and the repository when none was stamped", () => {
    expect(sourceUrl('646c6cb')).toBe('https://gitlab.com/killswitch10/pecklist/-/tree/646c6cb');
    expect(sourceUrl('')).toBe('https://gitlab.com/killswitch10/pecklist');
    expect(sourceUrl('not-a-sha')).toBe('https://gitlab.com/killswitch10/pecklist');
    // A modified build's own source wins.
    expect(sourceUrl('646c6cb', 'https://example.com/my-fork')).toBe('https://example.com/my-fork');
  });
});
