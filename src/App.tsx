import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FilePlus2,
  FileText,
  GripVertical,
  Layers3,
  LoaderCircle,
  Languages,
  MoreHorizontal,
  Moon,
  Pause,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

type PdfInfo = { path: string; name: string; sizeBytes: number; pages: number | null };
type PrinterInfo = { name: string; isDefault: boolean; state: string };
type JobState =
  | "queued"
  | "submitting"
  | "submitted"
  | "printing"
  | "completed"
  | "cancelled"
  | "failed";
type PrintSettings = {
  copies: number;
  duplex: "none" | "long" | "short";
  color: "auto" | "color" | "grayscale";
  orientation: "auto" | "portrait" | "landscape";
  media: string;
  scale: "fit" | "actual";
};
type QueueItem = PdfInfo & {
  id: string;
  settings: PrintSettings;
  state: JobState;
  systemJobId?: string;
  error?: string;
};
type SubmitResult = { jobId: string; raw: string };
type Theme = "dark" | "light";
type Locale = "en" | "zh-CN";

const DEFAULT_SETTINGS: PrintSettings = {
  copies: 1,
  duplex: "long",
  color: "auto",
  orientation: "auto",
  media: "A4",
  scale: "fit",
};

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
    officeStandard: "Office standard",
    presetDetail: "A4 · Duplex · Fit",
    savePreset: "Save preset",
    submissionTitle: "System submission is tracked separately.",
    submissionBody: "Completion appears only after macOS reports the job finished.",
    resume: "Resume",
    pause: "Pause",
    printFiles: (count: number) => `Print ${count || ""} ${count === 1 ? "file" : "files"}`,
    cancel: "Cancel",
    printHistory: "Print history",
    historyCaption: "Finished, cancelled & failed jobs",
    closeHistory: "Close print history",
    historyEmpty: "Finished jobs will collect here.",
    selectPrinter: "Select a printer before starting the queue.",
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
    officeStandard: "办公标准",
    presetDetail: "A4 · 双面 · 适合页面",
    savePreset: "保存预设",
    submissionTitle: "系统提交与打印完成分开追踪。",
    submissionBody: "仅在 macOS 报告任务完成后才会显示为已完成。",
    resume: "继续",
    pause: "暂停",
    printFiles: (count: number) => `打印 ${count || ""} 个文件`,
    cancel: "取消",
    printHistory: "打印历史",
    historyCaption: "已完成、已取消和失败的任务",
    closeHistory: "关闭打印历史",
    historyEmpty: "已结束的任务会显示在这里。",
    selectPrinter: "开始队列前请先选择打印机。",
    addFilesError: (error: unknown) => `无法添加文件：${String(error)}`,
    cancelError: (error: unknown) => `取消任务失败：${String(error)}`,
    dragError: (error: unknown) => `窗口拖动失败：${String(error)}`,
    themeLight: "切换到亮色主题",
    themeDark: "切换到暗色主题",
    language: "切换语言",
  },
} as const;

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createQueueItem(pdf: PdfInfo): QueueItem {
  return { ...pdf, id: crypto.randomUUID(), settings: { ...DEFAULT_SETTINGS }, state: "queued" };
}

