import { FileText, X } from "lucide-react";
import type { JobState, QueueItem } from "../app/types";
import { StatusIcon } from "./StatusIcon";

type HistoryDrawerProps = {
  labels: {
    printHistory: string;
    historyCaption: string;
    closeHistory: string;
    historyEmpty: string;
  };
  items: QueueItem[];
  stateLabel: Record<JobState, string>;
  onClose: () => void;
};

export function HistoryDrawer({ labels, items, stateLabel, onClose }: HistoryDrawerProps) {
  return (
    <div className="history-drawer absolute right-3 top-18 z-50 max-h-[calc(100vh-84px)] w-81 overflow-auto">
      <div className="drawer-heading flex min-h-16.5 items-center justify-between gap-3 px-2.5 py-3 pl-3.5">
        <div>
          <h2>{labels.printHistory}</h2>
          <span className="panel-caption">{labels.historyCaption}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={labels.closeHistory}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {!items.length ? (
        <div className="drawer-empty px-3.5 py-11 text-center text-sm">{labels.historyEmpty}</div>
      ) : (
        items.map((item) => (
          <div className="history-row flex min-h-14.5 items-center gap-2 px-2.5 py-2" key={item.id}>
            <FileText size={16} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.75">
              <strong className="truncate text-sm">{item.name}</strong>
              <small className="text-xs">
                {stateLabel[item.state]}
                {item.systemJobId ? ` · ${item.systemJobId}` : ""}
              </small>
            </span>
            <StatusIcon state={item.state} />
          </div>
        ))
      )}
    </div>
  );
}
