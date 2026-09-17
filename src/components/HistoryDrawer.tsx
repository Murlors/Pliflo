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
    <div className="history-drawer">
      <div className="drawer-heading">
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
        <div className="drawer-empty">{labels.historyEmpty}</div>
      ) : (
        items.map((item) => (
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
  );
}