function StatusIcon({ state }: { state: JobState }) {
  if (state === "completed") return <Check size={14} />;
  if (state === "failed") return <CircleAlert size={14} />;
  if (state === "submitting" || state === "printing")
    return <LoaderCircle className="spin" size={14} />;
  if (state === "cancelled") return <X size={14} />;
  if (state === "submitted") return <Clock3 size={14} />;
  return <span className="status-dot" />;
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("pliflo-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [locale, setLocale] = useState<Locale>(() =>
    localStorage.getItem("pliflo-locale") === "zh-CN" || navigator.language.startsWith("zh")
      ? "zh-CN"
      : "en",
  );
  const [items, setItems] = useState<QueueItem[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batchSettings, setBatchSettings] = useState<PrintSettings>({ ...DEFAULT_SETTINGS });
  const [queuePaused, setQueuePaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const pending = items.filter((item) => ["queued", "failed", "cancelled"].includes(item.state));
  const active = items.filter((item) =>
    ["submitting", "submitted", "printing"].includes(item.state),
  );
  const completed = items.filter((item) => item.state === "completed");
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
  }, [items, search]);

  useEffect(() => {
    localStorage.setItem("pliflo-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("pliflo-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const refreshPrinters = useCallback(async () => {
    try {
      const result = await invoke<PrinterInfo[]>("list_printers");
      setPrinters(result);
      setSelectedPrinter(
        (current) =>
          current || result.find((printer) => printer.isDefault)?.name || result[0]?.name || "",
      );
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

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
                if (state === "completed") return { ...candidate, state: "completed" };
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
    if (!selectedPrinter) return setNotice(copy.selectPrinter);
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, state: "submitting", error: undefined }
          : candidate,
      ),
    );
    try {
      const result = await invoke<SubmitResult>("submit_print_job", {
        path: item.path,
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
    } catch (error) {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "failed", error: String(error) }
            : candidate,
        ),
      );
    }
  }

  async function startQueue() {
    if (queuePaused) setQueuePaused(false);
    for (const item of pending) await submitOne(item);
  }

  async function cancelJob(item: QueueItem) {
    try {
      if (item.systemJobId) await invoke("cancel_print_job", { jobId: item.systemJobId });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, state: "cancelled" } : candidate,
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
    <main className="app-shell" data-theme={theme}>
      <header
        className="topbar"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest("button")) return;
          void getCurrentWindow()
            .startDragging()
            .catch((error) => setNotice(copy.dragError(error)));
        }}
      >
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="brand-name">Pliflo</span>
          <span className="brand-tag">PRINT FLOW</span>
        </div>
        <div className="transport" aria-label={copy.queueStatus}>
          <div className="transport-item">
            <span className="transport-light ready" />
            <span>{copy.ready}</span>
            <strong>{pending.length}</strong>
          </div>
          <div className="transport-item">
            <span className="transport-light active" />
            <span>{copy.active}</span>
            <strong>{active.length}</strong>
          </div>
          <div className="transport-item">
            <span className="transport-light done" />
            <span>{copy.done}</span>
            <strong>{completed.length}</strong>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <Archive size={16} /> {copy.history}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={theme === "dark" ? copy.themeLight : copy.themeDark}
            title={theme === "dark" ? copy.themeLight : copy.themeDark}
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="language-button"
            type="button"
            aria-label={copy.language}
            title={copy.language}
            onClick={() => setLocale((value) => (value === "en" ? "zh-CN" : "en"))}
          >
            <Languages size={16} />
            <span>{locale === "en" ? "中" : "EN"}</span>
          </button>
          <button className="icon-button" type="button" aria-label={copy.settings}>
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice-bar" aria-live="polite">
          <CircleAlert size={15} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="workspace">
        <aside className="queue-panel">
          <div className="panel-heading">
            <div>
              <h1>{copy.printQueue}</h1>
              <span className="panel-caption">{copy.documentsInBatch(items.length)}</span>
            </div>
            <button className="add-button" type="button" onClick={() => void chooseFiles()}>
              <Plus size={17} /> {copy.addPdf}
            </button>
          </div>
          <div className="search-row">
            <Search size={15} />
            <input
              name="queue-search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.findBatch}
              aria-label={copy.searchDocuments}
            />
            <span>{items.length}</span>
          </div>
          <div className={`file-list ${isDragging ? "drag-active" : ""}`}>
            {!items.length ? (
              <button className="drop-zone" type="button" onClick={() => void chooseFiles()}>
                <div className="drop-icon">
                  <FilePlus2 size={24} />
                </div>
                <strong>{copy.dropPdfs}</strong>
                <span>{copy.chooseMac}</span>
              </button>
            ) : (
              visibleItems.map((item, index) => (
                <button
                  className={`file-row ${selected?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                >
                  <GripVertical className="drag-handle" size={15} />
                  <div className="file-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="pdf-icon">
                    <FileText size={17} />
                  </div>
                  <div className="file-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.pages ? copy.pages(item.pages) : copy.pagesUnknown} ·{" "}
                      {formatBytes(item.sizeBytes)}
                    </span>
                  </div>
                  <div className={`job-state state-${item.state}`}>
                    <StatusIcon state={item.state} />
                    <span>{stateLabel[item.state]}</span>
                  </div>
                  <MoreHorizontal size={16} />
                </button>
              ))
            )}
          </div>
          <div className="queue-summary">
            <div>
              <span>{copy.ready}</span>
              <strong>{pending.length}</strong>
            </div>
            <div>
              <span>{copy.inProgress}</span>
              <strong>{active.length}</strong>
            </div>
            <div>
              <span>{copy.done}</span>
              <strong>{completed.length}</strong>
            </div>
          </div>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div className="document-title">
              <span className="surface-label">{copy.paperStage}</span>
              <strong>{selected?.name ?? copy.noDocument}</strong>
            </div>
            {selected && (
              <button
                className="icon-button danger-hover"
                type="button"
                title={copy.remove}
                aria-label={copy.removePdf}
                onClick={() => {
                  setItems((current) => current.filter((item) => item.id !== selected.id));
                  setSelectedId(null);
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <div className="preview-stage">
            {selected ? (
              <iframe
                className="pdf-preview"
                title={copy.previewTitle(selected.name)}
                src={convertFileSrc(selected.path)}
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-sheet">
                  <span />
                  <span />
                  <span />
                </div>
                <p>{copy.previewEmpty}</p>
              </div>
            )}
          </div>
          {selected && (
            <div className="preview-footer">
              <span>{selected.pages ? copy.pages(selected.pages) : copy.pdfDocument}</span>
              <span>{copy.previewNote}</span>
            </div>
          )}
        </section>

        <aside className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2>{copy.printSetup}</h2>
              <span className="panel-caption">{copy.setupCaption}</span>
            </div>
            <button
              className="icon-button"
              type="button"
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
                onChange={(event) => setSelectedPrinter(event.target.value)}
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
              <span className="online-dot" />
              <span>
                {printers.find((printer) => printer.name === selectedPrinter)?.state ??
                  copy.notConnected}
              </span>
              <button type="button" onClick={() => void refreshPrinters()}>
                <RefreshCw size={13} /> {copy.refresh}
              </button>
            </div>
          </div>
          <div className="scope-switch">
            <button
              className={!selected ? "active" : ""}
              type="button"
              onClick={() => setSelectedId(null)}
            >
              <Layers3 size={14} /> {copy.batch}
            </button>
            <button
              className={selected ? "active" : ""}
              type="button"
              disabled={!items.length}
              onClick={() => setSelectedId(items[0]?.id ?? null)}
            >
              <FileText size={14} /> {copy.file}
            </button>
          </div>
          <div className="settings-scroll">
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
                    <option>A4</option>
                    <option>Letter</option>
                    <option>Legal</option>
                  </select>
                  <ChevronDown size={14} />
                </div>
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
                    {copy.auto}
                  </button>
                  <button
                    className={settings.color === "color" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ color: "color" })}
                  >
                    {copy.color}
                  </button>
                  <button
                    className={settings.color === "grayscale" ? "active" : ""}
                    type="button"
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
            <div className="preset-card">
              <div>
                <SlidersHorizontal size={15} />
                <span>
                  <strong>{copy.officeStandard}</strong>
                  <small>{copy.presetDetail}</small>
                </span>
              </div>
              <button type="button">{copy.savePreset}</button>
            </div>
          </div>
          <div className="print-actions">
            <div className="submission-note">
              <span />
              <p>
                <strong>{copy.submissionTitle}</strong> {copy.submissionBody}
              </p>
            </div>
            <div className="action-row">
              {active.length > 0 && (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setQueuePaused((value) => !value)}
                >
                  {queuePaused ? <Play size={16} /> : <Pause size={16} />}
                  {queuePaused ? copy.resume : copy.pause}
                </button>
              )}
              <button
                className="print-button"
                type="button"
                disabled={!pending.length || !selectedPrinter}
                onClick={() => void startQueue()}
              >
                <Printer size={17} /> {copy.printFiles(pending.length)}
              </button>
            </div>
            {active.map((item) => (
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
          {!items.some((item) => ["completed", "cancelled", "failed"].includes(item.state)) ? (
            <div className="drawer-empty">{copy.historyEmpty}</div>
          ) : (
            items
              .filter((item) => ["completed", "cancelled", "failed"].includes(item.state))
              .map((item) => (
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
    </main>
  );
}

export default App;
