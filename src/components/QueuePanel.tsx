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
    <aside className="queue-panel">
      <div className="panel-heading">
        <div>
          <h1>{labels.printQueue}</h1>
          <span className="panel-caption">{labels.documentsInBatch(items.length)}</span>
        </div>
        <button className="add-button" type="button" onClick={onChooseFiles}>
          <Plus size={17} /> {labels.addPdf}
        </button>
      </div>

      <div className="search-row">
        <Search size={15} />
        <input
          name="queue-search"
          autoComplete="off"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={labels.findBatch}
          aria-label={labels.searchDocuments}
        />
        <span>{items.length}</span>
      </div>

      <div className={`file-list ${isDragging ? "drag-active" : ""}`}>
        {!items.length ? (
          <button className="drop-zone" type="button" onClick={onChooseFiles}>
            <div className="drop-icon">
              <FilePlus2 size={24} />
            </div>
            <strong>{labels.dropPdfs}</strong>
            <span>{labels.chooseMac}</span>
          </button>
        ) : (
          visibleItems.map((item, index) => (
            <button
              className={`file-row ${selectedId === item.id ? "selected" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <GripVertical className="drag-handle" size={15} />
              <div className="file-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="pdf-icon">
                <FileText size={17} />
              </div>
              <div className="file-copy">
                <strong>{item.name}</strong>
                <span className={item.state === "failed" && item.error ? "file-error" : undefined}>
                  {item.state === "failed" && item.error
                    ? item.error
                    : `${item.pages ? labels.pages(item.pages) : labels.pagesUnknown} · ${formatBytes(item.sizeBytes)}`}
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
          <span>{labels.ready}</span>
          <strong>{pendingCount}</strong>
        </div>
        <div>
          <span>{labels.inProgress}</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span>{labels.done}</span>
          <strong>{completedCount}</strong>
        </div>
      </div>
    </aside>
  );
}
