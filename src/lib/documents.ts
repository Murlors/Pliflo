import { invoke } from "@tauri-apps/api/core";
import { createRecordedCanvas, recordingPage } from "./cairo";
import { documentFonts } from "./document-fonts";
import type { FontResource } from "@pliflo/canvas-recorder/protocol";
import type { DocumentFormat, DocumentInfo, DocumentRenderOptions } from "../app/types";

const A4 = { widthPt: 595.28, heightPt: 841.89 };
const LETTER = { widthPt: 612, heightPt: 792 };
const RENDER_DPI = 144;
const EMU_PER_POINT = 12_700;

export type FileInfo = { path: string; name: string; sizeBytes: number };
type RenderedPage = {
  bytes: Uint8Array;
};
type PageSink = (page: RenderedPage) => Promise<void>;

export const SUPPORTED_EXTENSIONS = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "md",
  "markdown",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
] as const;

export function documentFormat(path: string): DocumentFormat | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  if (extension === "xlsx") return "xlsx";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension ?? "")) return "image";
  return null;
}

async function canvasToPage(
  canvas: HTMLCanvasElement,
  pageWidthPt: number,
  pageHeightPt: number,
  fonts: readonly FontResource[] = [],
): Promise<RenderedPage> {
  return {
    bytes: await recordingPage(canvas, pageWidthPt, pageHeightPt, fonts),
  };
}

function pagePixels(widthPt: number, heightPt: number) {
  const factor = RENDER_DPI / 72;
  return { width: Math.round(widthPt * factor), height: Math.round(heightPt * factor) };
}

async function createPdfSession() {
  const session = await invoke<string>("begin_printable_pdf");
  let index = 0;
  return {
    add: async (page: RenderedPage) => {
      await invoke("append_vector_pdf_page", page.bytes, {
        headers: {
          "x-pliflo-session": session,
          "x-pliflo-index": String(index),
        },
      });
      index += 1;
    },
    finish: () => invoke<string>("finalize_vector_pdf", { session, count: index }),
    abort: () => invoke("cleanup_render_session", { session }).catch(() => undefined),
    cancel: () => invoke("cancel_vector_pdf", { session }).catch(() => undefined),
    count: () => index,
  };
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = url;
  });
}

async function readLocalFile(path: string) {
  const bytes = await invoke<ArrayBuffer>("read_local_file", { path });
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes as never).buffer;
}

function imageMimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  return "application/octet-stream";
}

async function renderImage(path: string, options: DocumentRenderOptions, onPage: PageSink) {
  const bytes = await readLocalFile(path);
  const url = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(path) }));
  let image: HTMLImageElement;
  try {
    image = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const landscape = image.naturalWidth > image.naturalHeight;
  const page = landscape
    ? { widthPt: A4.heightPt, heightPt: A4.widthPt }
    : { widthPt: A4.widthPt, heightPt: A4.heightPt };
  const pixels = pagePixels(page.widthPt, page.heightPt);
  const canvas = createRecordedCanvas();
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const margin = Math.round(36 * (RENDER_DPI / 72));
  const availableWidth = canvas.width - margin * 2;
  const availableHeight = canvas.height - margin * 2;
  const naturalScale = RENDER_DPI / 96;
  const desiredWidth = image.naturalWidth * naturalScale;
  const desiredHeight = image.naturalHeight * naturalScale;
  const fitScale = Math.min(availableWidth / desiredWidth, availableHeight / desiredHeight);
  const scale = options.imageSizing === "actual" ? Math.min(1, fitScale) : fitScale;
  const width = desiredWidth * scale;
  const height = desiredHeight * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  await onPage(await canvasToPage(canvas, page.widthPt, page.heightPt));
}

function sanitizeMarkdown(html: string) {
  const parsed = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  for (const unsafe of parsed.querySelectorAll(
    "script,style,iframe,object,embed,form,input,button",
  )) {
    unsafe.remove();
  }
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (attribute.name === "href" || attribute.name === "src") &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return parsed.body.firstElementChild?.innerHTML ?? "";
}

