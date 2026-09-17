import type { AppPreferences, DocumentRenderOptions, PrintSettings } from "./types";

export const DEFAULT_SETTINGS: PrintSettings = {
  copies: 1,
  duplex: "long",
  color: "auto",
  orientation: "auto",
  media: "A4",
  scale: "fit",
  pageRange: "",
  pagesPerSheet: 1,
  reverse: false,
  pageSet: "all",
  tray: "",
  quality: "printer",
};

export const DEFAULT_RENDER_OPTIONS: DocumentRenderOptions = {
  xlsxSheet: "all",
  xlsxScale: "fit-width",
  imageSizing: "fit",
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  printerPreference: "system",
  restoreBatch: true,
  historyRetention: "30d",
};
