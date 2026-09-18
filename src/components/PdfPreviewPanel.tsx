import { convertFileSrc } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import type { QueueItem } from "../app/types";
import { isActiveJob } from "../lib/print";

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
  const canRemove = selected && !queueRunning && !isActiveJob(selected);

  return (
    <section className="preview-panel relative flex min-h-0 min-w-0 flex-col">
      <div className="preview-toolbar flex min-h-17.5 shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-3.5 max-[1240px]:px-3.25">
        <div className="document-title min-w-0">
          <span className="surface-label block text-xs font-700 tracking-[0.1em] uppercase">
            {labels.paperStage}
          </span>
          <strong className="mt-1.5 block max-w-130 truncate text-sm font-640">
            {selected?.name ?? labels.noDocument}
          </strong>
        </div>
        {canRemove && (
          <button
            className="icon-button danger-hover grid size-8 place-items-center p-0"
            type="button"
            title={labels.remove}
            aria-label={labels.removePdf}
            onClick={() => onRemove(selected.id)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="preview-stage relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        {selected?.printPath ? (
          <iframe
            className="pdf-preview relative z-1 h-full w-full border-0"
            title={labels.previewTitle(selected.name)}
            src={convertFileSrc(selected.printPath)}
          />
        ) : (
          <div className="preview-empty relative z-1 flex flex-col items-center gap-5 text-sm">
            <div className="preview-sheet">
              <span />
              <span />
              <span />
            </div>
            <p className="m-0">{selected?.preparing ? labels.previewNote : labels.previewEmpty}</p>
          </div>
        )}
      </div>

      {selected && (
        <div className="preview-footer flex min-h-9 shrink-0 items-center justify-between gap-3 px-5 pb-2.5 pt-1 text-xs">
          <span>{selected.pages ? labels.pages(selected.pages) : labels.pdfDocument}</span>
          <span>{labels.previewNote}</span>
        </div>
      )}
    </section>
  );
}
