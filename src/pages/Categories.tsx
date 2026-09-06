import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Category, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { Sheet } from '../components/Sheet';
import { ConfirmDialog } from '../components/ConfirmDialog';

/**
 * Categories tab (2026-09 redesign): category management moved out of
 * Settings into its own first-class tab — add / rename / delete the expense
 * and income categories smart entry and budgets use. Pinned-header layout,
 * matching Cash Flow and Budgets.
 */
export function Categories() {
  const { data, dispatch } = useStore();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const expenseCats = data.categories.filter((c) => c.kind === 'expense');
  const incomeCats = data.categories.filter((c) => c.kind === 'income');

  const fallbackFor = (cat: Category): Category | undefined =>
    data.categories.find((c) => c.kind === cat.kind && c.id !== cat.id && !c.archived);

  return (
    <div className="pinned-page">
      <div className="pinned-head">
        <h2 className="section-title page-label">Categories</h2>
      </div>

      <div className="pinned-scroll">
        <div className="card">
          <CategoryGroup
            title="Expenses"
            cats={expenseCats}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
          />
          <CategoryGroup
            title="Income"
            cats={incomeCats}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
          />
          <button type="button" className="btn btn-block" onClick={() => setAdding(true)}>
            + Add category
          </button>
        </div>
      </div>

      <Sheet className="sheet-tight" open={adding} onClose={() => setAdding(false)} title="New category">
        <CategoryForm
          onClose={() => setAdding(false)}
          onSave={(cat) => {
            dispatch({ type: 'addCategory', cat: { ...cat, archived: false } });
            setAdding(false);
          }}
        />
      </Sheet>

      <Sheet className="sheet-tight" open={editing !== null} onClose={() => setEditing(null)} title="Edit category">
        {editing && (
          <CategoryForm
            initial={editing}
            onClose={() => setEditing(null)}
            onSave={(patch) => {
              dispatch({ type: 'updateCategory', id: editing.id, patch });
              setEditing(null);
            }}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete category?"
        message={
          deleting && fallbackFor(deleting)
            ? `Transactions in “${deleting.name}” will be moved to “${fallbackFor(deleting)?.name}”. Its budget (if any) is removed.`
            : 'This category will be removed.'
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) dispatch({ type: 'deleteCategory', id: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}

function CategoryGroup({
  title,
  cats,
  onEdit,
  onDelete,
}: {
  title: string;
  cats: Category[];
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  if (cats.length === 0) return null;
  return (
    <>
      <h3 className="section-title">{title}</h3>
      {cats.map((c) => (
        <div key={c.id} className="cat-row">
          <button type="button" className="cat-main" onClick={() => onEdit(c)}>
            <span
              className="row-emoji"
              style={{ background: c.kind === 'income' ? 'var(--income-soft)' : 'var(--neutral-tint)' }}
            >
              {c.emoji}
            </span>
            <span className="tx-name">{c.name}</span>
            {c.archived && <span className="kind-badge">archived</span>}
          </button>
          <button
            type="button"
            className="mini-delete"
            aria-label={`Delete ${c.name}`}
            onClick={() => onDelete(c)}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

function CategoryForm({
  initial,
  onClose,
  onSave,
}: {
  initial?: Category | null;
  onClose: () => void;
  onSave: (cat: { name: string; emoji: string; kind: TxType; archived: boolean }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '📦');
  const [kind, setKind] = useState<TxType>(initial?.kind ?? 'expense');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the category a name.');
      return;
    }
    if (!emoji.trim()) {
      setError('Pick an emoji for the category.');
      return;
    }
    onSave({ name: name.trim(), emoji: emoji.trim(), kind, archived: initial?.archived ?? false });
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="cat-name">Name</label>
        <input
          id="cat-name"
          type="text"
          className="input"
          placeholder="e.g. Mascotas"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cat-emoji">Emoji</label>
        <input
          id="cat-emoji"
          type="text"
          className="input"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          aria-label="Emoji"
        />
      </div>
      {!initial && (
        <div className="segmented" role="radiogroup" aria-label="Category type">
          <button type="button" className={kind === 'expense' ? 'active expense' : ''} onClick={() => setKind('expense')}>
            Expense
          </button>
          <button type="button" className={kind === 'income' ? 'active income' : ''} onClick={() => setKind('income')}>
            Income
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block">
        {initial ? 'Save changes' : 'Add category'}
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}
