import { ChevronDown, RotateCcw, X } from "lucide-react";
import type { AppPreferences, Locale } from "../app/types";

type AppSettingsDrawerProps = {
  labels: {
    settings: string;
    settingsCaption: string;
    closeSettings: string;
    appearance: string;
    theme: string;
    themeSystem: string;
    themeLightLabel: string;
    themeDarkLabel: string;
    languageLabel: string;
    chinese: string;
    english: string;
    printingBehavior: string;
    printerPreference: string;
    useSystemPrinter: string;
    useLastPrinter: string;
    behavior: string;
    restoreBatch: string;
    restoreBatchHint: string;
    historyRetention: string;
    historySession: string;
    history30d: string;
    historyForever: string;
    clearHistory: string;
    resetAppSettings: string;
  };
  preferences: AppPreferences;
  locale: Locale;
  onClose: () => void;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  onLocaleChange: (locale: Locale) => void;
  onClearHistory: () => void;
  onReset: () => void;
};

export function AppSettingsDrawer({
  labels,
  preferences,
  locale,
  onClose,
  onPreferencesChange,
  onLocaleChange,
  onClearHistory,
  onReset,
}: AppSettingsDrawerProps) {
  return (
    <div className="settings-drawer">
      <div className="drawer-heading">
        <div>
          <h2>{labels.settings}</h2>
          <span className="panel-caption">{labels.settingsCaption}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={labels.closeSettings}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>

      <div className="app-settings-section">
        <strong>{labels.appearance}</strong>
        <div className="setting-row wide-label">
          <label>{labels.theme}</label>
          <div className="segmented settings-segmented">
            {(
              [
                ["system", labels.themeSystem],
                ["light", labels.themeLightLabel],
                ["dark", labels.themeDarkLabel],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={preferences.theme === value ? "active" : ""}
                onClick={() => onPreferencesChange({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row wide-label">
          <label>{labels.languageLabel}</label>
          <div className="segmented settings-segmented two">
            <button
              type="button"
              className={locale === "zh-CN" ? "active" : ""}
              onClick={() => onLocaleChange("zh-CN")}
            >
              {labels.chinese}
            </button>
            <button
              type="button"
              className={locale === "en" ? "active" : ""}
              onClick={() => onLocaleChange("en")}
            >
              {labels.english}
            </button>
          </div>
        </div>
      </div>

      <div className="app-settings-section">
        <strong>{labels.printingBehavior}</strong>
        <div className="setting-row wide-label">
          <label>{labels.printerPreference}</label>
          <div className="select-shell compact">
            <select
              value={preferences.printerPreference}
              onChange={(event) =>
                onPreferencesChange({
                  printerPreference: event.target.value as AppPreferences["printerPreference"],
                })
              }
            >
              <option value="system">{labels.useSystemPrinter}</option>
              <option value="last">{labels.useLastPrinter}</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      <details className="settings-disclosure">
        <summary>
          <span>{labels.behavior}</span>
          <ChevronDown size={15} />
        </summary>
        <div className="settings-disclosure-body">
          <label className="toggle-row stacked-toggle">
            <span>
              <strong>{labels.restoreBatch}</strong>
              <small>{labels.restoreBatchHint}</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.restoreBatch}
              onChange={(event) => onPreferencesChange({ restoreBatch: event.target.checked })}
            />
          </label>
          <div className="setting-row wide-label">
            <label>{labels.historyRetention}</label>
            <div className="select-shell compact">
              <select
                value={preferences.historyRetention}
                onChange={(event) =>
                  onPreferencesChange({
                    historyRetention: event.target.value as AppPreferences["historyRetention"],
                  })
                }
              >
                <option value="session">{labels.historySession}</option>
                <option value="30d">{labels.history30d}</option>
                <option value="forever">{labels.historyForever}</option>
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          <button className="settings-text-button" type="button" onClick={onClearHistory}>
            {labels.clearHistory}
          </button>
        </div>
      </details>

      <button className="settings-reset" type="button" onClick={onReset}>
        <RotateCcw size={14} /> {labels.resetAppSettings}
      </button>
    </div>
  );
}
