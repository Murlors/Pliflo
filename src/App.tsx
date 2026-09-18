import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { CircleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from "./app/constants";
import { COPY } from "./app/i18n";
import type {
  AppPreferences,
  DocumentRenderOptions,
  JobState,
  Locale,
  PrinterCapabilities,
  PrinterInfo,
  PrintSettings,
  PrintStatus,
  PrinterStatus,
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
import { PrintReviewDialog } from "./components/PrintReviewDialog";
import {
  canRetryJob,
  createQueueItem,
  estimatePrintUsage,
  isActiveJob,
  retryQueueItem,
} from "./lib/print";
import {
  cleanupGeneratedDocument,
  documentFormat,
  inspectSupportedFiles,
  prepareDocument,
  SUPPORTED_EXTENSIONS,
} from "./lib/documents";
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
  const preparingIdRef = useRef<string | null>(null);
  const preparationControllerRef = useRef<AbortController | null>(null);
  const preparationVersionsRef = useRef(new Map<string, number>());
  const pendingRenderOptionsRef = useRef(new Map<string, DocumentRenderOptions>());
  const [preparationTick, setPreparationTick] = useState(0);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [printerCapabilities, setPrinterCapabilities] = useState<PrinterCapabilities | null>(null);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const printerStatusNameRef = useRef("");
  const [printerStatusUnavailable, setPrinterStatusUnavailable] = useState(false);
  const [printerRefresh, setPrinterRefresh] = useState(0);
  const [review, setReview] = useState<{ printer: string; items: QueueItem[] } | null>(null);
  const retryingIdsRef = useRef(new Set<string>());
  const statusRequestsRef = useRef(new Set<string>());
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
    submitted: copy.waitingInSystem,
    printing: copy.printing,
    blocked: copy.blocked,
    completed: copy.completed,
    cancelled: copy.cancelled,
    failed: copy.attention,
  };

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const queuedItems = items.filter((item) => item.state === "queued");
  const pending = queuedItems.filter((item) => !item.preparing);
  const active = items.filter(isActiveJob);
  const completed = items.filter((item) => item.state === "completed");
  const history = useMemo(
    () => [...historyItems].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [historyItems],
  );
  const printEstimate = estimatePrintUsage(queuedItems, printerCapabilities);
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
    void invoke("cleanup_stale_printable_pdfs").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (preparingIdRef.current) return;
    const item = items.find((candidate) => candidate.state === "queued" && candidate.preparing);
    if (!item) return;

    const version = preparationVersionsRef.current.get(item.id) ?? 0;
    const renderOptions = pendingRenderOptionsRef.current.get(item.id) ?? item.renderOptions;
    const previousArtifact = item.printPath
      ? { generated: item.generated, printPath: item.printPath }
      : null;
    const controller = new AbortController();
    preparingIdRef.current = item.id;
    preparationControllerRef.current = controller;

    void prepareDocument(
      { path: item.path, name: item.name, sizeBytes: item.sizeBytes },
      renderOptions,
      controller.signal,
    )
      .then(async (prepared) => {
        if ((preparationVersionsRef.current.get(item.id) ?? 0) !== version) {
          await cleanupGeneratedDocument(prepared);
          return;
        }
        if (previousArtifact) await cleanupGeneratedDocument(previousArtifact);
        pendingRenderOptionsRef.current.delete(item.id);
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  ...prepared,
                  renderOptions,
                  preparing: false,
                  error: undefined,
                  finishedAt: undefined,
                }
              : candidate,
          ),
        );
      })
      .catch((error) => {
        if ((preparationVersionsRef.current.get(item.id) ?? 0) !== version) return;
        pendingRenderOptionsRef.current.delete(item.id);
        if (previousArtifact) {
          setItems((current) =>
            current.map((candidate) =>
              candidate.id === item.id ? { ...candidate, preparing: false } : candidate,
            ),
          );
          setNotice(copy.addFilesError(error));
          return;
        }
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  preparing: false,
                  state: "failed",
                  error: String(error),
                  finishedAt: Date.now(),
                }
              : candidate,
          ),
        );
      })
      .finally(() => {
        preparingIdRef.current = null;
        if (preparationControllerRef.current === controller) {
          preparationControllerRef.current = null;
        }
        setPreparationTick((value) => value + 1);
      });
  }, [copy, items, preparationTick]);

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
        ["queued", "submitting", "submitted", "printing", "blocked", "failed"].includes(item.state),
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
    setPrinterRefresh((value) => value + 1);
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
      try {
        const files = await inspectSupportedFiles(paths);
        if (!files.length) return;
        const fresh = files.flatMap((file) => {
          const format = documentFormat(file.path);
          if (!format) return [];
          return [
            {
              ...createQueueItem({
                ...file,
                printPath: "",
                pages: null,
                format,
                generated: format !== "pdf",
              }),
              settings: { ...batchSettings },
              preparing: true,
            },
          ];
        });
        if (fresh.length) {
          setItems((current) => [...current, ...fresh]);
          setSelectedId((current) => current ?? fresh[0]?.id ?? null);
        }
        setNotice(null);
      } catch (error) {
        setNotice(copy.addFilesError(error));
      }
    },
    [copy, batchSettings],
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
      void invoke<PrintStatus>("get_print_job_status", { jobId })
        .then((status) => {
          if (status.state === "unknown") return;
          setHistoryItems((current) =>
            current.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    systemJobId: jobId,
                    state: status.state === "unknown" ? item.state : status.state,
                    systemReasons: status.reasons,
                    systemMessage: status.message,
                    error: undefined,
                    finishedAt: ["completed", "cancelled", "failed"].includes(status.state)
                      ? (item.finishedAt ?? Date.now())
                      : undefined,
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
  }, [selectedPrinter, printerRefresh]);

  useEffect(() => {
    if (printerStatusNameRef.current !== selectedPrinter) {
      printerStatusNameRef.current = selectedPrinter;
      setPrinterStatus(null);
      setPrinterStatusUnavailable(false);
    }
    if (!selectedPrinter) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await invoke<PrinterStatus>("get_printer_status", {
          printer: selectedPrinter,
        });
        if (!cancelled) {
          setPrinterStatus(status);
          setPrinterStatusUnavailable(false);
        }
      } catch {
        if (!cancelled) setPrinterStatusUnavailable(true);
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedPrinter, printerRefresh]);

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
      for (const item of items.filter((entry) => entry.systemJobId && isActiveJob(entry))) {
        if (statusRequestsRef.current.has(item.systemJobId!)) continue;
        statusRequestsRef.current.add(item.systemJobId!);
        void invoke<PrintStatus>("get_print_job_status", {
          jobId: item.systemJobId,
        })
          .then((status) => {
            setItems((current) =>
              current.map((candidate) => {
                if (candidate.id !== item.id) return candidate;
                if (candidate.systemJobId !== item.systemJobId || !isActiveJob(candidate)) {
                  return candidate;
                }
                return {
                  ...candidate,
                  state: status.state === "unknown" ? candidate.state : status.state,
                  systemReasons: status.reasons,
                  systemMessage: status.message,
                  statusUnavailable: status.state === "unknown",
                  finishedAt: ["completed", "cancelled", "failed"].includes(status.state)
                    ? Date.now()
                    : undefined,
                };
              }),
            );
          })
          .catch(() =>
            setItems((current) =>
              current.map((candidate) =>
                candidate.id === item.id && isActiveJob(candidate)
                  ? { ...candidate, statusUnavailable: true }
                  : candidate,
              ),
            ),
          )
          .finally(() => statusRequestsRef.current.delete(item.systemJobId!));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [active.length, items]);

  async function chooseFiles() {
    const result = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Documents", extensions: [...SUPPORTED_EXTENSIONS] }],
    });
    if (result) await addPaths(Array.isArray(result) ? result : [result]);
  }

  function updateItemSettings(id: string, patch: Partial<PrintSettings>) {
    if (queueRunningRef.current) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id && !isActiveJob(item) && item.state !== "completed"
          ? { ...item, settings: { ...item.settings, ...patch } }
          : item,
      ),
    );
  }

  function applyBatchSettings(patch: Partial<PrintSettings>) {
    if (queueRunningRef.current) return;
    setBatchSettings((current) => ({ ...current, ...patch }));
    setItems((current) =>
      current.map((item) =>
        item.state === "queued" || canRetryJob(item)
          ? { ...item, settings: { ...item.settings, ...patch } }
          : item,
      ),
    );
  }

  function updateRenderOptions(id: string, patch: Partial<DocumentRenderOptions>) {
    const item = items.find((candidate) => candidate.id === id);
    if (
      queueRunningRef.current ||
      !item ||
      item.state !== "queued" ||
      !["xlsx", "image"].includes(item.format)
    )
      return;
    const baseOptions = pendingRenderOptionsRef.current.get(id) ?? item.renderOptions;
    const nextOptions = { ...baseOptions, ...patch };
    preparationVersionsRef.current.set(id, (preparationVersionsRef.current.get(id) ?? 0) + 1);
    pendingRenderOptionsRef.current.set(id, nextOptions);
    if (preparingIdRef.current === id) preparationControllerRef.current?.abort();
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, preparing: true, error: undefined } : candidate,
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
    if (!item.printPath || item.preparing) {
      setNotice(copy.addFilesError("The document is still being prepared."));
      return false;
    }
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              state: "submitting",
              error: undefined,
              finishedAt: undefined,
              submittedPrinter: selectedPrinter,
              submittedSettings: { ...item.settings },
              submittedAt: Date.now(),
              systemReasons: undefined,
              systemMessage: undefined,
            }
          : candidate,
      ),
    );
    try {
      const result = await invoke<SubmitResult>("submit_print_job", {
        path: item.printPath,
        printer: selectedPrinter,
        settings: item.settings,
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

  function openPrintReview() {
    if (queueRunningRef.current || !printerCapabilities || !selectedPrinter) return;
    setReview({
      printer: selectedPrinter,
      items: pending.map((item) => ({
        ...item,
        settings: {
          ...item.settings,
          duplex: printerCapabilities.supportsDuplex ? item.settings.duplex : "none",
          color: printerCapabilities.supportsColor ? item.settings.color : "auto",
        },
      })),
    });
  }

  async function startQueue() {
    if (!review || !printerCapabilities) return;
    if (queueRunningRef.current) return;
    const current = pending.map((item) => ({
      ...item,
      settings: {
        ...item.settings,
        duplex: printerCapabilities.supportsDuplex ? item.settings.duplex : "none",
        color: printerCapabilities.supportsColor ? item.settings.color : "auto",
      },
    }));
    if (
      review.printer !== selectedPrinter ||
      JSON.stringify(current) !== JSON.stringify(review.items)
    ) {
      setReview(null);
      setNotice(copy.batchReviewChanged);
      return;
    }
    const approved = review.items;
    setReview(null);
    queueRunningRef.current = true;
    setQueueRunning(true);
    queuePausedRef.current = false;
    if (queuePaused) setQueuePaused(false);
    try {
      for (const item of approved) {
        if (queuePausedRef.current) break;
        const submitted = await submitOne(item);
        if (!submitted) {
          queuePausedRef.current = true;
          setQueuePaused(true);
          break;
        }
      }
    } finally {
      queueRunningRef.current = false;
      setQueueRunning(false);
    }
  }

  async function cancelJob(item: QueueItem) {
    if (!item.systemJobId || !isActiveJob(item)) return;
    try {
      await invoke("cancel_print_job", { jobId: item.systemJobId });
      // 请求成功不等于已取消；由状态轮询确认终态，避免覆盖恰好完成的作业。
      setNotice(copy.cancelRequested);
    } catch (error) {
      setNotice(copy.cancelError(error));
    }
  }

  function removeItem(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || queueRunningRef.current || isActiveJob(item)) return;
    preparationVersionsRef.current.set(id, (preparationVersionsRef.current.get(id) ?? 0) + 1);
    if (preparingIdRef.current === id) preparationControllerRef.current?.abort();
    pendingRenderOptionsRef.current.delete(id);
    if (item.retryOf) retryingIdsRef.current.delete(item.retryOf);
    void cleanupGeneratedDocument(item);
    setItems((current) => current.filter((candidate) => candidate.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }

  function retryItems(candidates: QueueItem[]) {
    if (queueRunningRef.current) return;
    const retryable = candidates.filter(
      (item) => canRetryJob(item) && !retryingIdsRef.current.has(item.id),
    );
    if (!retryable.length) return;
    const fresh = retryable.map((item) => {
      retryingIdsRef.current.add(item.id);
      const retry = retryQueueItem(item);
      // 批次里已修改的设置优先，历史记录本身保持当次快照。
      if (items.some((current) => current.id === item.id)) retry.settings = { ...item.settings };
      void cleanupGeneratedDocument(item);
      return retry;
    });
    setHistoryItems((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of retryable) if (!byId.has(item.id)) byId.set(item.id, item);
      return [...byId.values()];
    });
    setItems((current) => [
      ...current.filter((item) => !retryable.some((old) => old.id === item.id)),
      ...fresh,
    ]);
    setSelectedId(fresh[0].id);
    setHistoryOpen(false);
    setNotice(copy.retryHint);
  }

  async function inspectHistory(item: QueueItem) {
    if (!item.systemJobId || item.systemReasons || statusRequestsRef.current.has(item.systemJobId))
      return;
    statusRequestsRef.current.add(item.systemJobId);
    try {
      const status = await invoke<PrintStatus>("get_print_job_status", { jobId: item.systemJobId });
      setHistoryItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                systemReasons: status.reasons,
                systemMessage: status.message,
                statusUnavailable: false,
              }
            : candidate,
        ),
      );
    } catch {
      setHistoryItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, statusUnavailable: true } : candidate,
        ),
      );
    } finally {
      statusRequestsRef.current.delete(item.systemJobId);
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
          locked={queueRunning}
          onRemove={removeItem}
          onRetry={(item) => retryItems([item])}
          onRetryFailed={() => retryItems(items.filter((item) => item.state === "failed"))}
          onClearFinished={() =>
            items
              .filter((item) => item.state === "completed")
              .forEach((item) => removeItem(item.id))
          }
        />

        <PdfPreviewPanel
          selected={selected}
          queueRunning={queueRunning}
          labels={copy}
          onRemove={removeItem}
        />

        <PrintSettingsPanel
          labels={copy}
          printers={printers}
          selectedPrinter={selectedPrinter}
          printerCapabilities={printerCapabilities}
          printerStatus={printerStatus}
          printerStatusUnavailable={printerStatusUnavailable}
          selected={selected}
          itemsLength={items.length}
          settings={settings}
          pendingCount={pending.length}
          activeItems={active}
          printEstimate={printEstimate}
          queueRunning={queueRunning}
          queuePaused={queuePaused}
          onReset={() => {
            changeSetting(DEFAULT_SETTINGS);
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
          onChangeRenderOptions={(patch) => {
            if (selected) updateRenderOptions(selected.id, patch);
          }}
          onStartQueue={openPrintReview}
          onToggleQueuePause={() => {
            if (queuePaused) {
              openPrintReview();
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
          locale={locale}
          onRetry={(item) => retryItems([item])}
          canRetry={(item) => !queueRunning && !retryingIdsRef.current.has(item.id)}
          onInspect={(item) => void inspectHistory(item)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {review && (
        <PrintReviewDialog
          items={review.items}
          printer={review.printer}
          capabilities={printerCapabilities}
          labels={copy}
          onClose={() => setReview(null)}
          onConfirm={() => void startQueue()}
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
