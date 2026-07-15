import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog';

describe('Dialog', () => {
  it('exposes dialog semantics, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const view = render(
      <Dialog title="Settings" onClose={onClose}>
        <button data-autofocus>Apply</button>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
