import type { COPY } from "../app/i18n";
import type { PrintSettings, PrinterCapabilities } from "../app/types";

export function PrintSummary({
  settings,
  labels,
  capabilities,
}: {
  settings: PrintSettings;
  labels: (typeof COPY)[keyof typeof COPY];
  capabilities?: PrinterCapabilities | null;
}) {
  const duplex =
    settings.duplex === "none"
      ? labels.singleSided
      : `${labels.twoSided} · ${settings.duplex === "long" ? labels.longEdge : labels.shortEdge}`;
  const tray =
    capabilities?.trays.find((option) => option.value === settings.tray)?.label ??
    (settings.tray || labels.printerDefault);
  return (
    <span className="block text-xs leading-relaxed break-words">
      {duplex} · {labels.paperSource}: {tray} · {labels.copiesSummary(settings.copies)}
      <br />
      {settings.media} · {labels.pageRange}: {settings.pageRange || labels.allPages}
      {` · ${labels.pagesPerSheet}: ${settings.pagesPerSheet}`}
      <br />
      {labels.color}:{" "}
      {settings.color === "auto"
        ? labels.printerDefault
        : settings.color === "color"
          ? labels.color
          : labels.gray}
      {` · ${settings.orientation === "auto" ? labels.auto : settings.orientation === "portrait" ? labels.portrait : labels.landscape}`}
      {` · ${settings.scale === "fit" ? labels.fit : labels.actualSize}`}
      {settings.pageSet !== "all" &&
        ` · ${settings.pageSet === "odd" ? labels.oddPages : labels.evenPages}`}
      {settings.reverse && ` · ${labels.reverseOrder}`}
      {settings.quality !== "printer" &&
        ` · ${labels.printQuality}: ${settings.quality === "draft" ? labels.qualityDraft : settings.quality === "normal" ? labels.qualityNormal : labels.qualityHigh}`}
    </span>
  );
}
