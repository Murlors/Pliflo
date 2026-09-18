import {
  ChevronDown,
  FileText,
  Layers3,
  Pause,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type {
  DocumentRenderOptions,
  PrinterCapabilities,
  PrinterInfo,
  PrintSettings,
  QueueItem,
} from "../app/types";
import { supportsPrinterChoice } from "../lib/print";
import { StatusIcon } from "./StatusIcon";

type Labels = {
  printSetup: string;
  setupCaption: string;
  reset: string;
  resetSettings: string;
  printer: string;
  noPrinters: string;
  defaultPrinter: string;
  printerDetected: string;
  notConnected: string;
  refresh: string;
  batch: string;
  file: string;
  copies: string;
  decreaseCopies: string;
  increaseCopies: string;
  paper: string;
  paperSize: string;
  outputPageRange: string;
  pageRange: string;
  pageRangePlaceholder: string;
  orientation: string;
  auto: string;
  portrait: string;
  landscape: string;
  twoSided: string;
  twoSidedPrinting: string;
  off: string;
  longEdge: string;
  shortEdge: string;
  color: string;
  printerDefault: string;
  gray: string;
  scale: string;
  fit: string;
  advanced: string;
  documentOptions: string;
  sheets: string;
  allSheets: string;
  spreadsheetScale: string;
  fitWidth: string;
  imageSizing: string;
  actualSize: string;
  pagesPerSheet: string;
  outputPageSet: string;
  pageSet: string;
  allPages: string;
  oddPages: string;
  evenPages: string;
  reverseOrder: string;
  paperSource: string;
  printQuality: string;
  qualityDraft: string;
  qualityNormal: string;
  qualityHigh: string;
  estimatedSheets: string;
  printedPages: string;
  estimatePartial: string;
  submissionTitle: string;
  submissionBody: string;
  resumeQueue: string;
  pauseQueue: string;
  printFiles: (count: number) => string;
  cancel: string;
};

type PrintEstimate = {
  sheets: number;
  printedPages: number;
  unknownItems: number;
};

type PrintSettingsPanelProps = {
  labels: Labels;
  printers: PrinterInfo[];
  selectedPrinter: string;
  printerCapabilities: PrinterCapabilities | null;
  selected: QueueItem | null;
  itemsLength: number;
  settings: PrintSettings;
  pendingCount: number;
  activeItems: QueueItem[];
  printEstimate: PrintEstimate;
  queueRunning: boolean;
  queuePaused: boolean;
  onReset: () => void;
  onPrinterChange: (printer: string) => void;
  onRefreshPrinters: () => void;
  onSelectBatch: () => void;
  onSelectFile: () => void;
  onChangeSetting: (patch: Partial<PrintSettings>) => void;
  onChangeRenderOptions: (patch: Partial<DocumentRenderOptions>) => void;
  onStartQueue: () => void;
  onToggleQueuePause: () => void;
  onCancelJob: (item: QueueItem) => void;
};

export function PrintSettingsPanel({
  labels,
  printers,
  selectedPrinter,
  printerCapabilities,
  selected,
  itemsLength,
  settings,
  pendingCount,
  activeItems,
  printEstimate,
  queueRunning,
  queuePaused,
  onReset,
  onPrinterChange,
  onRefreshPrinters,
  onSelectBatch,
  onSelectFile,
  onChangeSetting,
  onChangeRenderOptions,
  onStartQueue,
  onToggleQueuePause,
  onCancelJob,
}: PrintSettingsPanelProps) {
  const locked = queueRunning;
  const detected =
    printers.find((printer) => printer.name === selectedPrinter)?.state === "detected";

  return (
    <aside className="settings-panel flex min-h-0 min-w-0 flex-col">
      <div className="panel-heading flex min-h-19.5 shrink-0 items-center justify-between gap-3 px-4 pb-3.25 pt-3.75 max-[1240px]:px-3.25">
        <div>
          <h2 className="m-0 text-base font-680 leading-none tracking-tight">
            {labels.printSetup}
          </h2>
          <span className="panel-caption mt-1.25 block text-xs leading-snug">
            {labels.setupCaption}
          </span>
        </div>
        <button
          className="icon-button"
          type="button"
          disabled={locked}
          onClick={onReset}
          title={labels.reset}
          aria-label={labels.resetSettings}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="setting-section printer-section px-3.75 pb-3.25 pt-3.5 max-[1240px]:px-3">
        <label className="text-xs font-620">{labels.printer}</label>
        <div className="select-shell prominent mt-2 flex h-10.5 items-center gap-2 px-2.5">
          <Printer size={17} />
          <select
            aria-label={labels.printer}
            value={selectedPrinter}
            disabled={queueRunning}
            onChange={(event) => onPrinterChange(event.target.value)}
          >
            {!printers.length && <option value="">{labels.noPrinters}</option>}
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.name}
                {printer.isDefault ? ` — ${labels.defaultPrinter}` : ""}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
        <div className="printer-meta mt-2 flex items-center gap-1.5 text-xs">
          <span className="printer-state-dot" />
          <span>{detected ? labels.printerDetected : labels.notConnected}</span>
          <button
            className="ml-auto flex items-center gap-1 text-xs"
            type="button"
            disabled={queueRunning}
            onClick={onRefreshPrinters}
          >
            <RefreshCw size={13} /> {labels.refresh}
          </button>
        </div>
      </div>

      <div className="scope-switch mx-3.25 mt-2.5 flex p-0.75">
        <button
          className={`flex h-7.25 flex-1 items-center justify-center gap-1.25 text-xs font-620 ${!selected ? "active" : ""}`}
          type="button"
          disabled={locked}
          onClick={onSelectBatch}
        >
          <Layers3 size={14} /> {labels.batch}
        </button>
        <button
          className={`flex h-7.25 flex-1 items-center justify-center gap-1.25 text-xs font-620 ${selected ? "active" : ""}`}
          type="button"
          disabled={!itemsLength || locked}
          onClick={onSelectFile}
        >
          <FileText size={14} /> {labels.file}
        </button>
      </div>

      <fieldset
        className="settings-scroll settings-fieldset m-0 min-h-0 flex-1 overflow-auto border-0 p-0"
        disabled={locked}
      >
        <div className="setting-section px-3.75 py-2.75 max-[1240px]:px-3">
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.copies}</label>
            <div className="stepper grid h-7 grid-cols-[27px_31px_27px] justify-self-end overflow-hidden">
              <button
                aria-label={labels.decreaseCopies}
                type="button"
                onClick={() => onChangeSetting({ copies: Math.max(1, settings.copies - 1) })}
              >
                −
              </button>
              <span className="grid place-items-center text-xs tabular-nums">
                {settings.copies}
              </span>
              <button
                aria-label={labels.increaseCopies}
                type="button"
                onClick={() => onChangeSetting({ copies: Math.min(99, settings.copies + 1) })}
              >
                +
              </button>
            </div>
          </div>
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.paper}</label>
            <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
              <select
                aria-label={labels.paperSize}
                value={settings.media}
                onChange={(event) => onChangeSetting({ media: event.target.value })}
              >
                {(printerCapabilities?.media.length
                  ? printerCapabilities.media
                  : [
                      { value: "A4", label: "A4", isDefault: true },
                      { value: "Letter", label: "Letter", isDefault: false },
                      { value: "Legal", label: "Legal", isDefault: false },
                    ]
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">
              {settings.pagesPerSheet > 1 ? labels.outputPageRange : labels.pageRange}
            </label>
            <input
              className="compact-input h-7.25 w-38 justify-self-end px-2.25 text-xs"
              inputMode="numeric"
              value={settings.pageRange}
              placeholder={labels.pageRangePlaceholder}
              onChange={(event) => onChangeSetting({ pageRange: event.target.value })}
            />
          </div>
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.orientation}</label>
            <div className="segmented flex max-w-51.25 justify-self-end p-0.5">
              {(["auto", "portrait", "landscape"] as const).map((value) => (
                <button
                  key={value}
                  className={settings.orientation === value ? "active" : ""}
                  type="button"
                  onClick={() => onChangeSetting({ orientation: value })}
                >
                  {value === "auto"
                    ? labels.auto
                    : value === "portrait"
                      ? labels.portrait
                      : labels.landscape}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="setting-section px-3.75 py-2.75 max-[1240px]:px-3">
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.twoSided}</label>
            <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
              <select
                aria-label={labels.twoSidedPrinting}
                value={settings.duplex}
                disabled={!printerCapabilities || !printerCapabilities.supportsDuplex}
                onChange={(event) =>
                  onChangeSetting({ duplex: event.target.value as PrintSettings["duplex"] })
                }
              >
                <option value="none">{labels.off}</option>
                <option value="long">{labels.longEdge}</option>
                <option value="short">{labels.shortEdge}</option>
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.color}</label>
            <div className="segmented flex max-w-51.25 justify-self-end p-0.5">
              <button
                className={settings.color === "auto" ? "active" : ""}
                type="button"
                onClick={() => onChangeSetting({ color: "auto" })}
              >
                {labels.printerDefault}
              </button>
              <button
                className={settings.color === "color" ? "active" : ""}
                type="button"
                disabled={!printerCapabilities || !printerCapabilities.supportsColor}
                onClick={() => onChangeSetting({ color: "color" })}
              >
                {labels.color}
              </button>
              <button
                className={settings.color === "grayscale" ? "active" : ""}
                type="button"
                disabled={!printerCapabilities || !printerCapabilities.supportsColor}
                onClick={() => onChangeSetting({ color: "grayscale" })}
              >
                {labels.gray}
              </button>
            </div>
          </div>
          <div className="setting-row grid min-h-9.5 grid-cols-[78px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
            <label className="text-xs font-620">{labels.scale}</label>
            <div className="segmented flex max-w-51.25 justify-self-end p-0.5">
              <button
                className={settings.scale === "fit" ? "active" : ""}
                type="button"
                onClick={() => onChangeSetting({ scale: "fit" })}
              >
                {labels.fit}
              </button>
              <button
                className={settings.scale === "actual" ? "active" : ""}
                type="button"
                onClick={() => onChangeSetting({ scale: "actual" })}
              >
                100%
              </button>
            </div>
          </div>
        </div>

        <details className="advanced-settings mx-3.25 mb-3 mt-2.5">
          <summary className="flex min-h-9.5 items-center justify-between px-2.5 text-xs font-680">
            <span className="flex items-center gap-1.75">
              <SlidersHorizontal size={15} /> {labels.advanced}
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="advanced-settings-body px-2.5 pb-2 pt-0.5">
            {selected?.format === "xlsx" && (
              <>
                <div className="surface-label mb-1 mt-1 text-[10px] font-700 uppercase tracking-[0.08em]">
                  {labels.documentOptions}
                </div>
                <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
                  <label className="text-xs font-620">{labels.sheets}</label>
                  <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
                    <select
                      value={selected.renderOptions.xlsxSheet}
                      onChange={(event) =>
                        onChangeRenderOptions({
                          xlsxSheet:
                            event.target.value === "all" ? "all" : Number(event.target.value),
                        })
                      }
                    >
                      <option value="all">{labels.allSheets}</option>
                      {selected.sheetNames?.map((name, index) => (
                        <option key={`${index}-${name}`} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>
                <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
                  <label className="text-xs font-620">{labels.spreadsheetScale}</label>
                  <div className="segmented flex max-w-51.25 justify-self-end p-0.5">
                    <button
                      className={selected.renderOptions.xlsxScale === "fit-width" ? "active" : ""}
                      type="button"
                      onClick={() => onChangeRenderOptions({ xlsxScale: "fit-width" })}
                    >
                      {labels.fitWidth}
                    </button>
                    <button
                      className={selected.renderOptions.xlsxScale === "actual" ? "active" : ""}
                      type="button"
                      onClick={() => onChangeRenderOptions({ xlsxScale: "actual" })}
                    >
                      100%
                    </button>
                  </div>
                </div>
              </>
            )}
            {selected?.format === "image" && (
              <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
                <label className="text-xs font-620">{labels.imageSizing}</label>
                <div className="segmented flex max-w-51.25 justify-self-end p-0.5">
                  <button
                    className={selected.renderOptions.imageSizing === "fit" ? "active" : ""}
                    type="button"
                    onClick={() => onChangeRenderOptions({ imageSizing: "fit" })}
                  >
                    {labels.fit}
                  </button>
                  <button
                    className={selected.renderOptions.imageSizing === "actual" ? "active" : ""}
                    type="button"
                    onClick={() => onChangeRenderOptions({ imageSizing: "actual" })}
                  >
                    {labels.actualSize}
                  </button>
                </div>
              </div>
            )}
            <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
              <label className="text-xs font-620">{labels.pagesPerSheet}</label>
              <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
                <select
                  value={settings.pagesPerSheet}
                  onChange={(event) =>
                    onChangeSetting({
                      pagesPerSheet: Number(event.target.value) as PrintSettings["pagesPerSheet"],
                    })
                  }
                >
                  {[1, 2, 4, 6, 9, 16].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
              <label className="text-xs font-620">
                {settings.pagesPerSheet > 1 ? labels.outputPageSet : labels.pageSet}
              </label>
              <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
                <select
                  value={settings.pageSet}
                  onChange={(event) =>
                    onChangeSetting({ pageSet: event.target.value as PrintSettings["pageSet"] })
                  }
                >
                  <option value="all">{labels.allPages}</option>
                  <option value="odd">{labels.oddPages}</option>
                  <option value="even">{labels.evenPages}</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            <label className="toggle-row flex min-h-9.5 items-center justify-between gap-2.5 text-xs font-620">
              <span>{labels.reverseOrder}</span>
              <input
                type="checkbox"
                checked={settings.reverse}
                onChange={(event) => onChangeSetting({ reverse: event.target.checked })}
              />
            </label>
            {!!printerCapabilities?.trays.length && (
              <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
                <label className="text-xs font-620">{labels.paperSource}</label>
                <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
                  <select
                    value={settings.tray}
                    onChange={(event) => onChangeSetting({ tray: event.target.value })}
                  >
                    <option value="">{labels.printerDefault}</option>
                    {printerCapabilities.trays.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
            )}
            {!!printerCapabilities?.qualities.length && (
              <div className="setting-row grid min-h-9.5 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 max-[1240px]:grid-cols-[68px_minmax(0,1fr)]">
                <label className="text-xs font-620">{labels.printQuality}</label>
                <div className="select-shell compact h-7.25 w-38 justify-self-end px-2 max-[1240px]:w-35.5">
                  <select
                    value={settings.quality}
                    onChange={(event) =>
                      onChangeSetting({ quality: event.target.value as PrintSettings["quality"] })
                    }
                  >
                    <option value="printer">{labels.printerDefault}</option>
                    {supportsPrinterChoice(printerCapabilities.qualities, ["Draft", "3"]) && (
                      <option value="draft">{labels.qualityDraft}</option>
                    )}
                    {supportsPrinterChoice(printerCapabilities.qualities, ["Normal", "4"]) && (
                      <option value="normal">{labels.qualityNormal}</option>
                    )}
                    {supportsPrinterChoice(printerCapabilities.qualities, [
                      "High",
                      "Best",
                      "5",
                    ]) && <option value="high">{labels.qualityHigh}</option>}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
            )}
          </div>
        </details>
      </fieldset>

      <div className="print-actions shrink-0 px-3.25 pb-3.5 pt-3">
        <div
          className="print-estimate grid grid-cols-2 gap-2 pb-2.5"
          aria-label={labels.estimatedSheets}
        >
          <div className="min-w-0 px-2.5 py-2.25">
            <span className="text-xs">{labels.estimatedSheets}</span>
            <strong className="mt-0.75 block text-base tabular-nums">
              {printEstimate.unknownItems === pendingCount && pendingCount
                ? "—"
                : printEstimate.sheets}
            </strong>
          </div>
          <div className="min-w-0 px-2.5 py-2.25">
            <span className="text-xs">{labels.printedPages}</span>
            <strong className="mt-0.75 block text-base tabular-nums">
              {printEstimate.unknownItems === pendingCount && pendingCount
                ? "—"
                : printEstimate.printedPages}
            </strong>
          </div>
          {printEstimate.unknownItems > 0 && (
            <small className="col-span-2 px-0.5 text-xs">
              {labels.estimatePartial} · {printEstimate.unknownItems}
            </small>
          )}
        </div>
        <div className="submission-note mb-2.5 flex items-start gap-2">
          <span className="mt-0.5 size-1.75 shrink-0" />
          <p>
            <strong>{labels.submissionTitle}</strong> {labels.submissionBody}
          </p>
        </div>
        <div className="action-row flex gap-1.75">
          {(queueRunning || queuePaused) && pendingCount > 0 && (
            <button
              className="secondary-action flex h-10.5 items-center gap-1.25 px-2.75 text-xs"
              type="button"
              onClick={onToggleQueuePause}
            >
              {queuePaused ? <Play size={16} /> : <Pause size={16} />}
              {queuePaused ? labels.resumeQueue : labels.pauseQueue}
            </button>
          )}
          <button
            className="print-button flex h-10.5 flex-1 items-center justify-center gap-1.75 text-sm font-760"
            type="button"
            disabled={!pendingCount || !selectedPrinter || !printerCapabilities || queueRunning}
            onClick={onStartQueue}
          >
            <Printer size={17} /> {labels.printFiles(pendingCount)}
          </button>
        </div>
        {activeItems
          .filter((item) => item.systemJobId)
          .map((item) => (
            <button
              className="active-job mt-1.75 flex w-full justify-between gap-2 px-1 py-1.5 text-xs"
              type="button"
              key={item.id}
              onClick={() => onCancelJob(item)}
            >
              <span className="flex min-w-0 max-w-58.75 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                <StatusIcon state={item.state} /> {item.name}
              </span>
              <small className="shrink-0">{labels.cancel}</small>
            </button>
          ))}
      </div>
    </aside>
  );
}
