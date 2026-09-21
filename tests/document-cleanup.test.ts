import { test } from "node:test";
import assert from "node:assert/strict";

void test("artifact cleanup retries transient locks and never removes a source", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  // The recorder captures createElement at import, but this test never renders.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        throw new Error("Unexpected canvas rendering");
      },
    },
  });
  const { cleanupGeneratedDocument } = await import("../src/lib/documents");
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          assert.equal(command, "cleanup_printable_pdf");
          calls.push(args);
          if (calls.length < 3) throw new Error("sharing violation");
        },
      },
    },
  });
  try {
    await cleanupGeneratedDocument({ generated: false, printPath: "C:\\original.pdf" });
    assert.equal(calls.length, 0);
    const path = "C:\\temp\\pliflo-rendered\\session\\printable.pdf";
    await cleanupGeneratedDocument({ generated: true, printPath: path });
    assert.deepEqual(calls, [{ path }, { path }, { path }]);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
