import {
  canvasCommand,
  type CanvasRecording,
  type CanvasState,
  type CanvasOperation,
  type FontResource,
} from "./protocol";
import { TextRunRecorder } from "./text";

const recordings = new WeakMap<HTMLCanvasElement, CanvasRecording>();
const binaryImages = new WeakMap<HTMLCanvasElement, Promise<Blob>[]>();
const releases = new WeakMap<HTMLCanvasElement, () => void>();
const createElement = document.createElement.bind(document);
const draw = [
  "save",
  "restore",
  "beginPath",
  "closePath",
  "moveTo",
  "lineTo",
  "bezierCurveTo",
  "quadraticCurveTo",
  "rect",
  "arc",
  "arcTo",
  "ellipse",
  "clip",
  "fill",
  "stroke",
  "fillRect",
  "strokeRect",
  "clearRect",
  "fillText",
  "strokeText",
  "drawImage",
] as const satisfies readonly CanvasOperation[];

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}
function imageSource(
  value: unknown,
): value is CanvasImageSource & { width: number; height: number } {
  return (
    value instanceof HTMLCanvasElement ||
    value instanceof HTMLImageElement ||
    value instanceof HTMLVideoElement ||
    (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}
/** 必须在绘图前调用；图片快照保留为 Blob，由 encodePage 二进制传输。 */
export function recordCanvas(canvas: HTMLCanvasElement): CanvasRecording {
  const existing = recordings.get(canvas);
  if (existing) return existing;
  const ctx = context(canvas);
  const recording: CanvasRecording = { commands: [], unsupported: [] };
  const images: Promise<Blob>[] = [];
  const textRuns = new TextRunRecorder();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  binaryImages.set(canvas, images);
  const state = (): CanvasState => {
    const { a, b, c, d, e, f } = ctx.getTransform();
    return {
      matrix: [a, b, c, d, e, f],
      fill: typeof ctx.fillStyle === "string" ? ctx.fillStyle : {},
      stroke: typeof ctx.strokeStyle === "string" ? ctx.strokeStyle : {},
      alpha: ctx.globalAlpha,
      lineWidth: ctx.lineWidth,
      lineCap: ctx.lineCap,
      lineJoin: ctx.lineJoin,
      miterLimit: ctx.miterLimit,
      dash: ctx.getLineDash(),
      dashOffset: ctx.lineDashOffset,
      font: ctx.font,
      baseline: ctx.textBaseline,
      align: ctx.textAlign,
      direction:
        ctx.direction === "inherit"
          ? getComputedStyle(canvas).direction === "rtl"
            ? "rtl"
            : "ltr"
          : ctx.direction,
      composite: ctx.globalCompositeOperation,
      shadowBlur: ctx.shadowBlur,
      shadowOffsetX: ctx.shadowOffsetX,
      shadowOffsetY: ctx.shadowOffsetY,
      shadowColor: ctx.shadowColor,
    };
  };
  for (const name of draw) {
    const original = ctx[name];
    originals.set(name, Object.getOwnPropertyDescriptor(ctx, name));
    // DOM 重载函数的动态拦截采用 unknown[]，校验后才进入序列化协议。
    Object.defineProperty(ctx, name, {
      configurable: true,
      writable: true,
      enumerable: true,
      value: (...args: unknown[]): void => {
        const saved = state();
        let serial = args;
        if (name === "drawImage") {
          const source = args[0],
            image = createElement("canvas");
          if (!imageSource(source)) throw new Error("Unsupported Canvas image source");
          image.width = source.width;
          image.height = source.height;
          context(image).drawImage(source, 0, 0);
          const payload = `@binary:${images.length}`;
          const blob = new Promise<Blob>((resolve, reject) =>
            image.toBlob((value) => {
              image.width = image.height = 0;
              if (value) resolve(value);
              else reject(new Error("Canvas PNG unavailable"));
            }, "image/png"),
          );
          // 编码失败由 encodePage 上报；异步绘图期间不产生未处理 rejection。
          void blob.catch(() => {});
          images.push(blob);
          serial = [{ png: payload, width: image.width, height: image.height }, ...args.slice(1)];
          if (args.length === 3) serial.push(image.width, image.height);
        }
        if (serial.some((value) => value instanceof Path2D)) recording.unsupported.push("Path2D");
        const wireArgs = serial.map((value) => (value instanceof Path2D ? {} : value));
        const command = canvasCommand(name, wireArgs, saved);
        textRuns.append(
          recording.commands,
          command,
          command.op === "fillText" ? ctx.measureText(command.args[0]).width : undefined,
        );
        Reflect.apply(original, ctx, args);
      },
    });
  }
  recordings.set(canvas, recording);
  releases.set(canvas, () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(ctx, name, descriptor);
      else Reflect.deleteProperty(ctx, name);
    }
    recording.commands.length = 0;
    recording.unsupported.length = 0;
    images.length = 0;
  });
  return recording;
}

/** Call after encodePage settles; releases closures/assets without waiting for GC. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  releases.get(canvas)?.();
  releases.delete(canvas);
  recordings.delete(canvas);
  binaryImages.delete(canvas);
  canvas.width = canvas.height = 0;
}

/** CCP1: magic、JSON 长度、JSON、图片数及各 PNG 长度/原始字节，整数使用 little-endian。 */
export async function encodePage(
  canvas: HTMLCanvasElement,
  widthPt: number,
  heightPt: number,
  fonts: readonly FontResource[] = [],
): Promise<Uint8Array> {
  const recording = recordings.get(canvas);
  if (!recording || !binaryImages.has(canvas)) throw new Error("Canvas was not recorded");
  const json = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      size: { widthPt, heightPt },
      width: canvas.width,
      height: canvas.height,
      ...recording,
      ...(fonts.length
        ? { fonts: fonts.map(({ family, weight, style }) => ({ family, weight, style })) }
        : {}),
    }),
  );
  const images = await Promise.all(binaryImages.get(canvas)!);
  const parts: BlobPart[] = [];
  const integer = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  };
  parts.push(
    new TextEncoder().encode(fonts.length ? "CCP2" : "CCP1"),
    integer(json.length),
    json,
    integer(images.length),
  );
  for (const image of images) parts.push(integer(image.size), image);
  if (fonts.length) {
    if (
      fonts.length > 64 ||
      fonts.reduce((sum, font) => sum + font.bytes.byteLength, 0) > 64 * 1024 * 1024
    )
      throw new Error("Embedded fonts exceed document resource limits");
    parts.push(integer(fonts.length));
    for (const font of fonts)
      parts.push(integer(font.bytes.byteLength), new Uint8Array(font.bytes).buffer);
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
