import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { exportData, validateAppData } from '../lib/importExport';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LicenseSection } from '../components/LicenseSection';

/** Settings tab: data backup/reset, budget period, license, about. Category
 *  management moved to its own tab in the 2026-09 four-section redesign. */
export function Settings() {
  const { data, dispatch } = useStore();

  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [importError, setImportError] = useState('');
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof validateAppData> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

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
      <h2 className="settings-h">Data</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">Export data</div>
            <div className="setting-desc">Download all your data as JSON.</div>
          </div>
          <button type="button" className="btn" onClick={() => exportData(data)}>
            Export
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">Import data</div>
            <div className="setting-desc">Replace current data with a backup.</div>
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
            <div className="setting-desc">Runs from this day until the day before it next month.</div>
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

      <LicenseSection />

      <h2 className="settings-h">About</h2>
      <div className="card">
        <p className="field-hint">
          Budget v0.1.95 · Personal budget tracker.
          <br />
          Data stays on this device — export to back up.
          <br />
          Currency: COP, integer pesos ($ 1.234).
        </p>
      </div>

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
