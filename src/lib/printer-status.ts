import type { COPY } from "../app/i18n";

/** 保留无法识别的驱动原因，不从全局缺纸报告推测纸盒编号。 */
export function describeReasons(reasons: string[], copy: (typeof COPY)[keyof typeof COPY]) {
  return [
    ...new Set(
      reasons
        .filter((reason) => reason !== "none")
        .map((reason) => {
          const key = reason.replace(/-(report|warning|error)$/, "");
          const labels: Record<string, string> = {
            "job-no-longer-in-queue": copy.completionUnconfirmedHint,
            "media-empty": copy.mediaEmpty,
            "media-needed": copy.mediaNeeded,
            "media-jam": copy.mediaJam,
            offline: copy.offline,
            "door-open": copy.doorOpen,
            "cover-open": copy.doorOpen,
            "toner-low": copy.tonerLow,
            "toner-empty": copy.tonerEmpty,
            paused: copy.printerStopped,
          };
          return labels[key] ?? reason;
        }),
    ),
  ];
}
