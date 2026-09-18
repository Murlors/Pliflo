import { FileText, X } from "lucide-react";
import type { JobState, QueueItem } from "../app/types";
import type { COPY } from "../app/i18n";
import { canRetryJob } from "../lib/print";
import { describeReasons } from "../lib/printer-status";
import { PrintSummary } from "./PrintSummary";
import { StatusIcon } from "./StatusIcon";

type HistoryDrawerProps = {
  labels: (typeof COPY)[keyof typeof COPY];
  items: QueueItem[];
  stateLabel: Record<JobState, string>;
  onClose: () => void;
  locale: string;
  onRetry: (item: QueueItem) => void;
  canRetry: (item: QueueItem) => boolean;
  onInspect: (item: QueueItem) => void;
};

export function HistoryDrawer({
  labels,
  items,
  stateLabel,
  onClose,
  locale,
  onRetry,
  canRetry,
  onInspect,
}: HistoryDrawerProps) {
  return (
    <div className="history-drawer absolute right-3 top-18 z-50 max-h-[calc(100vh-84px)] w-100 max-w-[90vw] overflow-auto">
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
          <details
            className="history-row px-2.5 py-2"
            key={item.id}
            onToggle={(event) => {
              if (event.currentTarget.open) onInspect(item);
            }}
          >
            <summary className="flex min-h-10.5 cursor-pointer items-center gap-2">
              <FileText size={16} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                <strong className="truncate text-sm">{item.name}</strong>
                <small className="text-xs">
                  {stateLabel[item.state]}
                  {item.systemJobId ? ` · ${item.systemJobId}` : ""}
                </small>
              </span>
              <StatusIcon state={item.state} />
            </summary>
            <div className="px-2 pb-2 pt-3 text-xs leading-relaxed break-words">
              <strong>
                {item.submittedSettings ? labels.submittedSettings : labels.legacySettings}
              </strong>
              <PrintSummary settings={item.submittedSettings ?? item.settings} labels={labels} />
              <p>
                {labels.printer}: {item.submittedPrinter ?? labels.unknownPrinter}
              </p>
              {item.submittedAt && (
                <p>
                  {labels.submittedAt}: {new Date(item.submittedAt).toLocaleString(locale)}
                </p>
              )}
              <strong>{labels.systemReasons}</strong>
              <p>
                {describeReasons(item.systemReasons ?? [], labels).join(" · ") ||
                  labels.noSystemReasons}
              </p>
              {!!item.systemReasons?.length && (
                <p className="system-reason-code">{item.systemReasons.join(", ")}</p>
              )}
              {item.systemMessage && <p>{item.systemMessage}</p>}
              {item.statusUnavailable && <p className="file-error">{labels.statusUnavailable}</p>}
              {item.error && <p className="file-error">{item.error}</p>}
              {canRetryJob(item) && (
                <>
                  <p>{labels.retryWarning}</p>
                  <button
                    className="secondary-action px-3 py-2"
                    type="button"
                    disabled={!canRetry(item)}
                    onClick={() => onRetry(item)}
                  >
                    {labels.retry}
                  </button>
                </>
              )}
            </div>
          </details>
        ))
      )}
    </div>
  );
}
