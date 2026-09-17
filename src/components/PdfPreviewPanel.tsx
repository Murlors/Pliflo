import { convertFileSrc } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import type { QueueItem } from "../app/types";

type PdfPreviewPanelProps = {
  selected: QueueItem | null | undefined;
  queueRunning: boolean;
  labels: {
    paperStage: string;
    noDocument: string;
    remove: string;
    removePdf: string;
    previewEmpty: string;
    pdfDocument: string;
    previewNote: string;
    pages: (count: number) => string;
    previewTitle: (name: string) => string;
  };
  onRemove: (id: string) => void;
};

export function PdfPreviewPanel({
  selected,
  queueRunning,
  labels,
  onRemove,
}: PdfPreviewPanelProps) {
  const canRemove =
    selected && !queueRunning && !["submitting", "submitted", "printing"].includes(selected.state);

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <div className="document-title">
          <span className="surface-label">{labels.paperStage}</span>
          <strong>{selected?.name ?? labels.noDocument}</strong>
        </div>
        {canRemove && (
          <button
            className="icon-button danger-hover"
            type="button"
            title={labels.remove}
            aria-label={labels.removePdf}
            onClick={() => onRemove(selected.id)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="preview-stage">
        {selected ? (
          <iframe
            className="pdf-preview"
            title={labels.previewTitle(selected.name)}
            src={convertFileSrc(selected.path)}
          />
        ) : (
          <div className="preview-empty">
            <div className="preview-sheet">
              <span />
              <span />
              <span />
            </div>
            <p>{labels.previewEmpty}</p>
          </div>
        )}
      </div>

      {selected && (
        <div className="preview-footer">
          <span>{selected.pages ? labels.pages(selected.pages) : labels.pdfDocument}</span>
          <span>{labels.previewNote}</span>
        </div>
      )}
    </section>
  );
}
