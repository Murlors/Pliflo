import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFERENCES } from "../src/app/constants";
import { COPY } from "../src/app/i18n";
import { canRetryJob, createQueueItem, isActiveJob, retryQueueItem } from "../src/lib/print";
import { describeReasons } from "../src/lib/printer-status";
import { loadStoredBatch } from "../src/lib/storage";
import type { QueueItem } from "../src/app/types";

function document(): QueueItem {
  return createQueueItem({
    path: "/source/report.pdf",
    printPath: "/source/report.pdf",
    name: "report.pdf",
    sizeBytes: 1024,
    pages: 4,
    format: "pdf",
    generated: false,
  });
}

void test("unconfirmed output is neither active nor automatically retryable", () => {
  const item = { ...document(), state: "unconfirmed" as const };
  assert.equal(isActiveJob(item), false);
  assert.equal(canRetryJob(item), false);
  assert.match(describeReasons(["job-no-longer-in-queue"], COPY.en)[0], /Check the output/);
});

void test("retry preserves source and submitted settings but creates a fresh preparation attempt", () => {
  const item = document();
  item.state = "failed";
  item.settings.duplex = "long";
  item.submittedSettings = { ...item.settings, duplex: "none", tray: "tray-3", copies: 2 };
  item.systemJobId = "Printer-104";
  item.systemReasons = ["media-empty-report"];
  item.error = "old error";
  const before = JSON.stringify(item);
  const retry = retryQueueItem(item);
  assert.notEqual(retry.id, item.id);
  assert.equal(retry.path, item.path);
  assert.equal(retry.state, "queued");
  assert.equal(retry.preparing, true);
  assert.equal(retry.printPath, "");
  assert.deepEqual(retry.settings, item.submittedSettings);
  assert.equal(retry.systemJobId, undefined);
  assert.equal(retry.systemReasons, undefined);
  assert.equal(retry.error, undefined);
  assert.equal(JSON.stringify(item), before);
});

void test("blocked and accepted jobs cannot be requeued as failures", () => {
  for (const state of ["submitted", "submitting", "printing", "blocked"] as const) {
    const item = { ...document(), state };
    assert.equal(isActiveJob(item), true);
    assert.equal(canRetryJob(item), false);
  }
  assert.equal(canRetryJob({ ...document(), state: "failed" }), true);
  assert.equal(canRetryJob({ ...document(), state: "cancelled" }), true);
  assert.equal(canRetryJob({ ...document(), state: "completed" }), false);
});

void test("restore preserves failures and blocked system jobs instead of silently reprinting", () => {
  const failed = { ...document(), state: "failed", error: "Unreadable source" };
  const blocked = { ...document(), state: "blocked", systemJobId: "Printer-104" };
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => JSON.stringify([failed, blocked]),
    },
  });
  try {
    const result = loadStoredBatch(DEFAULT_PREFERENCES);
    assert.equal(result[0].state, "failed");
    assert.equal(result[0].error, "Unreadable source");
    assert.equal(result[1].state, "blocked");
    assert.equal(result[1].systemJobId, "Printer-104");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  }
});

void test("missing paper reports never invent a tray and unknown driver reasons remain visible", () => {
  assert.deepEqual(
    describeReasons(
      ["none", "media-empty-report", "media-empty-warning", "vendor-code"],
      COPY["zh-CN"],
    ),
    ["纸盒缺纸，具体纸盒未知", "vendor-code"],
  );
});
