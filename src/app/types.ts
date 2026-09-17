export type DocumentFormat = "pdf" | "docx" | "pptx" | "xlsx" | "markdown" | "image";

export type DocumentInfo = {
  path: string;
  printPath: string;
  name: string;
  sizeBytes: number;
  pages: number | null;
  format: DocumentFormat;
  generated: boolean;
  sheetNames?: string[];
};

export type DocumentRenderOptions = {
  xlsxSheet: "all" | number;
  xlsxScale: "fit-width" | "actual";
  imageSizing: "fit" | "actual";
};

export type PrinterInfo = { name: string; isDefault: boolean; state: string };

export type PrinterOption = { value: string; label: string; isDefault: boolean };

export type PrinterCapabilities = {
  media: PrinterOption[];
  trays: PrinterOption[];
  qualities: PrinterOption[];
  supportsDuplex: boolean;
  supportsColor: boolean;
};

export type JobState =
  | "queued"
  | "submitting"
  | "submitted"
  | "printing"
  | "completed"
  | "cancelled"
  | "failed";

export type PrintSettings = {
  copies: number;
  duplex: "none" | "long" | "short";
  color: "auto" | "color" | "grayscale";
  orientation: "auto" | "portrait" | "landscape";
  media: string;
  scale: "fit" | "actual";
  pageRange: string;
  pagesPerSheet: 1 | 2 | 4 | 6 | 9 | 16;
  reverse: boolean;
  pageSet: "all" | "odd" | "even";
  tray: string;
  quality: "printer" | "draft" | "normal" | "high";
};

export type QueueItem = DocumentInfo & {
  id: string;
  settings: PrintSettings;
  renderOptions: DocumentRenderOptions;
  state: JobState;
  preparing?: boolean;
  systemJobId?: string;
  error?: string;
  finishedAt?: number;
};

export type SubmitResult = { jobId: string; raw: string };

export type Theme = "dark" | "light";
export type ThemePreference = "system" | Theme;
export type Locale = "en" | "zh-CN";

export type AppPreferences = {
  theme: ThemePreference;
  printerPreference: "system" | "last";
  restoreBatch: boolean;
  historyRetention: "session" | "30d" | "forever";
};
