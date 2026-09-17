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
      className="topbar shrink-0"
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button")) return;
        void getCurrentWindow().startDragging().catch(onDragError);
      }}
    >
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="brand-name">Pliflo</span>
        <span className="brand-tag">PRINT FLOW</span>
      </div>

      <div className="transport" aria-label={labels.queueStatus}>
        <div className="transport-item">
          <span className="transport-light ready" />
          <span>{labels.ready}</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="transport-item">
          <span className="transport-light active" />
          <span>{labels.active}</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="transport-item">
          <span className="transport-light done" />
          <span>{labels.done}</span>
          <strong>{completedCount}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={onToggleHistory}>
          <Archive size={16} /> {labels.history}
        </button>
        <button
          className="icon-button"
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