async function inlineMarkdownImages(html: string, sourcePath: string) {
  const parsed = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1);
  const objectUrls: string[] = [];
  for (const image of parsed.querySelectorAll("img")) {
    const src = image.getAttribute("src")?.trim();
    if (!src || /^https?:/i.test(src) || src.startsWith("//")) {
      image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
      continue;
    }
    if (src.startsWith("data:")) {
      image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
      continue;
    }
    try {
      if (src.startsWith("/") || src.split("/").includes(".."))
        throw new Error("Unsafe image path.");
      const localPath = `${sourceDir}${src}`;
      const objectUrl = URL.createObjectURL(
        new Blob([await readLocalFile(localPath)], { type: imageMimeType(localPath) }),
      );
      objectUrls.push(objectUrl);
      image.setAttribute("src", objectUrl);
    } catch {
      image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
    }
  }
  return { html: parsed.body.firstElementChild?.innerHTML ?? "", objectUrls };
}

const MARKDOWN_PAGE = { width: 794, height: 1123, margin: 64, scale: 2 };

function markdownCanvas() {
  const canvas = createRecordedCanvas();
  canvas.width = MARKDOWN_PAGE.width * MARKDOWN_PAGE.scale;
  canvas.height = MARKDOWN_PAGE.height * MARKDOWN_PAGE.scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.scale(MARKDOWN_PAGE.scale, MARKDOWN_PAGE.scale);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, MARKDOWN_PAGE.width, MARKDOWN_PAGE.height);
  context.textBaseline = "top";
  return { canvas, context };
}

