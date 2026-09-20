import { describe, it, expect } from "vite-plus/test";
import {
  canvasCommand,
  validateCanvasState,
  validatePageGeometry,
  type CanvasState,
  type CanvasOperation,
  type CanvasCommand,
} from "../src/protocol";
import { TextRunRecorder } from "../src/text";

function state(): CanvasState {
  return {
    matrix: [1, 0, 0, 1, 0, 0],
    fill: "#000000",
    stroke: "#000000",
    alpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    dash: [],
    dashOffset: 0,
    font: "10px sans-serif",
    baseline: "alphabetic",
    align: "start",
    composite: "source-over",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
  };
}

describe("page geometry", () => {
  it("rejects invalid page counts, dimensions and nonfinite geometry", () => {
    const page = {
      index: 0,
      sourcePages: 2,
      size: { widthPt: 595.28, heightPt: 841.89 },
      width: 1191,
      height: 1684,
    };
    expect(() => validatePageGeometry(page)).not.toThrow();
    for (const delta of [
      { index: -1 },
      { index: 2 },
      { sourcePages: 0 },
      { sourcePages: 1.5 },
      { width: 0 },
      { height: 1.5 },
      { width: NaN },
      { size: { widthPt: Infinity, heightPt: 10 } },
    ]) {
      expect(() => validatePageGeometry({ ...page, ...delta })).toThrow();
    }
  });
});

describe("Canvas wire commands", () => {
  const image = { png: "aGVsbG8=", width: 10, height: 20 };
  const operations: Record<CanvasOperation, unknown[]> = {
    save: [],
    restore: [],
    beginPath: [],
    closePath: [],
    moveTo: [1, 2],
    lineTo: [1, 2],
    bezierCurveTo: [1, 2, 3, 4, 5, 6],
    quadraticCurveTo: [1, 2, 3, 4],
    rect: [1, 2, 3, 4],
    arc: [1, 2, 3, 4, 5],
    arcTo: [1, 2, 3, 4, 5],
    ellipse: [1, 2, 3, 4, 5, 6, 7],
    clip: ["evenodd"],
    fill: [],
    stroke: [],
    fillRect: [1, 2, 3, 4],
    strokeRect: [1, 2, 3, 4],
    clearRect: [1, 2, 3, 4],
    fillText: ["中文", 1, 2],
    strokeText: ["Text", 1, 2, 100],
    drawImage: [image, 1, 2, 3, 4],
  };
  it("preserves every recorded operation and its JSON payload", () => {
    for (const [op, args] of Object.entries(operations)) {
      const snapshot = state();
      expect(JSON.parse(JSON.stringify(canvasCommand(op, args, snapshot)))).toEqual({
        op,
        args,
        state: snapshot,
      });
    }
    expect(canvasCommand("drawImage", [image, 1, 2, 3, 4, 5, 6, 7, 8], state()).args).toHaveLength(
      9,
    );
    expect(canvasCommand("arc", [1, 2, 3, 4, 5, true], state()).args).toHaveLength(6);
    expect(canvasCommand("ellipse", [1, 2, 3, 4, 5, 6, 7, false], state()).args).toHaveLength(8);
  });
  it("keeps Path2D placeholders and unsupported paint/composite state for explicit native rejection", () => {
    for (const op of ["fill", "clip", "stroke"])
      expect(canvasCommand(op, [{}], state()).args).toEqual([{}]);
    expect(canvasCommand("clip", [{}, "evenodd"], state()).args).toEqual([{}, "evenodd"]);
    const unsupported = { ...state(), fill: {}, composite: "multiply" as const, shadowBlur: 5 };
    expect(canvasCommand("fill", [], unsupported).state).toEqual(unsupported);
  });
  it("fails on unknown operations, malformed tuples and nonserializable numbers", () => {
    const invalid: [string, unknown[]][] = [
      ["unknown", []],
      ["save", [1]],
      ["moveTo", [1]],
      ["lineTo", [1, Infinity]],
      ["fillRect", [0, 0, NaN, 1]],
      ["fillText", [42, 1, 2]],
      ["strokeText", ["text", 1]],
      ["arc", [1, 2, 3, 4, 5, 1]],
      ["fill", ["invalid"]],
      ["stroke", [{ custom: true }]],
      ["clip", [new Date()]],
      ["drawImage", [image, 1, 2]],
      ["drawImage", [{ png: "", width: 1, height: 1 }, 1, 2, 3, 4]],
      ["drawImage", [{ png: "abc", width: 0, height: 1 }, 1, 2, 3, 4]],
    ];
    for (const [op, args] of invalid) expect(() => canvasCommand(op, args, state())).toThrow();
  });
  it("validates state at the same command-construction boundary used by the recorder", () => {
    for (const delta of [
      { matrix: [1, 0, 0, 1, 0] },
      { matrix: [1, 0, 0, 1, 0, NaN] },
      { alpha: 2 },
      { lineWidth: 0 },
      { dash: [-1] },
      { shadowBlur: -1 },
      { font: null },
      { composite: "unknown" },
      { lineCap: "unknown" },
      { direction: "unknown" },
      { fill: { hidden: "paint" } },
    ]) {
      expect(() => validateCanvasState({ ...state(), ...delta })).toThrow();
    }
    expect(() => canvasCommand("save", [], { ...state(), alpha: NaN })).toThrow();
  });
});

describe("Unicode grapheme recording", () => {
  const text = (value: string, x: number, patch: Partial<CanvasState> = {}) =>
    canvasCommand("fillText", [value, x, 10], { ...state(), ...patch });
  it("keeps accents and ZWJ sequences intact without merging ordinary words", () => {
    const recorder = new TextRunRecorder();
    const commands: CanvasCommand[] = [];
    recorder.append(commands, text("e", 0), 5);
    recorder.append(commands, text("\u0301", 5), 0);
    recorder.append(commands, text(" ", 5), 3);
    recorder.append(commands, text("👩", 8), 10);
    recorder.append(commands, text("\u200d", 18), 0);
    recorder.append(commands, text("💻", 18), 10);
    expect(commands.map((command) => command.args[0])).toEqual(["é", " ", "👩‍💻"]);
    recorder.append(commands, text("f", 28), 5);
    recorder.append(commands, text("fi", 33), 10);
    expect(commands.slice(-2).map((command) => command.args[0])).toEqual(["f", "fi"]);
  });
  it("preserves positioned text, style changes, direction and intervening paint", () => {
    for (const patch of [
      { fill: "#ff0000" },
      { font: "11px serif" },
      { direction: "rtl" },
      { align: "center" },
    ] as Partial<CanvasState>[]) {
      const commands: CanvasCommand[] = [];
      const recorder = new TextRunRecorder();
      recorder.append(commands, text("e", 0), 5);
      recorder.append(commands, text("\u0301", 5, patch), 0);
      expect(commands).toHaveLength(2);
    }
    const commands: CanvasCommand[] = [];
    const recorder = new TextRunRecorder();
    recorder.append(commands, text("e", 0), 5);
    recorder.append(commands, text("\u0301", 6), 0);
    recorder.append(commands, canvasCommand("fillRect", [0, 0, 1, 1], state()));
    recorder.append(commands, text("\u0301", 6), 0);
    expect(commands).toHaveLength(4);
  });
});
