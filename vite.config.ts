import react from "@vitejs/plugin-react";
import UnoCSS from "@unocss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ooxml = resolve("node_modules/.cache/pliflo-ooxml");
// 在启动前生成经版本和哈希校验的 OOXML 构建副本。
execFileSync("bun", ["run", "scripts/prepare-ooxml.ts"], { stdio: "inherit" });

// https://vite.dev/config/
export default defineConfig({
  // 共享 TS 模块引用宿主提供的 OOXML 构建资源，交给常规解析器而非依赖预打包。
  optimizeDeps: { exclude: ["@pliflo/canvas-recorder"] },
  resolve: {
    alias: [
      // 固定 0.87.0 的三个渲染 Worker 入口；解析器 Worker/WASM 保持原样。
      {
        find: /^\.\/render-worker-host-(BfbnEChF|DNL9dWRh|IkHrYOci)\.js$/,
        replacement: resolve("src/lib/ooxml-main-only.ts"),
      },
      { find: "@silurus/ooxml/docx", replacement: resolve(ooxml, "dist/docx.mjs") },
      { find: "@silurus/ooxml/pptx", replacement: resolve(ooxml, "dist/pptx.mjs") },
      { find: "@silurus/ooxml/xlsx", replacement: resolve(ooxml, "dist/xlsx.mjs") },
      {
        find: "/ooxml/xlsx-print-geometry.mjs",
        replacement: resolve(ooxml, "dist/xlsx-print-geometry.mjs"),
      },
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  fmt: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**", "compat/ooxml/*.js"],
  },
  lint: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**", "compat/ooxml/*.js"],
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
  plugins: lazyPlugins(() => [UnoCSS(), react()]),
});
