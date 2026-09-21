import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import assert from "node:assert/strict";

// Integration test of OUR staged application; never invokes a print submission.
// Usage: bun scripts/check-windows-cycles.ts <staged-exe> <fixture> [...]
assert.equal(process.platform, "win32");
const [executable, ...inputs] = process.argv.slice(2).map((path) => resolve(path));
assert(executable && inputs.length);
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
  const _startupMs = Math.round(performance.now() - started);
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

  const cdp = await page.context().newCDPSession(page);
  const rounds = [];
  const snapshot = async (phase: string) => ({
    phase,
    timeMs: Date.now(),
    heap: await cdp.send("Runtime.getHeapUsage"),
  });
  rounds.push(await snapshot("empty"));
  for (let round = 0; round < 3; round++) {
    const began = performance.now();
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
        const batch = JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]");
        return batch.length === count && batch.every((item: any) => !item.preparing);
      },
      inputs.length,
      { timeout: 180000 },
    );
    const batch = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]"),
    );
    for (const item of batch)
      assert.equal(
        item.state === "failed",
        expectedFailures.has(basename(item.path)),
        `${item.name}: ${item.error}`,
      );
    rounds.push({
      ...(await snapshot(`round-${round}-ready`)),
      durationMs: Math.round(performance.now() - began),
      pages: batch.reduce((n: number, item: any) => n + (item.pages ?? 0), 0),
    });
    while (await page.locator(".file-row .danger-hover").count())
      await page.locator(".file-row .danger-hover").first().click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("pliflo-batch") ?? "[]").length === 0,
    );
    await new Promise((done) => setTimeout(done, 3500));
    assert.equal(
      (await readdir(join(temporary, "pliflo-rendered"))).length,
      0,
      "Removed batch leaked sessions",
    );
    rounds.push(await snapshot(`round-${round}-removed`));
  }
  // Diagnostic only: not part of normal application behavior or headline measurements.
  await cdp.send("HeapProfiler.collectGarbage");
  await new Promise((done) => setTimeout(done, 1500));
  rounds.push(await snapshot("diagnostic-forced-gc"));
  assert.deepEqual(errors, []);
  await writeFile(join(output, "cycles.json"), JSON.stringify(rounds, null, 2));
  console.log(JSON.stringify({ output, rounds }));
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
