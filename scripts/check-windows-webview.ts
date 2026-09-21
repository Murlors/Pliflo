import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Integration test of OUR staged application; never invokes a print submission.
// Usage: bun scripts/check-windows-webview.ts <staged-exe> <fixture> [...]
assert.equal(process.platform, "win32");
const [executable, ...inputs] = process.argv.slice(2).map((path) => resolve(path));
assert(executable && inputs.length);
const sourceHash = async (path: string) =>
  readFile(path)
    .then((bytes) => createHash("sha256").update(bytes).digest("hex"))
    .catch(() => null);
const sourceHashes = await Promise.all(inputs.map(sourceHash));
const output = await mkdtemp(join(tmpdir(), "pliflo-webview-"));
const temporary = join(output, "中文 user space");
await mkdir(temporary);
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const started = performance.now();
const child = spawn(executable, [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    TEMP: temporary,
    TMP: temporary,
    FONTCONFIG_FILE: join(output, "does-not-exist.conf"),
    FONTCONFIG_PATH: join(output, "does-not-exist"),
    WEBVIEW2_USER_DATA_FOLDER: join(output, "webview-profile"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
// Optional development-only sampler; Python uses Win32 APIs, with no pip dependencies.
const monitor =
  process.env.PLIFLO_MEMORY_PYTHON && child.pid
    ? spawn(
        process.env.PLIFLO_MEMORY_PYTHON,
        [
          resolve("scripts/sample-windows-memory.py"),
          String(child.pid),
          join(output, "memory.json"),
        ],
        { windowsHide: true },
      )
    : undefined;
monitor?.on("error", (error) => console.error("Memory sampler unavailable", error));
const expectedFailures = new Set((process.env.PLIFLO_EXPECT_FAILED ?? "corrupt.docx").split(";"));
let launchError: Error | undefined;
child.on("error", (error) => {
  launchError = error;
});
let browser;
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Application exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  assert(browser, "WebView2 debugging endpoint unavailable");
  let page = browser.contexts()[0].pages()[0];
  if (!page) page = await browser.contexts()[0].waitForEvent("page");
  await page.waitForFunction(() => !!document.querySelector(".preview-stage"));
  const startupMs = Math.round(performance.now() - started);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // Double guard: test refuses all print mutations, even if app behavior changes.
  await page.evaluate(() => {
    const host = window as any;
    const invoke = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = (command: string, ...args: unknown[]) => {
      if (["submit_print_job", "cancel_print_job"].includes(command))
        throw new Error("Print mutations forbidden in this integration test");
      return invoke(command, ...args);
    };
  });
  const printers = await page.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("list_printers"),
  );
  await page.evaluate(
    (paths) =>
      (window as any).__TAURI_INTERNALS__.invoke("plugin:event|emit", {
        event: "tauri://drag-drop",
        payload: { paths, position: { x: 100, y: 100 } },
      }),
    inputs,
  );
  await page.waitForFunction(
    (count) => {
      const items = JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]");
      return items.length === count && items.every((item: any) => !item.preparing);
    },
    inputs.length,
    { timeout: 180_000 },
  );
  if (process.env.PLIFLO_XLSX_ACTUAL === "1") {
    for (const path of inputs.filter((path) => path.toLowerCase().endsWith(".xlsx"))) {
      await page
        .locator(".file-row")
        .filter({ hasText: basename(path) })
        .click();
      const advanced = page.locator("details.advanced-settings");
      if (!(await advanced.evaluate((element) => (element as HTMLDetailsElement).open)))
        await advanced.locator("summary").click();
      await advanced.getByRole("button", { name: "100%", exact: true }).click();
      await page.waitForFunction(
        (path) => {
          const item = JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]").find(
            (item: any) => item.path === path,
          );
          return item?.renderOptions.xlsxScale === "actual" && !item.preparing;
        },
        path,
        { timeout: 180_000 },
      );
    }
  }
  const batch = await page.evaluate(() => JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]"));
  await page.screenshot({ path: join(output, "workspace.png") });
  for (const [index, item] of batch.entries()) {
    if (item.generated && item.printPath)
      await copyFile(item.printPath, join(output, `${index}-${basename(item.path)}.pdf`));
  }
  const frames = page.frames().map((frame) => frame.url());
  const report = {
    startupMs,
    totalMs: Math.round(performance.now() - started),
    printers,
    batch,
    frames,
    errors,
    output,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(errors.length, 0, "WebView2 JavaScript errors");
  for (const item of batch) {
    assert.equal(
      item.state === "failed",
      expectedFailures.has(basename(item.path)),
      `${item.name}: ${item.error}`,
    );
  }
  // Close the PDF viewer before asking Windows to release its artifact.
  await page
    .locator("iframe.pdf-preview")
    .evaluateAll((frames) => frames.forEach((frame) => frame.remove()));
  for (const item of batch.filter((item: any) => item.generated && item.printPath)) {
    await page.evaluate(
      (path) => (window as any).__TAURI_INTERNALS__.invoke("cleanup_printable_pdf", { path }),
      item.printPath,
    );
  }
  const sessions = await readdir(join(temporary, "pliflo-rendered"));
  assert.equal(sessions.length, 0, "Render sessions leaked");
  // Restore a synthetic missing job. Only GetJob is used; never submit/cancel.
  const sourcePdf = batch.find((item: any) => item.format === "pdf" && item.state !== "failed");
  if (sourcePdf && printers.length) {
    const printer = printers[0].name;
    const restored = {
      ...sourcePdf,
      state: "submitted",
      preparing: false,
      systemJobId: `win:4294967295:${Buffer.from(printer).toString("hex")}:Pliflo-test-missing`,
      submittedPrinter: printer,
      submittedAt: Date.now(),
    };
    await page.evaluate(
      (item) => localStorage.setItem("pliflo-batch", JSON.stringify([item])),
      restored,
    );
    await page.reload();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem("pliflo-history") ?? "[]");
        return history.some(
          (item: any) =>
            item.systemJobId?.endsWith(":Pliflo-test-missing") && item.state === "unconfirmed",
        );
      },
      { timeout: 20_000 },
    );
    for (const theme of ["light", "dark"]) {
      await page
        .locator(".app-shell")
        .evaluate((element, value) => element.setAttribute("data-theme", value), theme);
      await page.screenshot({ path: join(output, `unconfirmed-${theme}.png`) });
    }
  }
  await readFile(join(output, "report.json"));
  assert.deepEqual(
    await Promise.all(inputs.map(sourceHash)),
    sourceHashes,
    "Original sources changed",
  );
} finally {
  await browser?.close();
  // Close only our launcher's child window (portable), or our application window.
  // Let the portable launcher finish ExecWait and remove its extracted DLLs.
  if (child.pid && child.exitCode === null) {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid}" | ForEach-Object { (Get-Process -Id $_.ProcessId).CloseMainWindow() | Out-Null }; (Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null`,
      ],
      { windowsHide: true },
    );
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++)
      await new Promise((done) => setTimeout(done, 100));
    assert.notEqual(child.exitCode, null, "Application/portable launcher did not exit cleanly");
  }
  const leftovers = (await readdir(temporary)).filter((name) => /^ns.*\.tmp$/i.test(name));
  assert.deepEqual(leftovers, [], "Portable extraction directory leaked");
  if (monitor?.pid) {
    if (monitor.exitCode === null) await new Promise((done) => monitor.once("exit", done));
    const { timeline: _timeline, ...summary } = JSON.parse(
      await readFile(join(output, "memory.json"), "utf8"),
    );
    console.log("Memory samples:", summary);
  }
}
