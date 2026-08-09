import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bot,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useI18n } from "@/i18n";
import { streamAiCompletion, type AiRequestMessage } from "@/services/aiService";
import { useCredentialsStore } from "@/store/credentials";
import {
  createAiEntityId,
  useAiConfigStore,
  useAiConversationStore,
  type AiMessage,
} from "@/store/ai";

type RequestState = "idle" | "generating" | "failed" | "cancelled";

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return getNodeText(node.props.children);
  return "";
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      logger.error("FE/ai", "复制 AI 内容失败", { error });
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 rounded-md"
      title={title}
      aria-label={title}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const { t } = useI18n();
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => (
      <a
        href={href}
        className="break-all text-primary underline underline-offset-2 hover:opacity-80"
        onClick={(event) => {
          event.preventDefault();
          if (!href || !/^https?:\/\//i.test(href)) return;
          void openUrl(href).catch((error) => {
            logger.error("FE/ai", "打开 AI 回复链接失败", { error, href });
          });
        }}
      >
        {children}
      </a>
    ),
    pre: ({ children }) => {
      const text = getNodeText(Children.toArray(children)).replace(/\n$/, "");
      return (
        <div className="relative my-2 max-w-full overflow-hidden rounded-lg border border-border/50 bg-black/25">
          <div className="absolute right-1.5 top-1.5 z-10">
            <CopyButton text={text} title={t("复制代码")} />
          </div>
          <pre className="max-w-full whitespace-pre-wrap break-words p-3 pr-10 text-[11px] leading-5 [overflow-wrap:anywhere]">{children}</pre>
        </div>
      );
    },
    code: ({ className, children }) => (
      <code className={cn(
        className,
        className
          ? "whitespace-pre-wrap break-words font-mono text-[11px] [overflow-wrap:anywhere]"
          : "whitespace-pre-wrap break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]",
      )}>
        {children}
      </code>
    ),
  }), [t]);

  return (
    <div className="min-w-0 max-w-full overflow-hidden break-words text-[12px] leading-5 [overflow-wrap:anywhere] [&_blockquote]:my-2 [&_blockquote]:min-w-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_h1]:my-2 [&_h1]:break-words [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:break-words [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:break-words [&_h3]:font-semibold [&_li]:my-0.5 [&_li]:break-words [&_ol]:my-2 [&_ol]:min-w-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_p]:break-words [&_table]:my-2 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_td]:break-words [&_td]:border [&_td]:border-border/50 [&_td]:p-1.5 [&_td]:[overflow-wrap:anywhere] [&_th]:break-words [&_th]:border [&_th]:border-border/50 [&_th]:p-1.5 [&_th]:[overflow-wrap:anywhere] [&_ul]:my-2 [&_ul]:min-w-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function toRequestMessages(messages: AiMessage[]): AiRequestMessage[] {
  return messages
    .filter((message) => message.content.trim())
    .map(({ role, content }) => ({ role, content }));
}

