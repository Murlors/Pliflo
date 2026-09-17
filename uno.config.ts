import { presetWind3 } from "@unocss/preset-wind3";
import { defineConfig } from "@unocss/vite";

export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      ink: "var(--ink)",
      muted: "var(--muted)",
      line: "var(--line)",
      "line-strong": "var(--line-strong)",
      paper: "var(--paper)",
      "paper-soft": "var(--paper-soft)",
      acid: "var(--acid)",
      "acid-strong": "var(--acid-strong)",
      danger: "var(--danger)",
    },
  },
  shortcuts: {
    "ui-icon-button":
      "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-transparent transition-colors duration-150",
    "ui-control":
      "min-h-9 rounded-lg border border-line bg-paper-soft text-sm text-ink transition-colors duration-150",
  },
});
