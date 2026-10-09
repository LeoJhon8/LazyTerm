import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

const MAX_LINK_LINES = 32;
// TUI 主动换行不会设置 isWrapped；括号提供明确的 URL 边界。
const WRAPPED_URL = /\((https?:\/\/[^\s()<>"`]+(?:\n[ \t]*[^\s()<>"`]+)+)\)/gi;
const LINE_END_URL = /https?:\/\/[^\s()<>"'`]+$/gi;
const URL_CONTINUATION = /^([ \t]*)([A-Za-z0-9._~:/?#\[\]@!$&*+,;=%-]+)$/;

function getColumn(line: IBufferLine, stringIndex: number): number {
  let offset = 0;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    const length = cell.getChars().length || 1;
    if (offset + length > stringIndex) return x + 1;
    offset += length;
  }
  return line.length + 1;
}

export function createWrappedTerminalLinkProvider(
  terminal: Terminal,
  activate: (event: MouseEvent, url: string) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buffer = terminal.buffer.active;
      const rows: Array<{ line: IBufferLine; y: number; offset: number; text: string }> = [];
      let content = "";
      const start = Math.max(0, y - MAX_LINK_LINES);
      const end = Math.min(buffer.length, y + MAX_LINK_LINES - 1);
      for (let index = start; index < end; index++) {
        const line = buffer.getLine(index);
        if (!line) break;
        const text = line.translateToString(true);
        rows.push({ line, y: index + 1, offset: content.length, text });
        content += `${text}\n`;
      }

      const row = rows.find((candidate) => candidate.y === y);
      const links: ILink[] = [];
      if (row) {
        const addLink = (url: string, urlStart: number, urlEnd: number) => {
          try {
            // 保持现有 HTTP(S) 链接验证和打开确认流程。
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
          } catch {
            return;
          }

          const from = Math.max(urlStart - row.offset, row.text.search(/\S|$/));
          const to = Math.min(urlEnd - row.offset, row.text.length);
          if (from >= to) return;
          // 每行各自提供点击区域，续行缩进不属于链接；中文、宽字符
          // 和组合字符前缀通过 buffer cell 映射，不能直接用字符串下标。
          links.push({
            text: url,
            range: {
              start: { x: getColumn(row.line, from), y },
              end: { x: getColumn(row.line, to) - 1, y },
            },
            activate,
          });
        };

        for (const match of content.matchAll(WRAPPED_URL)) {
          const raw = match[1];
          if (raw.split("\n").length > MAX_LINK_LINES) continue;
          const urlStart = match.index + 1;
          addLink(raw.replace(/\n[ \t]*/g, ""), urlStart, urlStart + raw.length);
        }

        for (let index = 0; index < rows.length; index++) {
          const first = rows[index];
          if (first.y > y) break;
          for (const match of first.text.matchAll(LINE_END_URL)) {
            // 带括号的地址由上面的明确边界规则处理。
            if (first.text[match.index - 1] === "(") continue;
            let url = match[0];
            let lastIndex = index;
            let indent: string | undefined;
            while (lastIndex + 1 < rows.length && lastIndex - index + 1 < MAX_LINK_LINES) {
              const previous = rows[lastIndex];
              const next = rows[lastIndex + 1];
              const continuation = URL_CONTINUATION.exec(next.text);
              if (!continuation || /^https?:\/\//i.test(continuation[2])) break;
              if (!next.line.isWrapped || continuation[1]) {
                // 无括号时仅补全分隔符处的 TUI 折行：续行必须有一致缩进，
                // 且是含 URL 标点的完整片段，不拼接普通单词或带空格的正文。
                if (!/[-/=?&#%]$/.test(previous.text)
                  || !continuation[1]
                  || !/[\/._~%?#=&+-]/.test(continuation[2])
                  || (indent !== undefined && continuation[1] !== indent)) break;
                indent = continuation[1];
              }
              url += continuation[2];
              lastIndex++;
            }
            if (lastIndex === index) continue;
            const last = rows[lastIndex];
            addLink(url, first.offset + match.index, last.offset + last.text.length);
          }
        }
      }
      callback(links.length ? links : undefined);
    },
  };
}
