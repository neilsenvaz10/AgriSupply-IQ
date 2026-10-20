import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

const OPTIONS = [
  { value: 'a', label: 'Apple', description: 'Mandi-level: 10 observations' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Pineapple', description: 'State-level only' },
  { value: 'd', label: 'Potato' },
];

/**
 * Controlled wrapper so selection round-trips like it does in the pages.
 *
 * @param {{ onChange?: (value: string) => void, initial?: string, [key: string]: any }} props
 */
function Harness({ onChange = () => undefined, initial = '', ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchableSelect
      label="Commodity"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      {...rest}
    />
  );
}

const box = () => screen.getByRole('combobox', { name: 'Commodity' });
const names = () =>
  screen.queryAllByRole('option').map((o) => o.querySelector('span')?.textContent);

describe('SearchableSelect', () => {
  it('is a labelled combobox that starts closed, with a polite status region', () => {
    render(<Harness />);
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('opens on focus and lists every option with its coverage description', () => {
    render(<Harness />);
    fireEvent.focus(box());
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(names()).toEqual(['Apple', 'Banana', 'Pineapple', 'Potato']);
    expect(screen.getByRole('option', { name: /Apple/ })).toHaveTextContent(
      'Mandi-level: 10 observations',
    );
    expect(screen.getByRole('listbox')).toHaveAccessibleName('Commodity options');
  });

  it('filters by name as the user types, case-insensitively, putting prefix matches first', () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: 'PO' } });
    expect(names()).toEqual(['Potato']);
    fireEvent.change(box(), { target: { value: 'apple' } });
    expect(names()).toEqual(['Apple', 'Pineapple']);
    expect(screen.getByRole('status')).toHaveTextContent('2 matches');
  });

  it('says so explicitly when nothing matches, and offers the empty-result message', () => {
    render(<Harness emptyMessage="No commodity matches this search." />);
    fireEvent.change(box(), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('note')).toHaveTextContent('No commodity matches this search.');
    expect(screen.getByRole('status')).toHaveTextContent('No commodity matches this search.');
  });

  it('selects an option with the mouse and shows its label in the box', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(box(), { target: { value: 'ban' } });
    fireEvent.click(screen.getByRole('option', { name: /Banana/ }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(box()).toHaveValue('Banana');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports the keyboard: arrows, Home, End and Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    const active = () => document.getElementById(box().getAttribute('aria-activedescendant') ?? '');
    expect(active()).toHaveTextContent('Apple');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(active()).toHaveTextContent('Pineapple');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(active()).toHaveTextContent('Banana');
    fireEvent.keyDown(box(), { key: 'End' });
    expect(active()).toHaveTextContent('Potato');
    fireEvent.keyDown(box(), { key: 'ArrowDown' }); // stays on the last option
    expect(active()).toHaveTextContent('Potato');
    fireEvent.keyDown(box(), { key: 'Home' });
    expect(active()).toHaveTextContent('Apple');
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('d');
    expect(box()).toHaveValue('Potato');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks the highlighted and the selected option for assistive technology', () => {
    render(<Harness initial="c" />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Pineapple/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /^Apple/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('Escape closes the list; a second Escape clears typed text but keeps the selection', () => {
    render(<Harness initial="a" />);
    fireEvent.change(box(), { target: { value: 'pot' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: 'Escape' }); // clears the typed text first
    expect(box()).toHaveValue('Apple');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box()).toHaveValue('Apple');
  });

  it('has a Clear button that removes the selection, and none when nothing is selected', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="b" />);
    expect(box()).toHaveValue('Banana');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Commodity' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(box()).toHaveValue('');
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('limits what it renders and says that more matches exist', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      value: `v${i}`,
      label: `Crop ${String(i).padStart(3, '0')}`,
    }));
    render(
      <SearchableSelect
        label="Commodity"
        options={many}
        onChange={() => undefined}
        maxOptions={50}
      />,
    );
    fireEvent.focus(box());
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByRole('status')).toHaveTextContent('120 matches, showing the first 50');
    fireEvent.change(box(), { target: { value: 'Crop 11' } });
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(10);
  });

  it('is inert when disabled and explains why', () => {
    render(<Harness disabled disabledNote="Loading the catalogue…" />);
    expect(box()).toBeDisabled();
    fireEvent.focus(box());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('Loading the catalogue…')).toBeVisible();
  });

  it('closes when focus leaves the control', () => {
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.focus(box());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.blur(box(), { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps focus inside the control while an option is pressed (the list does not vanish first)', () => {
    render(<Harness />);
    fireEvent.focus(box());
    const option = within(screen.getByRole('listbox')).getByRole('option', { name: /Banana/ });
    const allowed = fireEvent.mouseDown(option);
    expect(allowed).toBe(false); // default prevented, so the input does not lose focus
  });
});
