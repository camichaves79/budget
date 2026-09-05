import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Category, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { exportData, validateAppData } from '../lib/importExport';
import { Sheet } from '../components/Sheet';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function Settings() {
  const { data, dispatch } = useStore();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [importError, setImportError] = useState('');
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof validateAppData> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const expenseCats = data.categories.filter((c) => c.kind === 'expense');
  const incomeCats = data.categories.filter((c) => c.kind === 'income');

  const fallbackFor = (cat: Category): Category | undefined =>
    data.categories.find((c) => c.kind === cat.kind && c.id !== cat.id && !c.archived);

  const onImportFile = (file: File) => {
    setImportError('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const payload = raw?.data ?? raw;
        const parsed = validateAppData(payload);
        if (!parsed) {
          setImportError('That file is not a valid budget backup.');
          return;
        }
        setPendingImport(parsed);
      } catch {
        setImportError('Could not read that file as JSON.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <h2 className="settings-h">Categories</h2>
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

      <h2 className="settings-h">Data</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">Export backup</div>
            <div className="setting-desc">Download all data as a JSON file.</div>
          </div>
          <button type="button" className="btn" onClick={() => exportData(data)}>
            Export
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">Import backup</div>
            <div className="setting-desc">Replaces current data with a backup file.</div>
          </div>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {importError && <p className="error-text">{importError}</p>}
        <div className="setting-row">
          <div>
            <div className="setting-name">Reset app</div>
            <div className="setting-desc">Erase all transactions and budgets.</div>
          </div>
          <button type="button" className="btn btn-soft-danger" onClick={() => setResetStep(1)}>
            Reset
          </button>
        </div>
      </div>

      <h2 className="settings-h">Budget period</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">Period starts on</div>
            <div className="setting-desc">
              The period runs from this day to the day before it next month, labeled by the month with more days in it.
            </div>
          </div>
          <select
            className="input period-day-select"
            value={data.periodStartDay}
            onChange={(e) => dispatch({ type: 'setPeriodStartDay', day: Number(e.target.value) })}
            aria-label="Period start day"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="settings-h">About</h2>
      <div className="card">
        <p className="field-hint">
          Budget v0.1.0 · Mobile-first personal budget tracker.
          <br />
          All data stays on this device in your browser's local storage. Use Export to make backups.
          <br />
          Currency: Colombian Peso (COP), formatted $ 1.234 (integers only).
        </p>
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

      <ConfirmDialog
        open={pendingImport !== undefined}
        title="Replace all data?"
        message="Importing a backup replaces everything currently in the app. This cannot be undone."
        confirmLabel="Replace data"
        onCancel={() => setPendingImport(undefined)}
        onConfirm={() => {
          if (pendingImport) dispatch({ type: 'importData', data: pendingImport });
          setPendingImport(undefined);
        }}
      />

      <ConfirmDialog
        open={resetStep === 1}
        title="Reset the app?"
        message="This erases ALL transactions, budgets, and custom categories. You should export a backup first."
        confirmLabel="Erase everything"
        onCancel={() => setResetStep(0)}
        onConfirm={() => setResetStep(2)}
      />
      <ConfirmDialog
        open={resetStep === 2}
        title="Are you absolutely sure?"
        message="There is no undo. Your data will be gone forever."
        confirmLabel="Yes, erase everything"
        onCancel={() => setResetStep(0)}
        onConfirm={() => {
          dispatch({ type: 'resetAll' });
          setResetStep(0);
        }}
      />
    </div>
  );
}

/** "1st", "2nd", … "28th" for the period start-day picker. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
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
