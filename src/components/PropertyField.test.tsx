import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, TextField } from './PropertyField';

describe('NumberField', () => {
  it('does not turn an empty draft into zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<NumberField label="Width" value={20} onChange={onChange} onBlur={onBlur} min={1} />);

    const input = screen.getByRole('spinbutton', { name: 'Width' });
    await user.clear(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
    expect(input).toHaveValue(20);
  });

  it('commits a finite in-range value on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<NumberField label="Scale" value={1} onChange={onChange} onBlur={onBlur} min={0.1} max={10} />);

    const input = screen.getByRole('spinbutton', { name: 'Scale' });
    await user.clear(input);
    await user.type(input, '2.5{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2.5);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe('TextField', () => {
  const validDash = (value: string) => value.trim() === '' || value.split(',').every((part) => {
    const number = Number(part.trim());
    return part.trim() !== '' && Number.isFinite(number) && number >= 0;
  });

  it('rolls back without committing on Escape', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<TextField label="Dash" value="2,2" onCommit={onCommit} validate={validDash} />);

    const input = screen.getByRole('textbox', { name: 'Dash' });
    await user.clear(input);
    await user.type(input, '5,10{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('2,2');
  });

  it('rolls an invalid draft back on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<TextField label="Dash" value="2,2" onCommit={onCommit} validate={validDash} />);

    const input = screen.getByRole('textbox', { name: 'Dash' });
    await user.clear(input);
    await user.type(input, '5,bad');
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('2,2');
  });

  it('commits a valid draft once on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<TextField label="Dash" value="2,2" onCommit={onCommit} validate={validDash} />);

    const input = screen.getByRole('textbox', { name: 'Dash' });
    await user.clear(input);
    await user.type(input, '5,10{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('5,10');
  });
});
