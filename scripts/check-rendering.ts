import { createServer } from "vite-plus";
import { chromium, webkit } from "playwright-core";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// 执行真实的 Pliflo 文档代码与 Rust Cairo；只替换 IPC 传输，没有打印命令。
const inputs = process.argv.slice(2).map((path) => resolve(path));
if (!inputs.length) throw new Error("Usage: bun scripts/check-rendering.ts <document> [...]");
const output = await mkdtemp(join(tmpdir(), "pliflo-cairo-check-"));
const engine = process.env.PLIFLO_RENDER_BROWSER ?? "chromium";
assert(["chromium", "webkit", "msedge"].includes(engine), "Unsupported test browser");
assert(
  !(engine === "webkit" && process.env.PLIFLO_RENDER_PROFILE),
  "CPU profiling requires Chromium",
);
const csp = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
const markdown = join(output, "mixed.md");
await writeFile(
  markdown,
  "# 中文 Markdown / Searchable text\n\nMixed English 中文段落。\n\n| Name | Value |\n| --- | --- |\n| 表格 | 123 |\n\n```ts\nconst value = 42;\n```\n",
);
inputs.push(markdown);
const server = await createServer({ server: { port: 0, strictPort: false, open: false } });
await server.listen();
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  channel: engine === "msedge" ? "msedge" : undefined,
});
const watchdog = setTimeout(() => {
  void browser.close();
}, 120_000);
const page = await browser.newPage();
const profiler = process.env.PLIFLO_RENDER_PROFILE
  ? await page.context().newCDPSession(page)
  : undefined;
await profiler?.send("Profiler.enable");
let active = "",
  pages: string[] = [];
