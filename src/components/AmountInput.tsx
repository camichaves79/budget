import { formatCOP, parseAmountToCents } from '../lib/money';

export function AmountInput({
  value,
  onChange,
  placeholder = '0',
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="amount-input">
      <span className="amount-prefix">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Amount"
      />
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
