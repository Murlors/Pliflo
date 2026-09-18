import { FilePlus2, FileText, Plus, Search, RotateCcw, Trash2 } from "lucide-react";
import type { JobState, QueueItem } from "../app/types";
import { canRetryJob, formatBytes, isActiveJob } from "../lib/print";
import { StatusIcon } from "./StatusIcon";

type QueuePanelProps = {
  items: QueueItem[];
  visibleItems: QueueItem[];
  selectedId: string | null;
  search: string;
  isDragging: boolean;
  pendingCount: number;
  activeCount: number;
  completedCount: number;
  stateLabel: Record<JobState, string>;
  labels: {
    printQueue: string;
    documentsInBatch: (count: number) => string;
    addPdf: string;
    findBatch: string;
    searchDocuments: string;
    dropPdfs: string;
    chooseMac: string;
    pages: (count: number) => string;
    pagesUnknown: string;
    ready: string;
    preparing: string;
    inProgress: string;
    done: string;
    retry: string;
    retryFailed: string;
    remove: string;
    removeHint: string;
    clearFinished: string;
    noSearchResults: string;
    statusUnavailable: string;
  };
  locked: boolean;
  onRemove: (id: string) => void;
  onRetry: (item: QueueItem) => void;
  onRetryFailed: () => void;
  onClearFinished: () => void;
  onChooseFiles: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
};

export function QueuePanel({
  items,
  visibleItems,
  selectedId,
  search,
  isDragging,
  pendingCount,
  activeCount,
  completedCount,
  stateLabel,
  labels,
  onChooseFiles,
  onSearchChange,
  onSelect,
  locked,
  onRemove,
  onRetry,
  onRetryFailed,
  onClearFinished,
}: QueuePanelProps) {
  return (
    <aside className="queue-panel flex min-h-0 min-w-0 flex-col">
      <div className="panel-heading flex min-h-19.5 shrink-0 items-center justify-between gap-3 px-4 pb-3.25 pt-3.75 max-[1240px]:px-3.25">
        <div>
          <h1 className="m-0 text-lg font-680 leading-none tracking-tight">{labels.printQueue}</h1>
          <span className="panel-caption mt-1.25 block text-xs leading-snug">
            {labels.documentsInBatch(items.length)}
          </span>
        </div>
        <button
          className="add-button flex h-8.5 min-w-23 items-center justify-center gap-1.5 px-2.75 text-xs font-690"
          type="button"
          onClick={onChooseFiles}
        >
          <Plus size={17} /> {labels.addPdf}
        </button>
      </div>

      <div className="search-row mx-3 mb-1.75 mt-3 grid h-9 grid-cols-[auto_1fr_auto] items-center gap-1.75 px-2.5">
        <Search size={15} />
        <input
          className="min-w-0 w-full text-sm"
          name="queue-search"
          autoComplete="off"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={labels.findBatch}
          aria-label={labels.searchDocuments}
        />
        <span className="min-w-5.75 px-1.25 py-0.75 text-center text-xs tabular-nums">
          {items.length}
        </span>
      </div>

      {(items.some((item) => item.state === "failed") || completedCount > 0) && (
        <div className="flex flex-wrap gap-2 px-3 py-1.5">
          {items.some((item) => item.state === "failed") && (
            <button
              className="secondary-action px-2 py-1.5 text-xs"
              type="button"
              disabled={locked}
              onClick={onRetryFailed}
            >
              {labels.retryFailed}
            </button>
          )}
          {completedCount > 0 && (
            <button
              className="secondary-action px-2 py-1.5 text-xs"
              type="button"
              disabled={locked}
              onClick={onClearFinished}
              title={labels.removeHint}
            >
              {labels.clearFinished}
            </button>
          )}
        </div>
      )}

      <div
        className={`file-list min-h-0 flex-1 overflow-auto px-2 pb-3.5 pt-1.25 ${isDragging ? "drag-active" : ""}`}
      >
        {!items.length ? (
          <button
            className="drop-zone mx-1 my-2 flex min-h-52.5 w-[calc(100%-0.5rem)] flex-col items-center justify-center gap-1.75 px-4.5 py-7"
            type="button"
            onClick={onChooseFiles}
          >
            <div className="drop-icon grid h-14.5 w-12 place-items-center">
              <FilePlus2 size={24} />
            </div>
            <strong className="mt-1.75 text-sm">{labels.dropPdfs}</strong>
            <span className="text-xs">{labels.chooseMac}</span>
          </button>
        ) : (
          visibleItems.map((item) => (
            <div
              className={`file-row my-0.5 flex min-h-16 w-full items-center gap-1 py-1.75 px-2 text-left ${selectedId === item.id ? "selected" : ""}`}
              key={item.id}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-pressed={selectedId === item.id}
                onClick={() => onSelect(item.id)}
              >
                <div className="pdf-icon grid h-8.5 w-6.75 place-items-center">
                  <FileText size={17} />
                </div>
                <div className="file-copy flex min-w-0 flex-1 flex-col gap-1">
                  <strong className="truncate text-sm font-620">{item.name}</strong>
                  <span
                    className={`text-xs ${item.state === "failed" && item.error ? "file-error" : ""}`}
                  >
                    {item.state === "failed" && item.error
                      ? item.error
                      : `${item.pages ? labels.pages(item.pages) : labels.pagesUnknown} · ${formatBytes(item.sizeBytes)}`}
                  </span>
                  <div
                    className={`job-state flex self-start items-center gap-1 text-xs state-${item.state}`}
                  >
                    <StatusIcon state={item.state} />
                    <span>{item.preparing ? labels.preparing : stateLabel[item.state]}</span>
                  </div>
                  {item.statusUnavailable && (
                    <span className="file-error text-xs">{labels.statusUnavailable}</span>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 flex-col gap-1">
                {canRetryJob(item) && (
                  <button
                    type="button"
                    className="icon-button"
                    disabled={locked}
                    aria-label={`${labels.retry}: ${item.name}`}
                    title={labels.retry}
                    onClick={() => onRetry(item)}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                {!isActiveJob(item) && (
                  <button
                    type="button"
                    className="icon-button danger-hover"
                    disabled={locked}
                    aria-label={`${labels.remove}: ${item.name}`}
                    title={labels.removeHint}
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {!!items.length && !visibleItems.length && (
          <p className="px-3 py-6 text-sm">{labels.noSearchResults}</p>
        )}
      </div>

      <div className="queue-summary grid min-h-14.5 shrink-0 grid-cols-3 px-3 py-2.25">
        <div className="flex flex-col justify-center gap-0.75 pl-0.25">
          <span className="text-xs">{labels.ready}</span>
          <strong className="text-sm tabular-nums">{pendingCount}</strong>
        </div>
        <div className="flex flex-col justify-center gap-0.75 pl-2.5">
          <span className="text-xs">{labels.inProgress}</span>
          <strong className="text-sm tabular-nums">{activeCount}</strong>
        </div>
        <div className="flex flex-col justify-center gap-0.75 pl-2.5">
          <span className="text-xs">{labels.done}</span>
          <strong className="text-sm tabular-nums">{completedCount}</strong>
        </div>
      </div>
    </aside>
  );
}
