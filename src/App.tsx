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
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
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

const DEFAULT_SETTINGS: PrintSettings = {
  copies: 1,
  duplex: "long",
  color: "auto",
  orientation: "auto",
  media: "A4",
  scale: "fit",
};

const STATE_LABEL: Record<JobState, string> = {
  queued: "Ready",
  submitting: "Submitting",
  submitted: "Submitted",
  printing: "Printing",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Needs attention",
};

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

  const addPaths = useCallback(async (paths: string[]) => {
    const pdfPaths = paths.filter((path) => path.toLowerCase().endsWith(".pdf"));
    if (!pdfPaths.length) return;
    try {
      const info = await invoke<PdfInfo[]>("inspect_pdfs", { paths: pdfPaths });
      const fresh = info.map(createQueueItem);
      setItems((current) => [...current, ...fresh]);
      setSelectedId((current) => current ?? fresh[0]?.id ?? null);
      setNotice(null);
    } catch (error) {
      setNotice(`Could not add files: ${String(error)}`);
    }
  }, []);

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
    if (!selectedPrinter) return setNotice("Select a printer before starting the queue.");
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
      setNotice(`Cancel request failed: ${String(error)}`);
    }
  }

  const settings = selected?.settings ?? batchSettings;
  const changeSetting = (patch: Partial<PrintSettings>) =>
    selected ? updateItemSettings(selected.id, patch) : applyBatchSettings(patch);

  return (
    <main className="app-shell">
      <header
        className="topbar"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest("button")) return;
          void getCurrentWindow()
            .startDragging()
            .catch((error) => setNotice(`Window drag failed: ${String(error)}`));
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
        <div className="transport" aria-label="Queue status">
          <div className="transport-item">
            <span className="transport-light ready" />
            <span>Ready</span>
            <strong>{pending.length}</strong>
          </div>
          <div className="transport-item">
            <span className="transport-light active" />
            <span>Active</span>
            <strong>{active.length}</strong>
          </div>
          <div className="transport-item">
            <span className="transport-light done" />
            <span>Done</span>
            <strong>{completed.length}</strong>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <Archive size={16} /> History
          </button>
          <button className="icon-button" type="button" aria-label="Settings">
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
              <h1>Print queue</h1>
              <span className="panel-caption">{items.length} documents in this batch</span>
            </div>
            <button className="add-button" type="button" onClick={() => void chooseFiles()}>
              <Plus size={17} /> Add PDF
            </button>
          </div>
          <div className="search-row">
            <Search size={15} />
            <input
              name="queue-search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find in this batch"
              aria-label="Search documents"
            />
            <span>{items.length}</span>
          </div>
          <div className={`file-list ${isDragging ? "drag-active" : ""}`}>
            {!items.length ? (
              <button className="drop-zone" type="button" onClick={() => void chooseFiles()}>
                <div className="drop-icon">
                  <FilePlus2 size={24} />
                </div>
                <strong>Drop PDFs here</strong>
                <span>or choose files from your Mac</span>
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
                      {item.pages ? `${item.pages} pages` : "Pages unknown"} ·{" "}
                      {formatBytes(item.sizeBytes)}
                    </span>
                  </div>
                  <div className={`job-state state-${item.state}`}>
                    <StatusIcon state={item.state} />
                    <span>{STATE_LABEL[item.state]}</span>
                  </div>
                  <MoreHorizontal size={16} />
                </button>
              ))
            )}
          </div>
          <div className="queue-summary">
            <div>
              <span>Ready</span>
              <strong>{pending.length}</strong>
            </div>
            <div>
              <span>In progress</span>
              <strong>{active.length}</strong>
            </div>
            <div>
              <span>Done</span>
              <strong>{completed.length}</strong>
            </div>
          </div>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div className="document-title">
              <span className="surface-label">Paper stage</span>
              <strong>{selected?.name ?? "No document selected"}</strong>
            </div>
            {selected && (
              <button
                className="icon-button danger-hover"
                type="button"
                title="Remove"
                aria-label="Remove selected PDF"
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
                title={`Preview ${selected.name}`}
                src={convertFileSrc(selected.path)}
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-sheet">
                  <span />
                  <span />
                  <span />
                </div>
                <p>Your selected PDF appears here.</p>
              </div>
            )}
          </div>
          {selected && (
            <div className="preview-footer">
              <span>{selected.pages ? `${selected.pages} pages` : "PDF document"}</span>
              <span>Preview only · print output follows printer capabilities</span>
            </div>
          )}
        </section>

        <aside className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Print setup</h2>
              <span className="panel-caption">Tune batch defaults or this file</span>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setBatchSettings({ ...DEFAULT_SETTINGS });
                if (selected) updateItemSettings(selected.id, DEFAULT_SETTINGS);
              }}
              title="Reset"
              aria-label="Reset print settings"
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="setting-section printer-section">
            <label>Printer</label>
            <div className="select-shell prominent">
              <Printer size={17} />
              <select
                aria-label="Printer"
                value={selectedPrinter}
                onChange={(event) => setSelectedPrinter(event.target.value)}
              >
                {!printers.length && <option value="">No printers found</option>}
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.name}
                    {printer.isDefault ? " — Default" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <div className="printer-meta">
              <span className="online-dot" />
              <span>
                {printers.find((printer) => printer.name === selectedPrinter)?.state ??
                  "Not connected"}
              </span>
              <button type="button" onClick={() => void refreshPrinters()}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          <div className="scope-switch">
            <button
              className={!selected ? "active" : ""}
              type="button"
              onClick={() => setSelectedId(null)}
            >
              <Layers3 size={14} /> Batch
            </button>
            <button
              className={selected ? "active" : ""}
              type="button"
              disabled={!items.length}
              onClick={() => setSelectedId(items[0]?.id ?? null)}
            >
              <FileText size={14} /> File
            </button>
          </div>
          <div className="settings-scroll">
            <div className="setting-section">
              <div className="setting-row">
                <label>Copies</label>
                <div className="stepper">
                  <button
                    aria-label="Decrease copies"
                    type="button"
                    onClick={() => changeSetting({ copies: Math.max(1, settings.copies - 1) })}
                  >
                    −
                  </button>
                  <span>{settings.copies}</span>
                  <button
                    aria-label="Increase copies"
                    type="button"
                    onClick={() => changeSetting({ copies: Math.min(99, settings.copies + 1) })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <label>Paper</label>
                <div className="select-shell compact">
                  <select
                    aria-label="Paper size"
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
                <label>Orientation</label>
                <div className="segmented">
                  <button
                    className={settings.orientation === "auto" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "auto" })}
                  >
                    Auto
                  </button>
                  <button
                    className={settings.orientation === "portrait" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "portrait" })}
                  >
                    Portrait
                  </button>
                  <button
                    className={settings.orientation === "landscape" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ orientation: "landscape" })}
                  >
                    Landscape
                  </button>
                </div>
              </div>
            </div>
            <div className="setting-section">
              <div className="setting-row">
                <label>Two-sided</label>
                <div className="select-shell compact">
                  <select
                    aria-label="Two-sided printing"
                    value={settings.duplex}
                    onChange={(event) =>
                      changeSetting({ duplex: event.target.value as PrintSettings["duplex"] })
                    }
                  >
                    <option value="none">Off</option>
                    <option value="long">Long edge</option>
                    <option value="short">Short edge</option>
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <div className="setting-row">
                <label>Color</label>
                <div className="segmented">
                  <button
                    className={settings.color === "auto" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ color: "auto" })}
                  >
                    Auto
                  </button>
                  <button
                    className={settings.color === "color" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ color: "color" })}
                  >
                    Color
                  </button>
                  <button
                    className={settings.color === "grayscale" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ color: "grayscale" })}
                  >
                    Gray
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <label>Scale</label>
                <div className="segmented">
                  <button
                    className={settings.scale === "fit" ? "active" : ""}
                    type="button"
                    onClick={() => changeSetting({ scale: "fit" })}
                  >
                    Fit
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
                  <strong>Office standard</strong>
                  <small>A4 · Duplex · Fit</small>
                </span>
              </div>
              <button type="button">Save preset</button>
            </div>
          </div>
          <div className="print-actions">
            <div className="submission-note">
              <span />
              <p>
                <strong>System submission is tracked separately.</strong> Completion appears only
                after macOS reports the job finished.
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
                  {queuePaused ? "Resume" : "Pause"}
                </button>
              )}
              <button
                className="print-button"
                type="button"
                disabled={!pending.length || !selectedPrinter}
                onClick={() => void startQueue()}
              >
                <Printer size={17} /> Print {pending.length || ""}{" "}
                {pending.length === 1 ? "file" : "files"}
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
                <small>Cancel</small>
              </button>
            ))}
          </div>
        </aside>
      </section>

      {historyOpen && (
        <div className="history-drawer">
          <div className="drawer-heading">
            <div>
              <h2>Print history</h2>
              <span className="panel-caption">Finished, cancelled & failed jobs</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close print history"
              onClick={() => setHistoryOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          {!items.some((item) => ["completed", "cancelled", "failed"].includes(item.state)) ? (
            <div className="drawer-empty">Finished jobs will collect here.</div>
          ) : (
            items
              .filter((item) => ["completed", "cancelled", "failed"].includes(item.state))
              .map((item) => (
                <div className="history-row" key={item.id}>
                  <FileText size={16} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {STATE_LABEL[item.state]}
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
