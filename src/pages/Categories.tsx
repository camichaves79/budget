import { useState } from 'react';
import { t } from '../lib/i18n';
import type { FormEvent } from 'react';
import type { Category, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { Sheet } from '../components/Sheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';

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
        <h2 className="section-title page-label">{t('cats.categories')}</h2>
      </div>

      <div className="pinned-scroll">
        {data.categories.length === 0 && (
          <EmptyState emoji="🏷️" title={t('cats.emptyTitle')} hint={t('cats.emptyHint')} />
        )}
        <div className="card">
          <CategoryGroup
            title={t('cats.expenses')}
            cats={expenseCats}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
          />
          <CategoryGroup
            title={t('cats.income')}
            cats={incomeCats}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
          />
          <button type="button" className="btn btn-block" onClick={() => setAdding(true)}>
            {t('cats.addCategory')}
          </button>
        </div>
      </div>

      <Sheet className="sheet-tight" open={adding} onClose={() => setAdding(false)} title={t('cats.newCategory')}>
        <CategoryForm
          onClose={() => setAdding(false)}
          onSave={(cat) => {
            dispatch({ type: 'addCategory', cat: { ...cat, archived: false } });
            setAdding(false);
          }}
        />
      </Sheet>

      <Sheet className="sheet-tight" open={editing !== null} onClose={() => setEditing(null)} title={t('cats.editCategory')}>
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
        title={t('cats.deleteCategoryTitle')}
        message={
          deleting && fallbackFor(deleting)
            ? t('cats.deleteReassign', { from: deleting.name, to: fallbackFor(deleting)?.name ?? '' })
            : t('cats.deleteSimple')
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
            {c.archived && <span className="kind-badge">{t('cats.archived')}</span>}
          </button>
          <button
            type="button"
            className="mini-delete"
            aria-label={t('cats.deleteAria', { name: c.name })}
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
      setError(t('cats.errName'));
      return;
    }
    if (!emoji.trim()) {
      setError(t('cats.errEmoji'));
      return;
    }
    onSave({ name: name.trim(), emoji: emoji.trim(), kind, archived: initial?.archived ?? false });
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="cat-name">{t('cats.name')}</label>
        <input
          id="cat-name"
          type="text"
          className="input"
          placeholder={t('cats.namePlaceholder')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cat-emoji">{t('cats.emoji')}</label>
        <input
          id="cat-emoji"
          type="text"
          className="input"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          aria-label={t('cats.emoji')}
        />
      </div>
      {!initial && (
        <div className="segmented" role="radiogroup" aria-label={t('cats.typeAria')}>
          <button type="button" className={kind === 'expense' ? 'active expense' : ''} onClick={() => setKind('expense')}>
            {t('tx.expense')}
          </button>
          <button type="button" className={kind === 'income' ? 'active income' : ''} onClick={() => setKind('income')}>
            {t('tx.income')}
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block">
        {initial ? t('tx.saveChanges') : t('cats.addCat')}
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        {t('smart.cancel')}
      </button>
    </form>
  );
}
