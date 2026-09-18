import { useEffect, useRef } from "react";
import type { COPY } from "../app/i18n";
import type { PrinterCapabilities, QueueItem } from "../app/types";
import { PrintSummary } from "./PrintSummary";

export function PrintReviewDialog({
  items,
  printer,
  capabilities,
  labels,
  onClose,
  onConfirm,
}: {
  items: QueueItem[];
  printer: string;
  capabilities: PrinterCapabilities | null;
  labels: (typeof COPY)[keyof typeof COPY];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="print-review w-140 max-w-[90vw] p-0"
      aria-labelledby="review-title"
      onCancel={onClose}
    >
      <div className="p-5">
        <h2 id="review-title" className="m-0 text-lg">
          {labels.reviewBatch}
        </h2>
        <p className="mb-2 text-sm">{labels.reviewHint}</p>
        <p className="text-xs break-words">
          {labels.printer}: {printer}
        </p>
        {items.some((item) => item.retryOf) && (
          <p className="file-error text-sm">{labels.retryWarning}</p>
        )}
      </div>
      <div className="max-h-[45vh] overflow-auto px-5">
        {items.map((item) => (
          <div key={item.id} className="review-file py-3">
            <strong className="mb-1 block break-words text-sm">{item.name}</strong>
            <PrintSummary settings={item.settings} labels={labels} capabilities={capabilities} />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 p-5">
        <button type="button" className="secondary-action px-3 py-2 text-sm" onClick={onClose}>
          {labels.backToSettings}
        </button>
        <button
          type="button"
          className="print-button px-3 py-2 text-sm"
          disabled={!items.length || !capabilities}
          onClick={onConfirm}
        >
          {labels.submitBatch} · {items.length}
        </button>
      </div>
    </dialog>
  );
}
