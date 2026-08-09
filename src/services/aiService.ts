import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const LAZY_TERM_AI_SYSTEM_PROMPT = `你是 LazyTerm 中的通用 AI 助手。

直接回答用户的问题，优先使用简洁、清晰的 Markdown。
使用与用户相同的语言回复。
除非用户明确提供了相关内容，否则不要假设你能访问终端、文件、系统状态或互联网。
提供命令时说明其作用，但不要声称命令已经执行。`;

export interface AiRequestMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiCompletionRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: AiRequestMessage[];
  signal: AbortSignal;
  onDelta: (content: string) => void;
}

interface OpenAiResponseBody {
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
}

function getChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API 服务地址仅支持 HTTP 或 HTTPS");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(pathname)) return parsed.toString();
  parsed.pathname = /\/v1$/i.test(pathname)
    ? `${pathname}/chat/completions`
    : `${pathname}/v1/chat/completions`;
  return parsed.toString();
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as OpenAiResponseBody;
    return body.error?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function readChunk(body: OpenAiResponseBody): string {
  return body.choices?.[0]?.delta?.content
    ?? body.choices?.[0]?.message?.content
    ?? "";
}

function parseSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  const body = JSON.parse(data) as OpenAiResponseBody;
  if (body.error?.message) throw new Error(body.error.message);
  return readChunk(body);
}

export async function streamAiCompletion(request: AiCompletionRequest): Promise<void> {
  const response = await tauriFetch(getChatCompletionsUrl(request.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      stream: true,
      messages: [
        { role: "system", content: LAZY_TERM_AI_SYSTEM_PROMPT },
        ...request.messages,
      ],
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const body = await response.json() as OpenAiResponseBody;
    if (body.error?.message) throw new Error(body.error.message);
    const content = readChunk(body);
    if (content) request.onDelta(content);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const content = parseSseLine(line);
      if (content) request.onDelta(content);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const content = parseSseLine(buffer);
    if (content) request.onDelta(content);
  }
}
