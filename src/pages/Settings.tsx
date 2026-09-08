import { useRef, useState } from 'react';
import { LANGS, availableLanguages, setLanguage, t, to, useI18n } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import { APP_VERSION } from '../lib/version';
import { useStore } from '../state/store';
import { exportData, validateAppData } from '../lib/importExport';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LicenseSection } from '../components/LicenseSection';

/** Settings tab: data backup/reset, budget period, license, about. Category
 *  management moved to its own tab in the 2026-09 four-section redesign. */
export function Settings() {
  const { data, dispatch } = useStore();
  const { lang } = useI18n();

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
      <h2 className="settings-h">{t('settings.data')}</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">{t('settings.exportData')}</div>
            <div className="setting-desc">{t('settings.exportDesc')}</div>
          </div>
          <button type="button" className="btn" onClick={() => exportData(data)}>
            {t('settings.export')}
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">{t('settings.importData')}</div>
            <div className="setting-desc">{t('settings.importDesc')}</div>
          </div>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t('settings.import')}
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
            <div className="setting-name">{t('settings.resetApp')}</div>
            <div className="setting-desc">{t('settings.resetDesc')}</div>
          </div>
          <button type="button" className="btn btn-soft-danger" onClick={() => setResetStep(1)}>
            {t('settings.reset')}
          </button>
        </div>
      </div>

      <h2 className="settings-h">{t('settings.budgetPeriod')}</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">{t('settings.periodStarts')}</div>
            <div className="setting-desc">{t('settings.periodDesc')}</div>
          </div>
          <select
            className="input period-day-select"
            value={data.periodStartDay}
            onChange={(e) => dispatch({ type: 'setPeriodStartDay', day: Number(e.target.value) })}
            aria-label={t('settings.periodAria')}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {to(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="settings-h">{t('settings.language')}</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">{t('settings.language')}</div>
            <div className="setting-desc">{LANGS[lang].name}</div>
          </div>
          <select
            className="input language-select"
            value={lang}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            aria-label={t('settings.languageAria')}
          >
            {availableLanguages().map((l) => (
              <option key={l} value={l}>
                {LANGS[l].name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <LicenseSection />

      <h2 className="settings-h">{t('settings.about')}</h2>
      <div className="card">
        <p className="field-hint">
          {`Budget ${APP_VERSION} · ${t('settings.aboutTitle')}`}
          <br />
          {t('settings.aboutData')}
          <br />
          {t('settings.aboutCurrency')}
        </p>
      </div>

      <ConfirmDialog
        open={pendingImport !== undefined}
        title={t('settings.replaceTitle')}
        message={t('settings.replaceMsg')}
        confirmLabel={t('settings.replaceConfirm')}
        onCancel={() => setPendingImport(undefined)}
        onConfirm={() => {
          if (pendingImport) dispatch({ type: 'importData', data: pendingImport });
          setPendingImport(undefined);
        }}
      />

      <ConfirmDialog
        open={resetStep === 1}
        title={t('settings.resetTitle')}
        message={t('settings.resetMsg')}
        confirmLabel={t('settings.eraseAll')}
        onCancel={() => setResetStep(0)}
        onConfirm={() => setResetStep(2)}
      />
      <ConfirmDialog
        open={resetStep === 2}
        title={t('settings.sureTitle')}
        message={t('settings.sureMsg')}
        confirmLabel={t('settings.yesErase')}
        onCancel={() => setResetStep(0)}
        onConfirm={() => {
          dispatch({ type: 'resetAll' });
          setResetStep(0);
        }}
      />
    </div>
  );
}
