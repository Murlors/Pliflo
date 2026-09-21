import type { CanvasCommand } from "./protocol";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 只合并同状态、连续坐标且切断 Unicode 字素的调用；不重排单词或改变字符间距。 */
export class TextRunRecorder {
  private previous?: { command: Extract<CanvasCommand, { op: "fillText" }>; width: number };

  append(commands: CanvasCommand[], command: CanvasCommand, width?: number): void {
    const previous = this.previous;
    this.previous = undefined;
    if (command.op === "fillText" && command.args.length === 3 && width !== undefined) {
      const [text, x, y] = command.args;
      const state = command.state;
      // Format adapters may assign a different fallback family to a zero-width
      // ZWJ/variation selector. It has no glyph of its own: retain the preceding
      // run's font so the following character can form the original grapheme.
      const joinerOnly = width === 0 && /^(?:\u200d|\ufe0e|\ufe0f)+$/u.test(text);
      const sameState =
        previous &&
        (JSON.stringify(previous.command.state) === JSON.stringify(state) ||
          (joinerOnly &&
            JSON.stringify({ ...previous.command.state, font: "" }) ===
              JSON.stringify({ ...state, font: "" })));
      if (
        previous &&
        text &&
        previous.command.args[0] &&
        commands.at(-1) === previous.command &&
        (state.align === "left" || (state.align === "start" && state.direction !== "rtl")) &&
        state.direction !== "rtl" &&
        previous.command.args[2] === y &&
        Math.abs(previous.command.args[1] + previous.width - x) < 0.01 &&
        sameState
      ) {
        const joined = previous.command.args[0] + text;
        const boundary = previous.command.args[0].length;
        if (![...graphemes.segment(joined)].some((part) => part.index === boundary)) {
          previous.command.args[0] = joined;
          previous.width += width;
          this.previous = previous;
          return;
        }
      }
      this.previous = { command, width };
    }
    commands.push(command);
  }
}
