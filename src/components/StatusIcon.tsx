import { Check, CircleAlert, Clock3, LoaderCircle, X } from "lucide-react";
import type { JobState } from "../app/types";

export function StatusIcon({ state }: { state: JobState }) {
  if (state === "completed") return <Check size={14} />;
  if (state === "failed") return <CircleAlert size={14} />;
  if (state === "submitting" || state === "printing") {
    return <LoaderCircle className="spin" size={14} />;
  }
  if (state === "cancelled") return <X size={14} />;
  if (state === "submitted") return <Clock3 size={14} />;
  return <span className="status-dot" />;
}
