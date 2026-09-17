import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { CircleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from "./app/constants";
import { COPY } from "./app/i18n";
import type {
  AppPreferences,
  JobState,
  Locale,
  PdfInfo,
  PrinterCapabilities,
  PrinterInfo,
  PrintSettings,
  QueueItem,
  SubmitResult,
  Theme,
} from "./app/types";
import "./styles/app.css";
import { AppSettingsDrawer } from "./components/AppSettingsDrawer";
import { AppTopbar } from "./components/AppTopbar";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { PdfPreviewPanel } from "./components/PdfPreviewPanel";
import { PrintSettingsPanel } from "./components/PrintSettingsPanel";
import { QueuePanel } from "./components/QueuePanel";
import { createQueueItem, estimatePrintUsage } from "./lib/print";
import {
  loadPreferences,
  loadStoredBatch,
  loadStoredHistory,
  recoverStoredJobId,
} from "./lib/storage";

function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
  const [locale, setLocale] = useState<Locale>(() =>
    localStorage.getItem("pliflo-locale") === "zh-CN" || navigator.language.startsWith("zh")
      ? "zh-CN"
      : "en",
  );
  const [items, setItems] = useState<QueueItem[]>(() => loadStoredBatch(preferences));
  const [historyItems, setHistoryItems] = useState<QueueItem[]>(() =>
    loadStoredHistory(preferences),
  );
  const archivedTerminalIdsRef = useRef(new Set(historyItems.map((item) => item.id)));
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [printerCapabilities, setPrinterCapabilities] = useState<PrinterCapabilities | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batchSettings, setBatchSettings] = useState<PrintSettings>({ ...DEFAULT_SETTINGS });
  const [queuePaused, setQueuePaused] = useState(false);
  const queuePausedRef = useRef(false);
  const queueRunningRef = useRef(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = preferences.theme === "system" ? systemTheme : preferences.theme;
  const copy = COPY[locale];
  const stateLabel: Record<JobState, string> = {
    queued: copy.ready,
    submitting: copy.submitting,
    submitted: copy.submitted,
    printing: copy.printing,
    completed: copy.completed,
    cancelled: copy.cancelled,
    failed: copy.attention,
  };

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const pending = items.filter((item) => item.state === "queued");
  const active = items.filter((item) =>
    ["submitting", "submitted", "printing"].includes(item.state),
  );
  const completed = items.filter((item) => item.state === "completed");
  const history = useMemo(
    () => [...historyItems].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [historyItems],
  );
  const printEstimate = estimatePrintUsage(pending, printerCapabilities);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
  }, [items, search]);

  useEffect(() => {
    localStorage.setItem("pliflo-preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncTheme = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "light" : "dark");
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);

  useEffect(() => {
    localStorage.setItem("pliflo-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const freshTerminalItems = items.filter(
      (item) =>
        ["completed", "cancelled", "failed"].includes(item.state) &&
        !archivedTerminalIdsRef.current.has(item.id),
    );
    if (!freshTerminalItems.length) return;
    for (const item of freshTerminalItems) archivedTerminalIdsRef.current.add(item.id);
    setHistoryItems((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of freshTerminalItems) byId.set(item.id, item);
      return [...byId.values()];
    });
  }, [items]);

  useEffect(() => {
    if (preferences.restoreBatch) {
      const batch = items.filter((item) =>
        ["queued", "submitting", "submitted", "printing"].includes(item.state),
      );
      localStorage.setItem("pliflo-batch", JSON.stringify(batch));
    } else {
      localStorage.removeItem("pliflo-batch");
    }

    if (preferences.historyRetention === "session") {
      localStorage.removeItem("pliflo-history");
      return;
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const storedHistory = history.filter(
      (item) =>
        ["completed", "cancelled", "failed"].includes(item.state) &&
        (preferences.historyRetention === "forever" || (item.finishedAt ?? 0) >= cutoff),
    );
    localStorage.setItem("pliflo-history", JSON.stringify(storedHistory));
  }, [history, items, preferences.historyRetention, preferences.restoreBatch]);

  const refreshPrinters = useCallback(async () => {
    try {
      const result = await invoke<PrinterInfo[]>("list_printers");
      setPrinters(result);
      setSelectedPrinter((current) => {
        if (current && result.some((printer) => printer.name === current)) return current;
        const last = localStorage.getItem("pliflo-last-printer") ?? "";
        if (
          preferences.printerPreference === "last" &&
          result.some((printer) => printer.name === last)
        ) {
          return last;
        }
        return result.find((printer) => printer.isDefault)?.name || result[0]?.name || "";
      });
    } catch (error) {
      setNotice(String(error));
    }
  }, [preferences.printerPreference]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      const pdfPaths = paths.filter((path) => path.toLowerCase().endsWith(".pdf"));
      if (!pdfPaths.length) return;
      try {
        const info = await invoke<PdfInfo[]>("inspect_pdfs", { paths: pdfPaths });
        const fresh = info.map(createQueueItem);
        setItems((current) => [...current, ...fresh]);
        setSelectedId((current) => current ?? fresh[0]?.id ?? null);
        setNotice(null);
      } catch (error) {
        setNotice(copy.addFilesError(error));
      }
    },
    [copy],
  );

  // Printer discovery is an external OS synchronization and intentionally updates UI state.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => void refreshPrinters(), [refreshPrinters]);

  useEffect(() => {
    const recoverable = historyItems.flatMap((item) => {
      if (item.state !== "failed" || item.systemJobId) return [];
      const jobId = recoverStoredJobId(item.error);
      return jobId ? [{ itemId: item.id, jobId }] : [];
    });

    for (const { itemId, jobId } of recoverable) {
      void invoke<"pending" | "completed" | "unknown">("get_print_job_state", { jobId })
        .then((state) => {
          if (state === "unknown") return;
          setHistoryItems((current) =>
            current.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    systemJobId: jobId,
                    state: state === "completed" ? "completed" : "printing",
                    error: undefined,
                    finishedAt: state === "completed" ? (item.finishedAt ?? Date.now()) : undefined,
                  }
                : item,
            ),
          );
        })
        .catch(() => undefined);
    }
    // Persisted false failures are reconciled once. Later jobs already store systemJobId directly.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPrinter) return;
    let cancelled = false;
    setPrinterCapabilities(null);
    void invoke<PrinterCapabilities>("get_printer_capabilities", { printer: selectedPrinter })
      .then((result) => {
        if (!cancelled) setPrinterCapabilities(result);
      })
      .catch(() => {
        if (!cancelled) setPrinterCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPrinter]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setIsDragging(true);
        if (event.payload.type === "leave") setIsDragging(false);
        if (event.payload.type === "drop") {
          setIsDragging(false);
          void addPaths(event.payload.paths);
        }
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });
    return () => unlisten?.();
  }, [addPaths]);

  useEffect(() => {
    if (!active.length) return;
    const timer = window.setInterval(() => {
      for (const item of items.filter(
        (entry) => entry.systemJobId && ["submitted", "printing"].includes(entry.state),
      )) {
        void invoke<"pending" | "completed" | "unknown">("get_print_job_state", {
          jobId: item.systemJobId,
        })
          .then((state) => {
            setItems((current) =>
              current.map((candidate) => {
                if (candidate.id !== item.id) return candidate;
                if (
                  candidate.systemJobId !== item.systemJobId ||
                  !["submitted", "printing"].includes(candidate.state)
                ) {
                  return candidate;
                }
                if (state === "completed")
                  return { ...candidate, state: "completed", finishedAt: Date.now() };
                if (state === "pending") return { ...candidate, state: "printing" };
                return candidate;
              }),
            );
          })
          .catch(() => undefined);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [active.length, items]);

  async function chooseFiles() {
    const result = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    if (result) await addPaths(Array.isArray(result) ? result : [result]);
  }

  function updateItemSettings(id: string, patch: Partial<PrintSettings>) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, settings: { ...item.settings, ...patch } } : item,
      ),
    );
  }

  function applyBatchSettings(patch: Partial<PrintSettings>) {
    setBatchSettings((current) => ({ ...current, ...patch }));
    setItems((current) =>
      current.map((item) =>
        item.state === "queued" ? { ...item, settings: { ...item.settings, ...patch } } : item,
      ),
    );
  }

  async function submitOne(item: QueueItem) {
    if (!selectedPrinter) {
      setNotice(copy.selectPrinter);
      return false;
    }
    if (!printerCapabilities) {
      setNotice(copy.printerCapabilitiesUnavailable);
      return false;
    }
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, state: "submitting", error: undefined, finishedAt: undefined }
          : candidate,
      ),
    );
    try {
      const result = await invoke<SubmitResult>("submit_print_job", {
        path: item.path,
        printer: selectedPrinter,
        settings: {
          ...item.settings,
          duplex:
            printerCapabilities && !printerCapabilities.supportsDuplex
              ? "none"
              : item.settings.duplex,
          color:
            printerCapabilities && !printerCapabilities.supportsColor
              ? "auto"
              : item.settings.color,
        },
      });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "submitted", systemJobId: result.jobId }
            : candidate,
        ),
      );
      return true;
    } catch (error) {
      const message = copy.submissionError(item.name, error);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "failed", error: String(error), finishedAt: Date.now() }
            : candidate,
        ),
      );
      setNotice(message);
      return false;
    }
  }

  async function startQueue() {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    setQueueRunning(true);
    queuePausedRef.current = false;
    if (queuePaused) setQueuePaused(false);
    try {
      for (const item of pending) {
        const submitted = await submitOne(item);
        if (!submitted || queuePausedRef.current) break;
      }
    } finally {
      queueRunningRef.current = false;
      setQueueRunning(false);
    }
  }

  async function cancelJob(item: QueueItem) {
    try {
      if (item.systemJobId) await invoke("cancel_print_job", { jobId: item.systemJobId });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "cancelled", finishedAt: Date.now() }
            : candidate,
        ),
      );
    } catch (error) {
      setNotice(copy.cancelError(error));
    }
  }

  const settings = selected?.settings ?? batchSettings;
  const changeSetting = (patch: Partial<PrintSettings>) =>
    selected ? updateItemSettings(selected.id, patch) : applyBatchSettings(patch);

  return (
    <main
      className="app-shell relative flex h-screen min-h-0 flex-col overflow-hidden"
      data-theme={theme}
    >
      <AppTopbar
        labels={copy}
        pendingCount={pending.length}
        activeCount={active.length}
        completedCount={completed.length}
        onDragError={(error) => setNotice(copy.dragError(error))}
        onToggleHistory={() => {
          setSettingsOpen(false);
          setHistoryOpen((value) => !value);
        }}
        onToggleSettings={() => {
          setHistoryOpen(false);
          setSettingsOpen((value) => !value);
        }}
      />

      {notice && (
        <div
          className="notice-bar absolute left-1/2 top-19 z-40 flex min-h-9.5 max-w-[min(620px,calc(100vw-40px))] -translate-x-1/2 items-center gap-2.25 px-2.5 py-2 text-xs"
          aria-live="polite"
        >
          <CircleAlert size={15} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice}</span>
          <button
            className="ml-auto grid p-0.75"
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="workspace grid h-[calc(100vh-64px)] min-h-0 flex-1 grid-cols-[minmax(300px,25vw)_minmax(440px,1fr)_340px] max-[1240px]:grid-cols-[310px_minmax(380px,1fr)_312px] max-[1120px]:grid-cols-[300px_minmax(360px,1fr)_304px]">
        <QueuePanel
          items={items}
          visibleItems={visibleItems}
          selectedId={selected?.id ?? null}
          search={search}
          isDragging={isDragging}
          pendingCount={pending.length}
          activeCount={active.length}
          completedCount={completed.length}
          stateLabel={stateLabel}
          labels={copy}
          onChooseFiles={() => void chooseFiles()}
          onSearchChange={setSearch}
          onSelect={setSelectedId}
        />

        <PdfPreviewPanel
          selected={selected}
          queueRunning={queueRunning}
          labels={copy}
          onRemove={(id) => {
            setItems((current) => current.filter((item) => item.id !== id));
            setSelectedId(null);
          }}
        />

        <PrintSettingsPanel
          labels={copy}
          printers={printers}
          selectedPrinter={selectedPrinter}
          printerCapabilities={printerCapabilities}
          selected={selected}
          itemsLength={items.length}
          settings={settings}
          pendingCount={pending.length}
          activeItems={active}
          printEstimate={printEstimate}
          queueRunning={queueRunning}
          queuePaused={queuePaused}
          onReset={() => {
            setBatchSettings({ ...DEFAULT_SETTINGS });
            if (selected) updateItemSettings(selected.id, DEFAULT_SETTINGS);
          }}
          onPrinterChange={(printer) => {
            setPrinterCapabilities(null);
            setSelectedPrinter(printer);
            if (preferences.printerPreference === "last") {
              localStorage.setItem("pliflo-last-printer", printer);
            }
          }}
          onRefreshPrinters={() => void refreshPrinters()}
          onSelectBatch={() => setSelectedId(null)}
          onSelectFile={() => setSelectedId(items[0]?.id ?? null)}
          onChangeSetting={changeSetting}
          onStartQueue={() => void startQueue()}
          onToggleQueuePause={() => {
            if (queuePaused) {
              void startQueue();
              return;
            }
            queuePausedRef.current = true;
            setQueuePaused(true);
          }}
          onCancelJob={(item) => void cancelJob(item)}
        />
      </section>

      {historyOpen && (
        <HistoryDrawer
          labels={copy}
          items={history}
          stateLabel={stateLabel}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {settingsOpen && (
        <AppSettingsDrawer
          labels={copy}
          preferences={preferences}
          locale={locale}
          onClose={() => setSettingsOpen(false)}
          onPreferencesChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))}
          onLocaleChange={setLocale}
          onClearHistory={() => {
            for (const item of items) {
              if (["completed", "cancelled", "failed"].includes(item.state)) {
                archivedTerminalIdsRef.current.add(item.id);
              }
            }
            setHistoryItems([]);
            localStorage.removeItem("pliflo-history");
          }}
          onReset={() => {
            setPreferences(DEFAULT_PREFERENCES);
            setLocale(navigator.language.startsWith("zh") ? "zh-CN" : "en");
            localStorage.removeItem("pliflo-last-printer");
          }}
        />
      )}
    </main>
  );
}

export default App;