function breakMarkdownLine(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (!text) return [""];
  const parts = text.split(/(\s+)/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const pushPart = (part: string) => {
    const next = line ? `${line}${part}` : part.trimStart();
    if (context.measureText(next).width <= maxWidth) {
      line = next;
      return;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = "";
    if (context.measureText(part).width <= maxWidth) {
      line = part.trimStart();
      return;
    }
    for (const character of Array.from(part)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
  };
  for (const part of parts) pushPart(part);
  if (line.trim() || !lines.length) lines.push(line.trimEnd());
  return lines;
}

async function renderMarkdownHtml(html: string, onPage: PageSink) {
  const parsed = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const root = parsed.body.firstElementChild;
  let current = markdownCanvas();
  let y = MARKDOWN_PAGE.margin;
  const left = MARKDOWN_PAGE.margin;
  const contentWidth = MARKDOWN_PAGE.width - MARKDOWN_PAGE.margin * 2;
  const bottom = MARKDOWN_PAGE.height - MARKDOWN_PAGE.margin;

  const nextPage = async () => {
    await onPage(await canvasToPage(current.canvas, A4.widthPt, A4.heightPt));
    current = markdownCanvas();
    y = MARKDOWN_PAGE.margin;
  };
  const ensure = async (height: number) => {
    if (y + height > bottom && y > MARKDOWN_PAGE.margin) await nextPage();
  };
  const drawLines = async (
    text: string,
    options: { font: string; lineHeight: number; color?: string; indent?: number; after?: number },
  ) => {
    const indent = options.indent ?? 0;
    current.context.font = options.font;
    const lines = breakMarkdownLine(current.context, text.trim(), contentWidth - indent);
    await ensure(lines.length * options.lineHeight + (options.after ?? 0));
    current.context.fillStyle = options.color ?? "#171717";
    for (const line of lines) {
      current.context.fillText(line, left + indent, y);
      y += options.lineHeight;
    }
    y += options.after ?? 0;
  };

  for (const element of Array.from(root?.children ?? [])) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      const level = Number(tag[1]);
      const size = [0, 28, 23, 19, 16][level];
      if (y > MARKDOWN_PAGE.margin) y += 8;
      await drawLines(element.textContent ?? "", {
        font: `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
        lineHeight: Math.round(size * 1.25),
        after: 10,
      });
      continue;
    }
    if (tag === "p") {
      await drawLines(element.textContent ?? "", {
        font: '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        lineHeight: 22,
        after: 12,
      });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      let index = 1;
      for (const item of Array.from(element.children)) {
        const prefix = tag === "ol" ? `${index}. ` : "• ";
        await drawLines(`${prefix}${item.textContent ?? ""}`, {
          font: '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          lineHeight: 22,
          indent: 16,
          after: 3,
        });
        index += 1;
      }
      y += 8;
      continue;
    }
    if (tag === "blockquote") {
      current.context.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const lines = breakMarkdownLine(
        current.context,
        element.textContent?.trim() ?? "",
        contentWidth - 22,
      );
      const height = lines.length * 22 + 16;
      await ensure(height + 10);
      current.context.fillStyle = "#d4d4d4";
      current.context.fillRect(left, y, 3, height - 8);
      current.context.fillStyle = "#525252";
      for (const line of lines) {
        current.context.fillText(line, left + 14, y);
        y += 22;
      }
      y += 10;
      continue;
    }
    if (tag === "pre") {
      current.context.font = "12px SFMono-Regular, Menlo, monospace";
      const lines = (element.textContent ?? "")
        .replace(/\n$/, "")
        .split("\n")
        .flatMap((line) => breakMarkdownLine(current.context, line, contentWidth - 24));
      const height = Math.max(38, lines.length * 18 + 24);
      await ensure(height + 14);
      current.context.fillStyle = "#f5f5f5";
      current.context.fillRect(left, y, contentWidth, height);
      current.context.fillStyle = "#262626";
      let codeY = y + 12;
      for (const line of lines) {
        current.context.fillText(line, left + 12, codeY);
        codeY += 18;
      }
      y += height + 14;
      continue;
    }
    if (tag === "table") {
      const rows = Array.from(element.querySelectorAll("tr"));
      const columnCount = Math.max(1, ...rows.map((row) => row.children.length));
      const columnWidth = contentWidth / columnCount;
      current.context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      for (const row of rows) {
        const cells = Array.from(row.children);
        const cellLines = cells.map((cell) =>
          breakMarkdownLine(current.context, cell.textContent?.trim() ?? "", columnWidth - 16),
        );
        const rowHeight = Math.max(30, ...cellLines.map((lines) => lines.length * 18 + 12));
        await ensure(rowHeight);
        for (let column = 0; column < columnCount; column += 1) {
          const x = left + column * columnWidth;
          const cell = cells[column];
          if (cell?.tagName.toLowerCase() === "th") {
            current.context.fillStyle = "#f5f5f5";
            current.context.fillRect(x, y, columnWidth, rowHeight);
          }
          current.context.strokeStyle = "#d4d4d4";
          current.context.strokeRect(x, y, columnWidth, rowHeight);
          current.context.fillStyle = "#171717";
          let cellY = y + 6;
          for (const line of cellLines[column] ?? []) {
            current.context.fillText(line, x + 8, cellY);
            cellY += 18;
          }
        }
        y += rowHeight;
      }
      y += 14;
      continue;
    }
    if (tag === "img") {
      const src = element.getAttribute("src");
      if (!src) continue;
      try {
        const image = await loadImage(src);
        const maxHeight = Math.min(700, bottom - MARKDOWN_PAGE.margin);
        const scale = Math.min(
          1,
          contentWidth / image.naturalWidth,
          maxHeight / image.naturalHeight,
        );
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        await ensure(height + 14);
        current.context.drawImage(image, left, y, width, height);
        y += height + 14;
      } catch {
        await drawLines(element.getAttribute("alt") ?? "", {
          font: '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          lineHeight: 22,
          color: "#737373",
          after: 12,
        });
      }
      continue;
    }
    if (tag === "hr") {
      await ensure(20);
      y += 7;
      current.context.strokeStyle = "#d4d4d4";
      current.context.beginPath();
      current.context.moveTo(left, y);
      current.context.lineTo(left + contentWidth, y);
      current.context.stroke();
      y += 13;
      continue;
    }
    await drawLines(element.textContent ?? "", {
      font: '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      lineHeight: 22,
      after: 12,
    });
  }
  await onPage(await canvasToPage(current.canvas, A4.widthPt, A4.heightPt));
}

async function renderMarkdown(path: string, onPage: PageSink) {
  const { marked } = await import("marked");
  const source = new TextDecoder().decode(await readLocalFile(path));
  const prepared = await inlineMarkdownImages(
    sanitizeMarkdown(await marked.parse(source, { gfm: true, breaks: false })),
    path,
  );
  try {
    await renderMarkdownHtml(prepared.html, onPage);
  } finally {
    for (const objectUrl of prepared.objectUrls) URL.revokeObjectURL(objectUrl);
  }
}

async function renderDocx(path: string, onPage: PageSink) {
  const { DocxDocument } = await import("@silurus/ooxml/docx");
  const doc = await DocxDocument.load(await readLocalFile(path), {
    mode: "main",
  });
  try {
    await doc.waitUntilLayoutComplete();
    const fonts = await documentFonts(doc.document.embeddedFonts ?? [], (part) =>
      doc.getFontBytes(part),
    );
    for (let index = 0; index < doc.pageCount; index += 1) {
      const size = doc.pageSize(index);
      const canvas = createRecordedCanvas();
      await doc.renderPage(canvas, index, { width: Math.round(size.widthPt * 2), dpr: 1 });
      await onPage(
        await canvasToPage(canvas, size.widthPt, size.heightPt, index === 0 ? fonts : []),
      );
    }
  } finally {
    doc.destroy();
  }
}

async function renderPptx(path: string, onPage: PageSink) {
  const { PptxPresentation } = await import("@silurus/ooxml/pptx");
  const presentation = await PptxPresentation.load(await readLocalFile(path), {
    mode: "main",
  });
  try {
    await presentation.waitUntilLayoutComplete();
    const widthPt = presentation.slideWidth / EMU_PER_POINT;
    const heightPt = presentation.slideHeight / EMU_PER_POINT;
    for (let index = 0; index < presentation.slideCount; index += 1) {
      const canvas = createRecordedCanvas();
      await presentation.renderSlide(canvas, index, { width: 1600, dpr: 1 });
      await onPage(await canvasToPage(canvas, widthPt, heightPt));
    }
  } finally {
    presentation.destroy();
  }
}

function xlsxUsedBounds(sheet: { rows: Array<{ index: number; cells: Array<{ col: number }> }> }) {
  let maxRow = 0;
  let maxCol = 0;
  for (const row of sheet.rows) {
    if (!row.cells.length) continue;
    maxRow = Math.max(maxRow, row.index);
    for (const cell of row.cells) maxCol = Math.max(maxCol, cell.col);
  }
  return { rows: Math.max(1, maxRow + 1), cols: Math.max(1, maxCol + 1) };
}

async function renderXlsx(path: string, options: DocumentRenderOptions, onPage: PageSink) {
  const [{ XlsxWorkbook }, { fitWorksheetWidth }] = await Promise.all([
    import("@silurus/ooxml/xlsx"),
    import("./xlsx-fit"),
  ]);
  const workbook = await XlsxWorkbook.load(await readLocalFile(path), {
    mode: "main",
  });
  try {
    const sheetIndexes =
      options.xlsxSheet === "all"
        ? Array.from({ length: workbook.sheetCount }, (_, index) => index).filter(
            (index) => !workbook.isHidden(index),
          )
        : [options.xlsxSheet];
    for (const sheetIndex of sheetIndexes) {
      const sheet = await workbook.getWorksheet(sheetIndex);
      if (sheet.isChartSheet || sheet.isDialogSheet || sheet.parseError) continue;
      const used = xlsxUsedBounds(sheet);
      const rowsByIndex = new Map(sheet.rows.map((row) => [row.index, row]));
      const page = { widthPt: A4.heightPt, heightPt: A4.widthPt };
      const pixels = pagePixels(page.widthPt, page.heightPt);
      const margin = 48;
      const cellScale =
        options.xlsxScale === "actual"
          ? 1
          : fitWorksheetWidth(sheet, used.cols, pixels.width, margin);
      const availableHeight = (pixels.height - margin * 2) / cellScale;
      let startRow = 0;
      while (startRow < used.rows) {
        let height = 0;
        let endRow = startRow;
        while (endRow < used.rows) {
          const row = rowsByIndex.get(endRow);
          const rowHeightPt = row?.height ?? sheet.rowHeights[endRow] ?? sheet.defaultRowHeight;
          const rowHeightPx = Math.max(12, (rowHeightPt * 96) / 72);
          if (endRow > startRow && height + rowHeightPx > availableHeight) break;
          height += rowHeightPx;
          endRow += 1;
        }
        const canvas = createRecordedCanvas();
        await workbook.renderViewport(
          canvas,
          sheetIndex,
          { row: startRow, col: 0, rows: Math.max(1, endRow - startRow), cols: used.cols },
          {
            width: pixels.width,
            height: pixels.height,
            dpr: 1,
            cellScale,
            scrollOffsetX: -margin,
            scrollOffsetY: -margin,
          },
        );
        await onPage(await canvasToPage(canvas, page.widthPt, page.heightPt));
        startRow = Math.max(endRow, startRow + 1);
      }
    }
    return { sheetNames: workbook.sheetNames };
  } finally {
    workbook.destroy();
  }
}

export async function prepareDocument(
  file: FileInfo,
  options: DocumentRenderOptions,
  signal?: AbortSignal,
): Promise<DocumentInfo> {
  signal?.throwIfAborted();
  const format = documentFormat(file.path);
  if (!format) throw new Error(`Unsupported file type: ${file.name}`);
  if (format === "pdf") {
    const [pdf] = await invoke<
      Array<{ path: string; name: string; sizeBytes: number; pages: number | null }>
    >("inspect_pdfs", { paths: [file.path] });
    signal?.throwIfAborted();
    return { ...pdf, printPath: file.path, format, generated: false };
  }

  const session = await createPdfSession();
  const cancel = () => {
    void session.cancel();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const onPage: PageSink = async (page) => {
    signal?.throwIfAborted();
    await session.add(page);
    signal?.throwIfAborted();
  };
  let sheetNames: string[] | undefined;
  try {
    signal?.throwIfAborted();
    if (format === "docx") await renderDocx(file.path, onPage);
    else if (format === "pptx") await renderPptx(file.path, onPage);
    else if (format === "xlsx") {
      const rendered = await renderXlsx(file.path, options, onPage);
      sheetNames = rendered.sheetNames;
    } else if (format === "markdown") await renderMarkdown(file.path, onPage);
    else await renderImage(file.path, options, onPage);

    signal?.throwIfAborted();
    const printPath = await session.finish();
    signal?.throwIfAborted();
    return {
      ...file,
      printPath,
      pages: session.count(),
      format,
      generated: true,
      sheetNames,
    };
  } catch (error) {
    await session.abort();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function inspectSupportedFiles(paths: string[]) {
  const supported = paths.filter((path) => documentFormat(path));
  if (!supported.length) return [];
  return invoke<FileInfo[]>("inspect_files", { paths: supported });
}

export async function cleanupGeneratedDocument(
  item: Pick<DocumentInfo, "generated" | "printPath">,
) {
  if (!item.generated) return;
  await invoke("cleanup_printable_pdf", { path: item.printPath }).catch(() => undefined);
}

export function paperForMedia(media: string) {
  return media.toLowerCase().includes("letter") ? LETTER : A4;
}
