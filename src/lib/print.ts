import { DEFAULT_RENDER_OPTIONS, DEFAULT_SETTINGS } from "../app/constants";
import type { DocumentInfo, PrinterCapabilities, PrinterOption, QueueItem } from "../app/types";

export const isActiveJob = (item: QueueItem) =>
  ["submitting", "submitted", "printing", "blocked"].includes(item.state);

export const canRetryJob = (item: QueueItem) => ["failed", "cancelled"].includes(item.state);

/** 重试创建独立尝试；保留旧历史，重新从源文件准备临时产物。 */
export function retryQueueItem(item: QueueItem): QueueItem {
  return {
    ...createQueueItem(item),
    settings: { ...(item.submittedSettings ?? item.settings) },
    renderOptions: { ...item.renderOptions },
    printPath: "",
    preparing: true,
    systemJobId: undefined,
    error: undefined,
    finishedAt: undefined,
    submittedAt: undefined,
    submittedPrinter: undefined,
    submittedSettings: undefined,
    systemReasons: undefined,
    systemMessage: undefined,
    statusUnavailable: undefined,
    retryOf: item.id,
  };
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function createQueueItem(document: DocumentInfo): QueueItem {
  return {
    ...document,
    id: crypto.randomUUID(),
    settings: { ...DEFAULT_SETTINGS },
    renderOptions: { ...DEFAULT_RENDER_OPTIONS },
    state: "queued",
  };
}

function countPrintableSides(item: QueueItem) {
  if (!item.pages) return null;

  // CUPS page ranges address output pages. number-up groups document pages first,
  // so range and odd/even filtering must use the resulting output-page indexes.
  const outputPages = Math.ceil(item.pages / item.settings.pagesPerSheet);
  const pageNumbers = new Set<number>();
  const range = item.settings.pageRange.trim();
  if (!range) {
    for (let page = 1; page <= outputPages; page += 1) pageNumbers.add(page);
  } else {
    for (const rawPart of range.split(",")) {
      const part = rawPart.trim();
      if (!part) return null;
      const single = part.match(/^(\d+)$/);
      const interval = part.match(/^(\d+)-(\d+)$/);
      if (single) {
        const page = Number(single[1]);
        if (page < 1) return null;
        if (page <= outputPages) pageNumbers.add(page);
        continue;
      }
      if (!interval) return null;
      const start = Number(interval[1]);
      const end = Number(interval[2]);
      if (start < 1 || end < 1 || start > end) return null;
      for (let page = start; page <= Math.min(outputPages, end); page += 1) {
        pageNumbers.add(page);
      }
    }
  }

  return [...pageNumbers].filter((page) => {
    if (item.settings.pageSet === "odd") return page % 2 === 1;
    if (item.settings.pageSet === "even") return page % 2 === 0;
    return true;
  }).length;
}

export function estimatePrintUsage(queue: QueueItem[], capabilities: PrinterCapabilities | null) {
  let printedPages = 0;
  let sheets = 0;
  let unknownItems = 0;

  for (const item of queue) {
    const sidesPerCopy = countPrintableSides(item);
    if (sidesPerCopy === null) {
      unknownItems += 1;
      continue;
    }
    const copies = Math.max(1, item.settings.copies);
    printedPages += sidesPerCopy * copies;
    const effectiveDuplex =
      capabilities && !capabilities.supportsDuplex ? "none" : item.settings.duplex;
    const sheetsPerCopy = effectiveDuplex === "none" ? sidesPerCopy : Math.ceil(sidesPerCopy / 2);
    sheets += sheetsPerCopy * copies;
  }

  return { printedPages, sheets, unknownItems };
}

export function supportsPrinterChoice(options: PrinterOption[], candidates: string[]) {
  return options.some((option) =>
    candidates.some((candidate) => option.value.toLowerCase() === candidate.toLowerCase()),
  );
}
