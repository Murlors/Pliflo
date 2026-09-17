import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  CircleAlert,
  FileText,
  Layers3,
  Pause,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from "./app/constants";
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
import { AppTopbar } from "./components/AppTopbar";
import { PdfPreviewPanel } from "./components/PdfPreviewPanel";
import { QueuePanel } from "./components/QueuePanel";
import { StatusIcon } from "./components/StatusIcon";
import { createQueueItem, estimatePrintUsage, supportsPrinterChoice } from "./lib/print";
import {
  loadPreferences,
  loadStoredBatch,
  loadStoredHistory,
  recoverStoredJobId,
} from "./lib/storage";

const COPY = {
  en: {
    ready: "Ready",
    active: "Active",
    done: "Done",
    submitting: "Submitting",
    submitted: "Submitted",
    printing: "Printing",
    completed: "Completed",
    cancelled: "Cancelled",
    attention: "Needs attention",
    history: "History",
    settings: "Settings",
    queueStatus: "Queue status",
    printQueue: "Print queue",
    documentsInBatch: (count: number) => `${count} documents in this batch`,
    addPdf: "Add PDF",
    findBatch: "Find in this batch",
    searchDocuments: "Search documents",
    dropPdfs: "Drop PDFs here",
    chooseMac: "or choose files from your Mac",
    pages: (count: number) => `${count} pages`,
    pagesUnknown: "Pages unknown",
    estimatedSheets: "Estimated sheets",
    printedPages: "Printed sides",
    estimatePartial: "partial",
    inProgress: "In progress",
    paperStage: "Paper stage",
    noDocument: "No document selected",
    remove: "Remove",
    removePdf: "Remove selected PDF",
    previewTitle: (name: string) => `Preview ${name}`,
    previewEmpty: "Your selected PDF appears here.",
    pdfDocument: "PDF document",
    previewNote: "Preview only · print output follows printer capabilities",
    printSetup: "Print setup",
    setupCaption: "Tune batch defaults or this file",
    reset: "Reset",
    resetSettings: "Reset print settings",
    printer: "Printer",
    noPrinters: "No printers found",
    defaultPrinter: "Default",
    printerDetected: "Detected",
    notConnected: "Not connected",
    refresh: "Refresh",
    batch: "Batch",
    file: "File",
    copies: "Copies",
    decreaseCopies: "Decrease copies",
    increaseCopies: "Increase copies",
    paper: "Paper",
    paperSize: "Paper size",
    orientation: "Orientation",
    auto: "Auto",
    portrait: "Portrait",
    landscape: "Landscape",
    twoSided: "Two-sided",
    twoSidedPrinting: "Two-sided printing",
    off: "Off",
    longEdge: "Long edge",
    shortEdge: "Short edge",
    color: "Color",
    gray: "Gray",
    scale: "Scale",
    fit: "Fit",
    printerDefault: "Printer default",
    pageRange: "Pages",
    outputPageRange: "Output pages",
    pageRangePlaceholder: "All or 1-3, 5",
    advanced: "Advanced",
    pagesPerSheet: "Pages / sheet",
    pageSet: "Page set",
    outputPageSet: "Output page set",
    allPages: "All pages",
    oddPages: "Odd only",
    evenPages: "Even only",
    reverseOrder: "Reverse order",
    paperSource: "Paper source",
    printQuality: "Print quality",
    qualityDraft: "Draft",
    qualityNormal: "Normal",
    qualityHigh: "High",
    officeStandard: "Office standard",
    presetDetail: "A4 · Duplex · Fit",
    savePreset: "Save preset",
    submissionTitle: "System submission is tracked separately.",
    submissionBody: "Completion appears only after macOS reports the job finished.",
    resumeQueue: "Resume queue",
    pauseQueue: "Pause queue",
    printFiles: (count: number) => `Print ${count || ""} ${count === 1 ? "file" : "files"}`,
    cancel: "Cancel",
    printHistory: "Print history",
    historyCaption: "Finished, cancelled & failed jobs",
    closeHistory: "Close print history",
    historyEmpty: "Finished jobs will collect here.",
    settingsCaption: "App behavior and appearance",
    closeSettings: "Close settings",
    appearance: "Appearance",
    theme: "Theme",
    themeSystem: "System",
    themeLightLabel: "Light",
    themeDarkLabel: "Dark",
    languageLabel: "Language",
    english: "English",
    chinese: "中文",
    printingBehavior: "Printing",
    printerPreference: "Default printer",
    useSystemPrinter: "System default",
    useLastPrinter: "Last used",
    behavior: "Behavior & history",
    restoreBatch: "Restore unfinished batch",
    restoreBatchHint: "Only jobs that were not submitted are restored.",
    historyRetention: "Keep history",
    historySession: "This session",
    history30d: "30 days",
    historyForever: "Forever",
    clearHistory: "Clear history",
    resetAppSettings: "Reset app settings",
    selectPrinter: "Select a printer before starting the queue.",
    printerCapabilitiesUnavailable:
      "Printer capabilities are still unavailable. Refresh the printer before printing.",
    submissionError: (name: string, error: unknown) => `Could not submit ${name}: ${String(error)}`,
    addFilesError: (error: unknown) => `Could not add files: ${String(error)}`,
    cancelError: (error: unknown) => `Cancel request failed: ${String(error)}`,
    dragError: (error: unknown) => `Window drag failed: ${String(error)}`,
    themeLight: "Switch to light theme",
    themeDark: "Switch to dark theme",
    language: "Switch language",
  },
  "zh-CN": {
    ready: "待打印",
    active: "进行中",
    done: "已完成",
    submitting: "提交中",
    submitted: "已提交",
    printing: "打印中",
    completed: "已完成",
    cancelled: "已取消",
    attention: "需要处理",
    history: "历史",
    settings: "设置",
    queueStatus: "队列状态",
    printQueue: "打印队列",
    documentsInBatch: (count: number) => `本批次 ${count} 个文档`,
    addPdf: "添加 PDF",
    findBatch: "搜索本批次",
    searchDocuments: "搜索文档",
    dropPdfs: "拖入 PDF 文件",
    chooseMac: "或从 Mac 选择文件",
    pages: (count: number) => `${count} 页`,
    pagesUnknown: "页数未知",
    estimatedSheets: "预计用纸",
    printedPages: "打印面数",
    estimatePartial: "部分可计算",
    inProgress: "进行中",
    paperStage: "纸张预览",
    noDocument: "未选择文档",
    remove: "移除",
    removePdf: "移除选中的 PDF",
    previewTitle: (name: string) => `预览 ${name}`,
    previewEmpty: "选择的 PDF 将显示在这里。",
    pdfDocument: "PDF 文档",
    previewNote: "仅供预览 · 实际输出以打印机能力为准",
    printSetup: "打印设置",
    setupCaption: "调整批次默认值或当前文件",
    reset: "重置",
    resetSettings: "重置打印设置",
    printer: "打印机",
    noPrinters: "未发现打印机",
    defaultPrinter: "默认",
    printerDetected: "已检测到",
    notConnected: "未连接",
    refresh: "刷新",
    batch: "批次",
    file: "文件",
    copies: "份数",
    decreaseCopies: "减少份数",
    increaseCopies: "增加份数",
    paper: "纸张",
    paperSize: "纸张尺寸",
    orientation: "方向",
    auto: "自动",
    portrait: "纵向",
    landscape: "横向",
    twoSided: "双面打印",
    twoSidedPrinting: "双面打印方式",
    off: "关闭",
    longEdge: "长边翻转",
    shortEdge: "短边翻转",
    color: "彩色",
    gray: "灰度",
    scale: "缩放",
    fit: "适合页面",
    printerDefault: "跟随打印机",
    pageRange: "页码范围",
    outputPageRange: "输出页范围",
    pageRangePlaceholder: "全部或 1-3, 5",
    advanced: "高级",
    pagesPerSheet: "每张页数",
    pageSet: "奇偶页",
    outputPageSet: "输出页奇偶",
    allPages: "全部",
    oddPages: "仅奇数页",
    evenPages: "仅偶数页",
    reverseOrder: "逆序打印",
    paperSource: "纸张来源",
    printQuality: "打印质量",
    qualityDraft: "草稿",
    qualityNormal: "标准",
    qualityHigh: "高质量",
    officeStandard: "办公标准",
    presetDetail: "A4 · 双面 · 适合页面",
    savePreset: "保存预设",
    submissionTitle: "系统提交与打印完成分开追踪。",
    submissionBody: "仅在 macOS 报告任务完成后才会显示为已完成。",
    resumeQueue: "继续提交",
    pauseQueue: "暂停提交",
    printFiles: (count: number) => `打印 ${count || ""} 个文件`,
    cancel: "取消",
    printHistory: "打印历史",
    historyCaption: "已完成、已取消和失败的任务",
    closeHistory: "关闭打印历史",
    historyEmpty: "已结束的任务会显示在这里。",
    settingsCaption: "应用行为与外观",
    closeSettings: "关闭设置",
    appearance: "外观",
    theme: "主题",
    themeSystem: "跟随系统",
    themeLightLabel: "亮色",
    themeDarkLabel: "暗色",
    languageLabel: "语言",
    english: "English",
    chinese: "中文",
    printingBehavior: "打印",
    printerPreference: "默认打印机",
    useSystemPrinter: "系统默认",
    useLastPrinter: "上次使用",
    behavior: "行为与历史",
    restoreBatch: "恢复未完成批次",
    restoreBatchHint: "仅恢复尚未提交到系统的任务。",
    historyRetention: "历史保留",
    historySession: "仅本次运行",
    history30d: "30 天",
    historyForever: "永久",
    clearHistory: "清空历史",
    resetAppSettings: "重置应用设置",
    selectPrinter: "开始队列前请先选择打印机。",
    printerCapabilitiesUnavailable: "暂未读取到打印机能力，请刷新打印机后再打印。",
    submissionError: (name: string, error: unknown) => `无法提交 ${name}：${String(error)}`,
    addFilesError: (error: unknown) => `无法添加文件：${String(error)}`,
    cancelError: (error: unknown) => `取消任务失败：${String(error)}`,
    dragError: (error: unknown) => `窗口拖动失败：${String(error)}`,
    themeLight: "切换到亮色主题",
    themeDark: "切换到暗色主题",
    language: "切换语言",
  },
} as const;

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
  const printSettingsLocked = queueRunning;
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
    <main className="app-shell flex h-full min-h-0 flex-col" data-theme={theme}>
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
        <div className="notice-bar" aria-live="polite">
          <CircleAlert size={15} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="workspace min-h-0 flex-1">
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

        <aside className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2>{copy.printSetup}</h2>
              <span className="panel-caption">{copy.setupCaption}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={printSettingsLocked}
              onClick={() => {
                setBatchSettings({ ...DEFAULT_SETTINGS });
                if (selected) updateItemSettings(selected.id, DEFAULT_SETTINGS);
              }}
              title={copy.reset}
              aria-label={copy.resetSettings}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="setting-section printer-section">
            <label>{copy.printer}</label>
            <div className="select-shell prominent">
              <Printer size={17} />
              <select
                aria-label={copy.printer}
                value={selectedPrinter}
                disabled={queueRunning}
                onChange={(event) => {
                  setPrinterCapabilities(null);
                  setSelectedPrinter(event.target.value);
                  if (preferences.printerPreference === "last") {
                    localStorage.setItem("pliflo-last-printer", event.target.value);
                  }
                }}
              >
                {!printers.length && <option value="">{copy.noPrinters}</option>}
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.name}
                    {printer.isDefault ? ` — ${copy.defaultPrinter}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <div className="printer-meta">
              <span className="printer-state-dot" />
              <span>
                {printers.find((printer) => printer.name === selectedPrinter)?.state === "detected"
                  ? copy.printerDetected
                  : copy.notConnected}
              </span>
              <button type="button" disabled={queueRunning} onClick={() => void refreshPrinters()}>
                <RefreshCw size={13} /> {copy.refresh}
              </button>
            </div>
          </div>
          <div className="scope-switch">
            <button
              className={!selected ? "active" : ""}
              type="button"
              disabled={printSettingsLocked}
              onClick={() => setSelectedId(null)}
            >
              <Layers3 size={14} /> {copy.batch}
            </button>
            <button
              className={selected ? "active" : ""}
              type="button"
              disabled={!items.length || printSettingsLocked}
              onClick={() => setSelectedId(items[0]?.id ?? null)}
            >
              <FileText size={14} /> {copy.file}
            </button>
          </div>
          <fieldset className="settings-scroll settings-fieldset" disabled={printSettingsLocked}>
            <div className="setting-section">
              <div className="setting-row">
                <label>{copy.copies}</label>
                <div className="stepper">
                  <button
                    aria-label={copy.decreaseCopies}
                    type="button"
                    onClick={() => changeSetting({ copies: Math.max(1, settings.copies - 1) })}
                  >
                    −
                  </button>
                  <span>{settings.copies}</span>
                  <button
                    aria-label={copy.increaseCopies}
                    type="button"
                    onClick={() => changeSetting({ copies: Math.min(99, settings.copies + 1) })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <label>{copy.paper}</label>
                <div className="select-shell compact">
                  <select
                    aria-label={copy.paperSize}
                    value={settings.media}
                    onChange={(event) => changeSetting({ media: event.target.value })}
                  >
                    {(printerCapabilities?.media.length
                      ? printerCapabilities.media
                      : [
                          { value: "A4", label: "A4", isDefault: true },
                          { value: "Letter", label: "Letter", isDefault: false },
                          { value: "Legal", label: "Legal", isDefault: false },
                        ]
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <div className="setting-row">
                <label>{settings.pagesPerSheet > 1 ? copy.outputPageRange : copy.pageRange}</label>
                <input
                  className="compact-input"
                  inputMode="numeric"
                  value={settings.pageRange}
                  placeholder={copy.pageRangePlaceholder}
                  onChange={(event) => changeSetting({ pageRange: event.target.value })}
                />
              </div>
              <div className="setting-row">
                <label>{copy.orientation}</label>
                <div className="segmented">
                  <button
                    className={settings.orientation === "auto" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "auto" })}
                  >
                    {copy.auto}
                  </button>
                  <button
                    className={settings.orientation === "portrait" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "portrait" })}
                  >
                    {copy.portrait}
                  </button>
                  <button
                    className={settings.orientation === "landscape" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "landscape" })}
                  >
                    {copy.landscape}
                  </button>
                </div>
              </div>
            </div>
            <div className="setting-section">
              <div className="setting-row">
                <label>{copy.twoSided}</label>
                <div className="select-shell compact">
                  <select
                    aria-label={copy.twoSidedPrinting}
                    value={settings.duplex}
                    disabled={!printerCapabilities || !printerCapabilities.supportsDuplex}
                    onChange={(event) =>
                      changeSetting({ duplex: event.target.value as PrintSettings["duplex"] })
                    }
                  >
                    <option value="none">{copy.off}</option>
                    <option value="long">{copy.longEdge}</option>
                    <option value="short">{copy.shortEdge}</option>
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <div className="setting-row">
                <label>{copy.color}</label>
                <div className="segmented">
                  <button
                    className={settings.color === "auto" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ color: "auto" })}
                  >
                    {copy.printerDefault}
                  </button>
                  <button
                    className={settings.color === "color" ? "active" : ""}
                    type="button"
                    disabled={!printerCapabilities || !printerCapabilities.supportsColor}
                    onClick={() => changeSetting({ color: "color" })}
                  >
                    {copy.color}
                  </button>
                  <button
                    className={settings.color === "grayscale" ? "active" : ""}
                    type="button"
                    disabled={!printerCapabilities || !printerCapabilities.supportsColor}
                    onClick={() => changeSetting({ color: "grayscale" })}
                  >
                    {copy.gray}
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <label>{copy.scale}</label>
                <div className="segmented">
                  <button
                    className={settings.scale === "fit" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ scale: "fit" })}
                  >
                    {copy.fit}
                  </button>
                  <button
                    className={settings.scale === "actual" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ scale: "actual" })}
                  >
                    100%
                  </button>
                </div>
              </div>
            </div>
            <details className="advanced-settings">
              <summary>
                <span>
                  <SlidersHorizontal size={15} /> {copy.advanced}
                </span>
                <ChevronDown size={15} />
              </summary>
              <div className="advanced-settings-body">
                <div className="setting-row">
                  <label>{copy.pagesPerSheet}</label>
                  <div className="select-shell compact">
                    <select
                      value={settings.pagesPerSheet}
                      onChange={(event) =>
                        changeSetting({
                          pagesPerSheet: Number(
                            event.target.value,
                          ) as PrintSettings["pagesPerSheet"],
                        })
                      }
                    >
                      {[1, 2, 4, 6, 9, 16].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>
                <div className="setting-row">
                  <label>{settings.pagesPerSheet > 1 ? copy.outputPageSet : copy.pageSet}</label>
                  <div className="select-shell compact">
                    <select
                      value={settings.pageSet}
                      onChange={(event) =>
                        changeSetting({ pageSet: event.target.value as PrintSettings["pageSet"] })
                      }
                    >
                      <option value="all">{copy.allPages}</option>
                      <option value="odd">{copy.oddPages}</option>
                      <option value="even">{copy.evenPages}</option>
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>
                <label className="toggle-row">
                  <span>{copy.reverseOrder}</span>
                  <input
                    type="checkbox"
                    checked={settings.reverse}
                    onChange={(event) => changeSetting({ reverse: event.target.checked })}
                  />
                </label>
                {!!printerCapabilities?.trays.length && (
                  <div className="setting-row">
                    <label>{copy.paperSource}</label>
                    <div className="select-shell compact">
                      <select
                        value={settings.tray}
                        onChange={(event) => changeSetting({ tray: event.target.value })}
                      >
                        <option value="">{copy.printerDefault}</option>
                        {printerCapabilities.trays.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} />
                    </div>
                  </div>
                )}
                {!!printerCapabilities?.qualities.length && (
                  <div className="setting-row">
                    <label>{copy.printQuality}</label>
                    <div className="select-shell compact">
                      <select
                        value={settings.quality}
                        onChange={(event) =>
                          changeSetting({ quality: event.target.value as PrintSettings["quality"] })
                        }
                      >
                        <option value="printer">{copy.printerDefault}</option>
                        {supportsPrinterChoice(printerCapabilities.qualities, ["Draft", "3"]) && (
                          <option value="draft">{copy.qualityDraft}</option>
                        )}
                        {supportsPrinterChoice(printerCapabilities.qualities, ["Normal", "4"]) && (
                          <option value="normal">{copy.qualityNormal}</option>
                        )}
                        {supportsPrinterChoice(printerCapabilities.qualities, [
                          "High",
                          "Best",
                          "5",
                        ]) && <option value="high">{copy.qualityHigh}</option>}
                      </select>
                      <ChevronDown size={14} />
                    </div>
                  </div>
                )}
              </div>
            </details>
          </fieldset>
          <div className="print-actions">
            <div className="print-estimate" aria-label={copy.estimatedSheets}>
              <div>
                <span>{copy.estimatedSheets}</span>
                <strong>
                  {printEstimate.unknownItems === pending.length && pending.length
                    ? "—"
                    : printEstimate.sheets}
                </strong>
              </div>
              <div>
                <span>{copy.printedPages}</span>
                <strong>
                  {printEstimate.unknownItems === pending.length && pending.length
                    ? "—"
                    : printEstimate.printedPages}
                </strong>
              </div>
              {printEstimate.unknownItems > 0 && (
                <small>
                  {copy.estimatePartial} · {printEstimate.unknownItems}
                </small>
              )}
            </div>
            <div className="submission-note">
              <span />
              <p>
                <strong>{copy.submissionTitle}</strong> {copy.submissionBody}
              </p>
            </div>
            <div className="action-row">
              {(queueRunning || queuePaused) && pending.length > 0 && (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    if (queuePaused) {
                      void startQueue();
                      return;
                    }
                    queuePausedRef.current = true;
                    setQueuePaused(true);
                  }}
                >
                  {queuePaused ? <Play size={16} /> : <Pause size={16} />}
                  {queuePaused ? copy.resumeQueue : copy.pauseQueue}
                </button>
              )}
              <button
                className="print-button"
                type="button"
                disabled={
                  !pending.length || !selectedPrinter || !printerCapabilities || queueRunning
                }
                onClick={() => void startQueue()}
              >
                <Printer size={17} /> {copy.printFiles(pending.length)}
              </button>
            </div>
            {active
              .filter((item) => item.systemJobId)
              .map((item) => (
                <button
                  className="active-job"
                  type="button"
                  key={item.id}
                  onClick={() => void cancelJob(item)}
                >
                  <span>
                    <StatusIcon state={item.state} /> {item.name}
                  </span>
                  <small>{copy.cancel}</small>
                </button>
              ))}
          </div>
        </aside>
      </section>

      {historyOpen && (
        <div className="history-drawer">
          <div className="drawer-heading">
            <div>
              <h2>{copy.printHistory}</h2>
              <span className="panel-caption">{copy.historyCaption}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={copy.closeHistory}
              onClick={() => setHistoryOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          {!history.length ? (
            <div className="drawer-empty">{copy.historyEmpty}</div>
          ) : (
            history.map((item) => (
              <div className="history-row" key={item.id}>
                <FileText size={16} />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {stateLabel[item.state]}
                    {item.systemJobId ? ` · ${item.systemJobId}` : ""}
                  </small>
                </span>
                <StatusIcon state={item.state} />
              </div>
            ))
          )}
        </div>
      )}

      {settingsOpen && (
        <div className="settings-drawer">
          <div className="drawer-heading">
            <div>
              <h2>{copy.settings}</h2>
              <span className="panel-caption">{copy.settingsCaption}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={copy.closeSettings}
              onClick={() => setSettingsOpen(false)}
            >
              <X size={17} />
            </button>
          </div>

          <div className="app-settings-section">
            <strong>{copy.appearance}</strong>
            <div className="setting-row wide-label">
              <label>{copy.theme}</label>
              <div className="segmented settings-segmented">
                {(
                  [
                    ["system", copy.themeSystem],
                    ["light", copy.themeLightLabel],
                    ["dark", copy.themeDarkLabel],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={preferences.theme === value ? "active" : ""}
                    onClick={() => setPreferences((current) => ({ ...current, theme: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row wide-label">
              <label>{copy.languageLabel}</label>
              <div className="segmented settings-segmented two">
                <button
                  type="button"
                  className={locale === "zh-CN" ? "active" : ""}
                  onClick={() => setLocale("zh-CN")}
                >
                  {copy.chinese}
                </button>
                <button
                  type="button"
                  className={locale === "en" ? "active" : ""}
                  onClick={() => setLocale("en")}
                >
                  {copy.english}
                </button>
              </div>
            </div>
          </div>

          <div className="app-settings-section">
            <strong>{copy.printingBehavior}</strong>
            <div className="setting-row wide-label">
              <label>{copy.printerPreference}</label>
              <div className="select-shell compact">
                <select
                  value={preferences.printerPreference}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      printerPreference: event.target.value as AppPreferences["printerPreference"],
                    }))
                  }
                >
                  <option value="system">{copy.useSystemPrinter}</option>
                  <option value="last">{copy.useLastPrinter}</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
          </div>

          <details className="settings-disclosure">
            <summary>
              <span>{copy.behavior}</span>
              <ChevronDown size={15} />
            </summary>
            <div className="settings-disclosure-body">
              <label className="toggle-row stacked-toggle">
                <span>
                  <strong>{copy.restoreBatch}</strong>
                  <small>{copy.restoreBatchHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.restoreBatch}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      restoreBatch: event.target.checked,
                    }))
                  }
                />
              </label>
              <div className="setting-row wide-label">
                <label>{copy.historyRetention}</label>
                <div className="select-shell compact">
                  <select
                    value={preferences.historyRetention}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        historyRetention: event.target.value as AppPreferences["historyRetention"],
                      }))
                    }
                  >
                    <option value="session">{copy.historySession}</option>
                    <option value="30d">{copy.history30d}</option>
                    <option value="forever">{copy.historyForever}</option>
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <button
                className="settings-text-button"
                type="button"
                onClick={() => {
                  for (const item of items) {
                    if (["completed", "cancelled", "failed"].includes(item.state)) {
                      archivedTerminalIdsRef.current.add(item.id);
                    }
                  }
                  setHistoryItems([]);
                  localStorage.removeItem("pliflo-history");
                }}
              >
                {copy.clearHistory}
              </button>
            </div>
          </details>

          <button
            className="settings-reset"
            type="button"
            onClick={() => {
              setPreferences(DEFAULT_PREFERENCES);
              setLocale(navigator.language.startsWith("zh") ? "zh-CN" : "en");
              localStorage.removeItem("pliflo-last-printer");
            }}
          >
            <RotateCcw size={14} /> {copy.resetAppSettings}
          </button>
        </div>
      )}
    </main>
  );
}

export default App;
