import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createServer } from "node:net";
// Read-only launch benchmark. Never imports documents or submits/cancels jobs.
assert.equal(process.platform, "win32");
assert(process.argv[2], "Usage: bun scripts/check-windows-startup.ts <exe> [runs]");
const exe = resolve(process.argv[2]);
const runs = Number(process.argv[3] || 3);
assert(Number.isInteger(runs) && runs > 0 && runs <= 20);
const root = await mkdtemp(join(tmpdir(), "pliflo-startup-"));
const results = [];
for (let run = 0; run < runs; run++) {
  const temporary = join(root, `中文 temp ${run}`);
  await mkdir(temporary);
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  const start = performance.now();
  let extractedMs;
  const child = spawn(exe, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`,
      TEMP: temporary,
      TMP: temporary,
      WEBVIEW2_USER_DATA_FOLDER: join(root, "profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  let browser;
  try {
    for (let i = 0; i < 300; i++) {
      if (
        extractedMs === undefined &&
        (await readdir(temporary)).some((x) => /^ns.*\.tmp$/i.test(x))
      )
        extractedMs = Math.round(performance.now() - start);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 400 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert(browser);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForSelector(".preview-stage");
    const readyMs = Math.round(performance.now() - start);
    results.push({
      run,
      profile: run ? "reused" : "fresh",
      extractionStartedMs: extractedMs,
      readyMs,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await browser?.close();
    if (child.pid && child.exitCode === null)
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid}" | ForEach-Object { (Get-Process -Id $_.ProcessId).CloseMainWindow() | Out-Null }; (Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    for (let i = 0; i < 100 && child.exitCode === null; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.notEqual(child.exitCode, null);
    assert(!(await readdir(temporary)).some((x) => /^ns.*\.tmp$/i.test(x)));
  }
}
await writeFile(join(root, "startup.json"), JSON.stringify({ exe, results }, null, 2));
console.log(root);