let binaryImages = 0;
let nativeMs = 0;
let recordingBytes = 0;
try {
  const testInvoke = async (
    command: string,
    args: Record<string, unknown> | Uint8Array,
    options?: { headers: Record<string, string> },
  ) => {
    const values = args as Record<string, unknown>;
    if (command === "begin_printable_pdf") {
      active = await mkdtemp(join(output, "session-"));
      pages = [];
      nativeMs = 0;
      recordingBytes = 0;
      return active;
    }
    if (command === "append_vector_pdf_page") {
      assert.equal(options?.headers["x-pliflo-session"], basename(active));
      assert.equal(Number(options?.headers["x-pliflo-index"]), pages.length);
      const bytes = Buffer.from(args as Uint8Array);
      recordingBytes += bytes.length;
      assert(["CCP1", "CCP2"].includes(bytes.subarray(0, 4).toString()));
      const jsonLength = bytes.readUInt32LE(4);
      const json = JSON.parse(bytes.subarray(8, 8 + jsonLength).toString());
      binaryImages += bytes.readUInt32LE(8 + jsonLength);
      const path = join(active, `page-${pages.length}.ccp`);
      await writeFile(path, bytes);
      pages.push(path);
      assert(json.size.widthPt > 0 && json.size.heightPt > 0);
      return;
    }
    if (command === "finalize_vector_pdf") {
      assert.equal(values.count, pages.length);
      const manifest = join(active, "manifest.json"),
        pdf = join(active, "printable.pdf");
      await writeFile(manifest, JSON.stringify({ pages }));
      const started = performance.now();
      const native = spawnSync(
        resolve(
          `src-tauri/target/debug/canvas-cairo-pdf${process.platform === "win32" ? ".exe" : ""}`,
        ),
        [manifest, pdf],
        { encoding: "utf8", env: { ...process.env, PLIFLO_FONT_DIAGNOSTICS: "1" } },
      );
      await writeFile(join(active, "fonts.txt"), native.stderr ?? "");
      if (native.error) throw native.error;
      assert.equal(native.status, 0, native.stderr);
      nativeMs += performance.now() - started;
      return pdf;
    }
    if (command === "cleanup_render_session" || command === "cancel_vector_pdf") return;
    if (command === "inspect_pdfs")
      return [{ path: (values.paths as string[])[0], name: "pdf", pages: null, sizeBytes: 0 }];
    throw new Error(`Unexpected IPC: ${command}`);
  };
  await page.exposeFunction("testInvoke", testInvoke);
  await page.route("**/render-file", async (route) => {
    const { path } = route.request().postDataJSON() as { path: string };
    try {
      await route.fulfill({ body: await readFile(path), contentType: "application/octet-stream" });
    } catch (error) {
      await route.fulfill({ status: 400, body: String(error) });
    }
  });
  // 页数据走原始字节，避免 Playwright 的逐元素序列化主导性能测量。
  await page.route("**/render-page", async (route) => {
    try {
      await testInvoke("append_vector_pdf_page", route.request().postDataBuffer()!, {
        headers: route.request().headers(),
      });
      await route.fulfill({ status: 204 });
    } catch (error) {
      await route.fulfill({ status: 400, body: String(error) });
    }
  });
  await page.addInitScript(() => {
    const host = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      testInvoke: (...args: unknown[]) => Promise<unknown>;
    };
    host.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: unknown, options: unknown) => {
        if (command === "read_local_file") {
          const response = await fetch("/render-file", {
            method: "POST",
            body: JSON.stringify(args),
          });
          if (!response.ok) throw new Error(await response.text());
          return response.arrayBuffer();
        }
        if (command === "append_vector_pdf_page" && args instanceof Uint8Array) {
          const response = await fetch("/render-page", {
            method: "POST",
            headers: (options as { headers: Record<string, string> }).headers,
            body: new Uint8Array(args).buffer,
          });
          if (!response.ok) throw new Error(await response.text());
          return;
        }
        return host.testInvoke(command, args, options);
      },
    };
  });
  await page.route("**/render-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": csp },
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto(`${server.resolvedUrls!.local[0]}render-check`);
  await page.evaluate(async () => {
    const source = "/packages/canvas-recorder/tests/browser-lifecycle.ts";
    const { checkRecorderLifecycle } = await import(/* @vite-ignore */ source);
    await checkRecorderLifecycle();
  });
  for (const path of inputs) {
    active = await mkdtemp(join(output, "source-"));
    nativeMs = 0;
    recordingBytes = 0;
    try {
      const info = { path, name: basename(path), sizeBytes: (await stat(path)).size };
      const started = performance.now();
      await profiler?.send("Profiler.start");
      const result = await page.evaluate(
        async (file) => {
          const source = "/src/lib/documents.ts";
          const { prepareDocument } = await import(/* @vite-ignore */ source);
          return prepareDocument(file.info, {
            xlsxSheet: "all",
            xlsxScale: file.xlsxScale,
            imageSizing: "fit",
          });
        },
        { info, xlsxScale: process.env.PLIFLO_XLSX_SCALE ?? "fit-width" },
      );
      if (profiler) {
        const { profile } = await profiler.send("Profiler.stop");
        await writeFile(join(active, "frontend.cpuprofile"), JSON.stringify(profile));
        console.log(
          JSON.stringify({
            file: info.name,
            hotFunctions: profile.nodes
              .filter((node) => node.hitCount)
              .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
              .slice(0, 12)
              .map((node) => ({ ...node.callFrame, hitCount: node.hitCount })),
          }),
        );
      }
      const text = execFileSync("pdftotext", [result.printPath, "-"], { encoding: "utf8" });
      const report = {
        file: info.name,
        ...result,
        ms: Math.round(performance.now() - started),
        nativeMs: Math.round(nativeMs),
        recordingBytes,
        bytes: (await stat(result.printPath)).size,
        textCharacters: text.trim().length,
        browser: engine,
      };
      const pdfInfo = execFileSync("pdfinfo", [result.printPath], { encoding: "utf8" });
      const pdfPages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (result.generated)
        assert.equal(pdfPages, result.pages, "PDF page count differs from preparation");
      if (!["image", "pdf"].includes(result.format))
        assert(text.trim().length > 0, "Missing searchable text");
      await writeFile(join(active, "extracted.txt"), text);
      await writeFile(join(active, "report.json"), JSON.stringify(report, null, 2));
      await writeFile(join(active, "pdfinfo.txt"), pdfInfo);
      await writeFile(
        join(active, "pdffonts.txt"),
        execFileSync("pdffonts", [result.printPath], { encoding: "utf8" }),
      );
      console.log(JSON.stringify(report));
    } catch (error) {
      await profiler?.send("Profiler.stop");
      const report = { file: basename(path), failed: true, error: String(error) };
      await writeFile(join(active, "report.json"), JSON.stringify(report, null, 2));
      console.error(JSON.stringify(report));
      process.exitCode = 1;
    }
  }
  // 已取消的任务不得创建会话、读取文件或返回产物。
  await page.evaluate(async () => {
    const source = "/src/lib/documents.ts";
    const { prepareDocument } = await import(/* @vite-ignore */ source);
    try {
      await prepareDocument(
        { path: "cancelled.docx", name: "cancelled", sizeBytes: 1 },
        {},
        AbortSignal.abort(),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    }
    throw new Error("Cancelled preparation returned successfully");
  });
  console.log(JSON.stringify({ output, binaryImages }));
} finally {
  clearTimeout(watchdog);
  await browser.close();
  await server.close();
}
