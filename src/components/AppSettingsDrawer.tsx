import { Select } from "./Select";
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
    <div className="settings-drawer absolute right-3 top-18 z-50 max-h-[calc(100vh-84px)] w-90 overflow-auto">
      <div className="drawer-heading sticky top-0 z-2 flex min-h-16.5 items-center justify-between gap-3 px-2.5 py-3 pl-3.5">
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

      <div className="app-settings-section border-b px-3.5 py-3.5">
        <strong className="mb-2.25 block text-xs font-720 tracking-[0.01em]">
          {labels.appearance}
        </strong>
        <div className="setting-row wide-label grid min-h-10.5 grid-cols-[minmax(104px,0.8fr)_minmax(150px,1.2fr)] items-center gap-2 py-0.75">
          <label>{labels.theme}</label>
          <div className="segmented settings-segmented flex w-full max-w-none p-0.5">
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
                className={`min-w-0 flex-1 px-1.5 ${preferences.theme === value ? "active" : ""}`}
                onClick={() => onPreferencesChange({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row wide-label grid min-h-10.5 grid-cols-[minmax(104px,0.8fr)_minmax(150px,1.2fr)] items-center gap-2 py-0.75">
          <label>{labels.languageLabel}</label>
          <div className="segmented settings-segmented two flex w-full max-w-none p-0.5">
            <button
              type="button"
              className={`min-w-16 flex-1 px-1.5 ${locale === "zh-CN" ? "active" : ""}`}
              onClick={() => onLocaleChange("zh-CN")}
            >
              {labels.chinese}
            </button>
            <button
              type="button"
              className={`min-w-16 flex-1 px-1.5 ${locale === "en" ? "active" : ""}`}
              onClick={() => onLocaleChange("en")}
            >
              {labels.english}
            </button>
          </div>
        </div>
      </div>

      <div className="app-settings-section border-b px-3.5 py-3.5">
        <strong className="mb-2.25 block text-xs font-720 tracking-[0.01em]">
          {labels.printingBehavior}
        </strong>
        <div className="setting-row wide-label grid min-h-10.5 grid-cols-[minmax(104px,0.8fr)_minmax(150px,1.2fr)] items-center gap-2 py-0.75">
          <label>{labels.printerPreference}</label>
          <div className="select-shell compact w-full min-w-0">
            <Select
              aria-label={labels.printerPreference}
              value={preferences.printerPreference}
              onValueChange={(value) =>
                onPreferencesChange({
                  printerPreference: value as AppPreferences["printerPreference"],
                })
              }
            >
              <option value="system">{labels.useSystemPrinter}</option>
              <option value="last">{labels.useLastPrinter}</option>
            </Select>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      <details className="settings-disclosure mx-3.5 mt-3 overflow-hidden">
        <summary className="flex min-h-10 items-center justify-between px-2.5 text-xs font-680">
          <span>{labels.behavior}</span>
          <ChevronDown size={15} />
        </summary>
        <div className="settings-disclosure-body px-2.5 pb-2.5 pt-2">
          <label className="toggle-row stacked-toggle flex min-h-12.5 items-center justify-between gap-2.5">
            <span className="flex min-w-0 flex-col gap-0.75">
              <strong className="text-xs">{labels.restoreBatch}</strong>
              <small className="max-w-55 text-[11px] font-500 leading-[1.35]">
                {labels.restoreBatchHint}
              </small>
            </span>
            <input
              type="checkbox"
              checked={preferences.restoreBatch}
              onChange={(event) => onPreferencesChange({ restoreBatch: event.target.checked })}
            />
          </label>
          <div className="setting-row wide-label grid min-h-10.5 grid-cols-[minmax(104px,0.8fr)_minmax(150px,1.2fr)] items-center gap-2 py-0.75">
            <label>{labels.historyRetention}</label>
            <div className="select-shell compact w-full min-w-0">
              <Select
                aria-label={labels.historyRetention}
                value={preferences.historyRetention}
                onValueChange={(value) =>
                  onPreferencesChange({
                    historyRetention: value as AppPreferences["historyRetention"],
                  })
                }
              >
                <option value="session">{labels.historySession}</option>
                <option value="30d">{labels.history30d}</option>
                <option value="forever">{labels.historyForever}</option>
              </Select>
              <ChevronDown size={14} />
            </div>
          </div>
          <button
            className="settings-text-button mt-1.75 inline-flex min-h-8.5 w-full items-center justify-center gap-1.5 text-xs font-650"
            type="button"
            onClick={onClearHistory}
          >
            {labels.clearHistory}
          </button>
        </div>
      </details>

      <button
        className="settings-reset mx-3.5 mb-3.5 mt-3 inline-flex min-h-8.5 w-[calc(100%-28px)] items-center justify-center gap-1.5 text-xs font-650"
        type="button"
        onClick={onReset}
      >
        <RotateCcw size={14} /> {labels.resetAppSettings}
      </button>
    </div>
  );
}
