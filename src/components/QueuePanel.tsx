import { FilePlus2, FileText, GripVertical, MoreHorizontal, Plus, Search } from "lucide-react";
import type { JobState, QueueItem } from "../app/types";
import { formatBytes } from "../lib/print";
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
  };
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
          visibleItems.map((item, index) => (
            <button
              className={`file-row my-0.5 grid min-h-16 w-full grid-cols-[15px_22px_29px_minmax(0,1fr)_auto_18px] items-center gap-1.5 py-1.75 pl-0.5 pr-2 text-left ${selectedId === item.id ? "selected" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <GripVertical className="drag-handle" size={15} />
              <div className="file-index text-xs tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="pdf-icon grid h-8.5 w-6.75 place-items-center">
                <FileText size={17} />
              </div>
              <div className="file-copy flex min-w-0 flex-col gap-1">
                <strong className="truncate text-sm font-620">{item.name}</strong>
                <span
                  className={`text-xs ${item.state === "failed" && item.error ? "file-error" : ""}`}
                >
                  {item.state === "failed" && item.error
                    ? item.error
                    : `${item.pages ? labels.pages(item.pages) : labels.pagesUnknown} · ${formatBytes(item.sizeBytes)}`}
                </span>
              </div>
              <div
                className={`job-state flex items-center gap-1 whitespace-nowrap px-1.5 py-1 text-xs state-${item.state}`}
              >
                <StatusIcon state={item.state} />
                <span>{item.preparing ? labels.preparing : stateLabel[item.state]}</span>
              </div>
              <MoreHorizontal size={16} />
            </button>
          ))
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
