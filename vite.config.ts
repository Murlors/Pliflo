import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  fmt: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**"],
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  plugins: lazyPlugins(() => [react()]),
});