export function AiModule() {
  const { t } = useI18n();
  const configuration = useAiConfigStore();
  const {
    messages,
    contextLinked,
    addMessage,
    updateMessage,
    setCurrentTopicId,
    setContextLinked,
    clearConversation,
  } = useAiConversationStore();
  const [input, setInput] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [requestError, setRequestError] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantIdRef = useRef("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const canRegenerate = messages.some((message) => message.role === "assistant");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      const messageId = activeAssistantIdRef.current;
      if (messageId) {
        useAiConversationStore.getState().updateMessage(messageId, { status: "interrupted" });
      }
    }
  }, []);

  const runRequest = async (
    requestMessages: AiRequestMessage[],
    assistantId: string,
  ) => {
    const credential = useCredentialsStore.getState().getCredential(configuration.credentialId);
    if (!credential?.apiKey) {
      updateMessage(assistantId, { status: "failed" });
      setRequestState("failed");
      setRequestError(t("无法读取 API Key，请检查 AI 配置和凭据保险库。"));
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeAssistantIdRef.current = assistantId;
    setRequestState("generating");
    setRequestError("");
    let content = "";

    try {
      await streamAiCompletion({
        baseUrl: configuration.baseUrl,
        model: configuration.model,
        apiKey: credential.apiKey,
        messages: requestMessages,
        signal: controller.signal,
        onDelta: (delta) => {
          content += delta;
          useAiConversationStore.getState().updateMessage(assistantId, {
            content,
            status: "streaming",
          });
        },
      });
      if (!content.trim()) throw new Error(t("服务没有返回可显示的内容。"));
      updateMessage(assistantId, { content, status: "complete" });
      setRequestState("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        const messageStillExists = useAiConversationStore
          .getState()
          .messages.some((message) => message.id === assistantId);
        if (messageStillExists) {
          updateMessage(assistantId, { content, status: "interrupted" });
          setRequestState("cancelled");
        } else {
          setRequestState("idle");
        }
      } else {
        updateMessage(assistantId, { content, status: "failed" });
        setRequestState("failed");
        setRequestError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      if (activeAssistantIdRef.current === assistantId) activeAssistantIdRef.current = "";
    }

  };

  const handleSend = () => {
    const question = input.trim();
    if (!question || requestState === "generating") return;

    const snapshot = useAiConversationStore.getState();
    const topicId = snapshot.contextLinked && snapshot.currentTopicId
      ? snapshot.currentTopicId
      : createAiEntityId("topic");
    const history = snapshot.contextLinked
      ? snapshot.messages.filter((message) => message.topicId === topicId)
      : [];
    const userMessage: AiMessage = {
      id: createAiEntityId("message"),
      topicId,
      role: "user",
      content: question,
      status: "complete",
      createdAt: Date.now(),
    };
    const assistantMessage: AiMessage = {
      id: createAiEntityId("message"),
      topicId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: Date.now() + 1,
    };

    setCurrentTopicId(topicId);
    addMessage(userMessage);
    addMessage(assistantMessage);
    setInput("");
    void runRequest(
      [...toRequestMessages(history), { role: "user", content: question }],
      assistantMessage.id,
    );
  };

  const handleRegenerate = () => {
    if (requestState === "generating") return;
    const snapshot = useAiConversationStore.getState().messages;
    let assistantIndex = -1;
    for (let index = snapshot.length - 1; index >= 0; index -= 1) {
      if (snapshot[index]?.role === "assistant") {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex < 0) return;
    const assistant = snapshot[assistantIndex];
    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const candidate = snapshot[index];
      if (candidate?.role === "user" && candidate.topicId === assistant.topicId) {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;
    const userMessage = snapshot[userIndex];
    const history = snapshot
      .slice(0, userIndex)
      .filter((message) => message.topicId === assistant.topicId);
    updateMessage(assistant.id, { content: "", status: "streaming" });
    void runRequest(
      [...toRequestMessages(history), { role: "user", content: userMessage.content }],
      assistant.id,
    );
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  let previousTopicId = "";

  return (
    <div className="module-shell">
      <div className="module-header shrink-0">
        <div className="module-title overflow-hidden">
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          <div className="module-title-text overflow-hidden">
            <span className="module-heading truncate">{t("AI 助手")}</span>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("清空对话")}
            aria-label={t("清空对话")}
            onClick={() => setClearConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-3">
          {messages.length === 0 && (
            <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center text-muted-foreground">
              <Bot className="mb-3 h-7 w-7 opacity-50" />
              <p className="text-sm font-medium text-foreground/80">{t("有什么想问的？")}</p>
              <p className="mt-1 text-xs leading-5">
                {t("可以用于通用问答、搜索式查询、解释命令或整理内容。")}
              </p>
            </div>
          )}

          {messages.map((message) => {
            const isNewTopic = message.topicId !== previousTopicId;
            previousTopicId = message.topicId;
            return (
              <div key={message.id}>
                {isNewTopic && (
                  <div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="h-px flex-1 bg-border/60" />
                    <span>{t("新话题")}</span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                )}
                <div className={cn("group flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "min-w-0 max-w-[92%] rounded-xl border px-3 py-2",
                    message.role === "user"
                      ? "border-primary/25 bg-primary/12 text-foreground"
                      : "border-border/45 bg-muted/25 text-foreground",
                  )}>
                    {message.role === "assistant" ? (
                      message.content ? <MarkdownContent content={message.content} /> : (
                        <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                          {message.status === "failed" ? t("请求失败") : t("正在生成...")}
                        </div>
                      )
                    ) : (
                      <div className="whitespace-pre-wrap break-words text-[12px] leading-5">{message.content}</div>
                    )}

                    {message.role === "assistant" && message.content && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/30 pt-1">
                        <span className="text-[10px] text-muted-foreground">
                          {message.status === "streaming" && t("正在生成...")}
                          {message.status === "interrupted" && t("已停止")}
                          {message.status === "failed" && t("请求失败")}
                        </span>
                        <CopyButton text={message.content} title={t("复制回复")} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/50 bg-background/35 p-2.5">
        <label className={cn(
          "mb-2 flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
          contextLinked
            ? "border-primary/45 bg-primary/12 text-primary"
            : "border-border/45 bg-muted/20 text-muted-foreground hover:text-foreground",
        )}>
          <Checkbox
            checked={contextLinked}
            onCheckedChange={(checked) => setContextLinked(checked === true)}
          />
          <Link2 className="h-3.5 w-3.5" />
          {t("关联当前话题")}
        </label>

        <div className="rounded-xl border border-border/55 bg-background/60 focus-within:border-primary/45">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("输入问题，Enter 发送，Shift+Enter 换行")}
            className="min-h-20 resize-none border-0 bg-transparent px-3 py-2 text-xs shadow-none focus-visible:ring-0"
            disabled={requestState === "generating"}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleRegenerate}
              disabled={!canRegenerate || requestState === "generating"}
              title={t("重新生成最后一个回答")}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("重新生成")}
            </Button>
            {requestState === "generating" ? (
              <Button type="button" size="sm" className="h-7 px-2.5 text-xs" onClick={handleStop}>
                <Square className="mr-1.5 h-3 w-3 fill-current" />
                {t("停止")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {t("发送")}
              </Button>
            )}
          </div>
        </div>

        {(requestState === "failed" || requestState === "cancelled") && (
          <p className={cn(
            "mt-1.5 px-1 text-[10px]",
            requestState === "failed" ? "text-destructive" : "text-muted-foreground",
          )}>
            {requestState === "failed" ? requestError : t("生成已停止，已生成的内容已保留。")}
          </p>
        )}
      </div>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("清空 AI 对话？")}</AlertDialogTitle>
            <AlertDialogDescription>{t("当前会话和所有话题上下文会被永久清除。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={() => {
                abortControllerRef.current?.abort();
                clearConversation();
                setRequestState("idle");
                setRequestError("");
                setClearConfirmOpen(false);
              }}
            >
              {t("确认清空")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
