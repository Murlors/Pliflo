export interface PageSize {
  widthPt: number;
  heightPt: number;
}
export interface PngImage {
  png: string;
  width: number;
  height: number;
}
// Path2D / CanvasGradient / CanvasPattern serialize as empty objects in JSON.
// 保留该表示和 unsupported 标记，由原生重放器拒绝不支持的绘图。
export type OpaqueCanvasObject = Record<string, never>;
export interface CanvasState {
  matrix: [number, number, number, number, number, number];
  fill: string | OpaqueCanvasObject;
  stroke: string | OpaqueCanvasObject;
  alpha: number;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
  font: string;
  baseline: CanvasTextBaseline;
  align: CanvasTextAlign;
  direction?: "ltr" | "rtl";
  composite: GlobalCompositeOperation;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowColor: string;
}
export interface CanvasArguments {
  save: [];
  restore: [];
  beginPath: [];
  closePath: [];
  moveTo: [number, number];
  lineTo: [number, number];
  bezierCurveTo: [number, number, number, number, number, number];
  quadraticCurveTo: [number, number, number, number];
  rect: [number, number, number, number];
  arc: [number, number, number, number, number, boolean?];
  arcTo: [number, number, number, number, number];
  ellipse: [number, number, number, number, number, number, number, boolean?];
  clip: [] | [CanvasFillRule] | [OpaqueCanvasObject, CanvasFillRule?];
  fill: [] | [CanvasFillRule] | [OpaqueCanvasObject, CanvasFillRule?];
  stroke: [] | [OpaqueCanvasObject];
  fillRect: [number, number, number, number];
  strokeRect: [number, number, number, number];
  clearRect: [number, number, number, number];
  fillText: [string, number, number, number?];
  strokeText: [string, number, number, number?];
  drawImage:
    | [PngImage, number, number, number, number]
    | [PngImage, number, number, number, number, number, number, number, number];
}
export type CanvasOperation = keyof CanvasArguments;
export type CanvasCommand = {
  [K in CanvasOperation]: { op: K; args: CanvasArguments[K]; state: CanvasState };
}[CanvasOperation];
export interface CanvasRecording {
  commands: CanvasCommand[];
  unsupported: string[];
}
/** 文档级字体只在首个页面发送；数据必须已经解除 OOXML 字体混淆。 */
export interface FontResource {
  family: string;
  weight: number;
  style: "normal" | "italic";
  bytes: Uint8Array;
}
export interface PageRecording extends CanvasRecording {
  version: 1;
  index: number;
  sourcePages: number;
  size: PageSize;
  width: number;
  height: number;
  reference?: string;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const emptyObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  Object.keys(value).length === 0;
const fillRule = (value: unknown): boolean => value === "nonzero" || value === "evenodd";
/** 状态也参与 JSON 传输，拒绝 NaN/Infinity 变成 null 或遗漏必要字段。 */
export function validateCanvasState(value: unknown): asserts value is CanvasState {
  const state = object(value, "Canvas state");
  if (state.direction !== undefined && state.direction !== "ltr" && state.direction !== "rtl")
    throw new Error("Invalid Canvas text direction");
  if (
    !Array.isArray(state.matrix) ||
    state.matrix.length !== 6 ||
    !state.matrix.every(finite) ||
    !Array.isArray(state.dash) ||
    !state.dash.every((item) => finite(item) && item >= 0)
  )
    throw new Error("Invalid Canvas matrix or dash");
  for (const key of [
    "alpha",
    "lineWidth",
    "miterLimit",
    "dashOffset",
    "shadowBlur",
    "shadowOffsetX",
    "shadowOffsetY",
  ]) {
    if (!finite(state[key])) throw new Error(`Invalid Canvas state: ${key}`);
  }
  if (
    typeof state.alpha !== "number" ||
    state.alpha < 0 ||
    state.alpha > 1 ||
    typeof state.lineWidth !== "number" ||
    state.lineWidth <= 0 ||
    typeof state.miterLimit !== "number" ||
    state.miterLimit <= 0 ||
    typeof state.shadowBlur !== "number" ||
    state.shadowBlur < 0
  )
    throw new Error("Invalid Canvas state range");
  for (const key of ["font", "shadowColor"])
    if (typeof state[key] !== "string") throw new Error(`Invalid Canvas state: ${key}`);
  for (const key of ["fill", "stroke"])
    if (typeof state[key] !== "string" && !emptyObject(state[key]))
      throw new Error(`Invalid Canvas paint: ${key}`);
  const enums: Record<string, readonly string[]> = {
    lineCap: ["butt", "round", "square"],
    lineJoin: ["round", "bevel", "miter"],
    baseline: ["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"],
    align: ["left", "right", "center", "start", "end"],
    composite: [
      "source-over",
      "source-in",
      "source-out",
      "source-atop",
      "destination-over",
      "destination-in",
      "destination-out",
      "destination-atop",
      "lighter",
      "copy",
      "xor",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ],
  };
  for (const [key, choices] of Object.entries(enums)) {
    const field = state[key];
    if (typeof field !== "string" || !choices.includes(field))
      throw new Error(`Invalid Canvas state: ${key}`);
  }
}
/** 校验动态拦截的 Canvas 参数后才构造有判别字段的命令，禁止未知操作静默透传。 */
export function canvasCommand(op: string, args: unknown[], state: CanvasState): CanvasCommand {
  validateCanvasState(state);
  let valid: boolean;
  const numbers = (count: number): boolean => args.length === count && args.every(finite);
  switch (op) {
    case "save":
    case "restore":
    case "beginPath":
    case "closePath":
      valid = numbers(0);
      break;
    case "moveTo":
    case "lineTo":
      valid = numbers(2);
      break;
    case "bezierCurveTo":
      valid = numbers(6);
      break;
    case "quadraticCurveTo":
    case "rect":
    case "fillRect":
    case "strokeRect":
    case "clearRect":
      valid = numbers(4);
      break;
    case "arcTo":
      valid = numbers(5);
      break;
    case "arc":
    case "ellipse": {
      const count = op === "arc" ? 5 : 7;
      valid =
        numbers(count) ||
        (args.length === count + 1 &&
          args.slice(0, count).every(finite) &&
          typeof args[count] === "boolean");
      break;
    }
    case "clip":
    case "fill":
      valid =
        args.length === 0 ||
        (args.length === 1 && (fillRule(args[0]) || emptyObject(args[0]))) ||
        (args.length === 2 && emptyObject(args[0]) && fillRule(args[1]));
      break;
    case "stroke":
      valid = args.length === 0 || (args.length === 1 && emptyObject(args[0]));
      break;
    case "fillText":
    case "strokeText":
      valid =
        (args.length === 3 || args.length === 4) &&
        typeof args[0] === "string" &&
        args.slice(1).every(finite);
      break;
    case "drawImage": {
      const image = object(args[0], "Canvas image");
      valid =
        (args.length === 5 || args.length === 9) &&
        args.slice(1).every(finite) &&
        typeof image.png === "string" &&
        image.png.length > 0 &&
        finite(image.width) &&
        image.width > 0 &&
        finite(image.height) &&
        image.height > 0;
      break;
    }
    default:
      throw new Error(`Unsupported Canvas operation: ${String(op)}`);
  }
  if (!valid) throw new Error(`Invalid Canvas arguments: ${op}`);
  // 上述分支逐一校验各操作的 tuple；断言只跨越动态拦截边界。
  return { op, args, state } as CanvasCommand;
}
export function validatePageGeometry(
  page: Pick<PageRecording, "index" | "sourcePages" | "size" | "width" | "height">,
): void {
  if (
    !Number.isSafeInteger(page.index) ||
    page.index < 0 ||
    !Number.isSafeInteger(page.sourcePages) ||
    page.index >= page.sourcePages ||
    !finite(page.size.widthPt) ||
    page.size.widthPt <= 0 ||
    !finite(page.size.heightPt) ||
    page.size.heightPt <= 0 ||
    !Number.isSafeInteger(page.width) ||
    page.width <= 0 ||
    !Number.isSafeInteger(page.height) ||
    page.height <= 0
  )
    throw new Error("Invalid page geometry");
}
