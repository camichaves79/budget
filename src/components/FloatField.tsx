import type { ReactNode } from 'react';

/**
 * Input box with the label INSIDE the box: centered like a placeholder when
 * empty, shrinking to a small top label once the field has focus or a value.
 * Saves the separate label row above each field.
 */
export function FloatField({
  id,
  label,
  floated,
  prefix,
  children,
}: {
  id: string;
  label: string;
  floated: boolean;
  prefix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={floated ? 'float-box floated' : 'float-box'}>
      <label className="float-label" htmlFor={id}>
        {label}
      </label>
      {prefix && <span className="float-prefix">{prefix}</span>}
      {children}
    </div>
  );
}
