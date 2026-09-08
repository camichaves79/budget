import { useState } from 'react';
import { parseAmountToCents } from '../lib/money';
import { t } from '../lib/i18n';
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
      aria-label={label ?? t('tx.amount')}
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

/** Problem hint for the current raw input, or null when the input is fine. */
export function amountHint(value: string): { text: string; error: boolean } | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const cents = parseAmountToCents(trimmed);
  if (cents === null) return { text: t('tx.amountBad'), error: true };
  if (cents <= 0) return { text: t('tx.amountZero'), error: true };
  // Valid amounts get NO echo under the box — the typed value is already
  // visible in it (2026-09 user direction).
  return null;
}
