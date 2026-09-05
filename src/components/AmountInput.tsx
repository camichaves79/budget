import { useState } from 'react';
import { formatCOP, parseAmountToCents } from '../lib/money';
import { FloatField } from './FloatField';

export function AmountInput({
  value,
  onChange,
  placeholder = '0',
  autoFocus,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** When given, the label lives inside the box (floating-label variant). */
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const floated = value !== '' || focused;

  const input = (
    <input
      className={label ? 'float-amount' : undefined}
      type="text"
      inputMode="decimal"
      value={value}
      placeholder={floated ? placeholder : undefined}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={label ?? 'Amount'}
    />
  );

  if (label) {
    return (
      <FloatField
        id="amount-field"
        label={label}
        floated={floated}
        // No prefix while empty: the centered label occupies the box alone.
        prefix={floated ? '$' : undefined}
      >
        {input}
      </FloatField>
    );
  }

  return (
    <div className="amount-input">
      <span className="amount-prefix">$</span>
      {input}
    </div>
  );
}

/** Human hint for the current raw input, or null when empty. */
export function amountHint(value: string): { text: string; error: boolean } | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const cents = parseAmountToCents(trimmed);
  if (cents === null) return { text: 'Not a valid amount', error: true };
  if (cents <= 0) return { text: 'Amount must be greater than zero', error: true };
  return { text: `= ${formatCOP(cents)}`, error: false };
}
