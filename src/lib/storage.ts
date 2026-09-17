import { DEFAULT_PREFERENCES } from "../app/constants";
import type { AppPreferences, QueueItem } from "../app/types";

export function loadPreferences(): AppPreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("pliflo-preferences") ?? "{}",
    ) as Partial<AppPreferences>;
    const legacyTheme = localStorage.getItem("pliflo-theme");
    return {
      theme:
        parsed.theme === "system" || parsed.theme === "light" || parsed.theme === "dark"
          ? parsed.theme
          : legacyTheme === "light" || legacyTheme === "dark"
            ? legacyTheme
            : DEFAULT_PREFERENCES.theme,
      printerPreference:
        parsed.printerPreference === "last" ? "last" : DEFAULT_PREFERENCES.printerPreference,
      restoreBatch:
        typeof parsed.restoreBatch === "boolean"
          ? parsed.restoreBatch
          : DEFAULT_PREFERENCES.restoreBatch,
      historyRetention:
        parsed.historyRetention === "session" ||
        parsed.historyRetention === "30d" ||
        parsed.historyRetention === "forever"
          ? parsed.historyRetention
          : DEFAULT_PREFERENCES.historyRetention,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function parseStoredItems(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as QueueItem[]) : [];
  } catch {
    return [];
  }
}

export function loadStoredBatch(preferences: AppPreferences): QueueItem[] {
  if (!preferences.restoreBatch) return [];

  return parseStoredItems("pliflo-batch").map((item) => {
    if (item.state === "submitted" || item.state === "printing") {
      return item.systemJobId
        ? { ...item, error: undefined, finishedAt: undefined }
        : {
            ...item,
            state: "failed" as const,
            error: "Submission state could not be restored because no system job ID was recorded.",
            finishedAt: Date.now(),
          };
    }
    if (item.state === "submitting") {
      return {
        ...item,
        state: "failed" as const,
        error:
          "Submission was interrupted before a system job ID was recorded. Review before retrying.",
        finishedAt: Date.now(),
      };
    }
    return {
      ...item,
      state: "queued" as const,
      systemJobId: undefined,
      error: undefined,
      finishedAt: undefined,
    };
  });
}

export function loadStoredHistory(preferences: AppPreferences): QueueItem[] {
  return preferences.historyRetention === "session" ? [] : parseStoredItems("pliflo-history");
}

export function recoverStoredJobId(error?: string) {
  if (!error?.includes("unrecognized job id")) return null;
  return (
    error.match(/[A-Za-z0-9_.][A-Za-z0-9_.-]*-\d+/g)?.find((candidate) => {
      const suffix = candidate.slice(candidate.lastIndexOf("-") + 1);
      return suffix.length > 0 && /^\d+$/.test(suffix);
    }) ?? null
  );
}
