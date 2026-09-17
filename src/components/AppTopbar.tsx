import { getCurrentWindow } from "@tauri-apps/api/window";
import { Archive, Settings2 } from "lucide-react";

type AppTopbarProps = {
  labels: {
    ready: string;
    active: string;
    done: string;
    history: string;
    settings: string;
    queueStatus: string;
  };
  pendingCount: number;
  activeCount: number;
  completedCount: number;
  onToggleHistory: () => void;
  onToggleSettings: () => void;
  onDragError: (error: unknown) => void;
};

export function AppTopbar({
  labels,
  pendingCount,
  activeCount,
  completedCount,
  onToggleHistory,
  onToggleSettings,
  onDragError,
}: AppTopbarProps) {
  return (
    <header
      className="topbar grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4.5 px-4.5 pl-19.5 select-none max-[1120px]:grid-cols-[1fr_auto]"
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button")) return;
        void getCurrentWindow().startDragging().catch(onDragError);
      }}
    >
      <div className="brand-lockup flex min-w-0 items-center gap-2.75">
        <div
          className="brand-mark flex size-7 items-center justify-center gap-0.75 -skew-x-9"
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
        </div>
        <span className="brand-name text-lg font-700 tracking-[-0.025em]">Pliflo</span>
        <span className="brand-tag border-l pl-2.75 text-xs font-700 tracking-[0.14em] max-[1120px]:hidden">
          PRINT FLOW
        </span>
      </div>

      <div
        className="transport flex h-9 min-w-75.5 items-center justify-self-center max-[1240px]:min-w-67.5 max-[1120px]:hidden"
        aria-label={labels.queueStatus}
      >
        <div className="transport-item flex h-full min-w-25 items-center justify-center gap-1.75 px-2.5 text-xs tracking-[0.01em] max-[1240px]:min-w-22">
          <span className="transport-light ready size-1.5 rounded-full" />
          <span>{labels.ready}</span>
          <strong className="min-w-4.5 text-xs tabular-nums">{pendingCount}</strong>
        </div>
        <div className="transport-item flex h-full min-w-25 items-center justify-center gap-1.75 px-2.5 text-xs tracking-[0.01em] max-[1240px]:min-w-22">
          <span className="transport-light active size-1.5 rounded-full" />
          <span>{labels.active}</span>
          <strong className="min-w-4.5 text-xs tabular-nums">{activeCount}</strong>
        </div>
        <div className="transport-item flex h-full min-w-25 items-center justify-center gap-1.75 px-2.5 text-xs tracking-[0.01em] max-[1240px]:min-w-22">
          <span className="transport-light done size-1.5 rounded-full" />
          <span>{labels.done}</span>
          <strong className="min-w-4.5 text-xs tabular-nums">{completedCount}</strong>
        </div>
      </div>

      <div className="topbar-actions flex items-center justify-self-end gap-2">
        <button
          className="ghost-button flex h-8 items-center gap-1.75 px-2.75 text-xs font-650"
          type="button"
          onClick={onToggleHistory}
        >
          <Archive size={16} /> {labels.history}
        </button>
        <button
          className="icon-button grid size-8 place-items-center p-0"
          type="button"
          aria-label={labels.settings}
          title={labels.settings}
          onClick={onToggleSettings}
        >
          <Settings2 size={17} />
        </button>
      </div>
    </header>
  );
}
