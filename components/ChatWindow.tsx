"use client";

import { type Message } from "ai";
import { useChat } from "ai/react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { toast } from "sonner";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { ChatMessageBubble } from "@/components/ChatMessageBubble";
import { IntermediateStep } from "./IntermediateStep";
import { Button } from "./ui/button";
import { ArrowDown, LoaderCircle, Paperclip } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { UploadDocumentsForm } from "./UploadDocumentsForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { cn } from "@/utils/cn";

function ChatMessages(props: {
  messages: Message[];
  emptyStateComponent: ReactNode;
  sourcesForMessages: Record<string, any>;
  aiEmoji?: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col max-w-[768px] mx-auto pb-12 w-full">
      {props.messages.map((m, i) => {
        if (m.role === "system") {
          return <IntermediateStep key={m.id} message={m} />;
        }

        const sourceKey = (props.messages.length - 1 - i).toString();
        return (
          <ChatMessageBubble
            key={m.id}
            message={m}
            aiEmoji={props.aiEmoji}
            sources={props.sourcesForMessages[sourceKey]}
          />
        );
      })}
    </div>
  );
}

export function ChatInput(props: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading?: boolean;
  placeholder?: string;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const disabled = props.loading && props.onStop == null;
  return (
    <form
      onSubmit={(e) => {
        e.stopPropagation();
        e.preventDefault();

        if (props.loading) {
          props.onStop?.();
        } else {
          props.onSubmit(e);
        }
      }}
      className={cn("flex w-full flex-col", props.className)}
    >
      <div className="border border-input bg-secondary rounded-lg flex flex-col gap-2 max-w-[768px] w-full mx-auto">
        <input
          value={props.value}
          placeholder={props.placeholder}
          onChange={props.onChange}
          className="border-none outline-none bg-transparent p-4"
        />

        <div className="flex justify-between ml-4 mr-2 mb-2">
          <div className="flex gap-3">{props.children}</div>

          <div className="flex gap-2 self-end">
            {props.actions}
            <Button type="submit" className="self-end" disabled={disabled}>
              {props.loading ? (
                <span role="status" className="flex justify-center">
                  <LoaderCircle className="animate-spin" />
                  <span className="sr-only">Loading...</span>
                </span>
              ) : (
                <span>Send</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      className={props.className}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="w-4 h-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();

  // scrollRef will also switch between overflow: unset to overflow: auto
  return (
    <div
      ref={context.scrollRef}
      style={{ width: "100%", height: "100%" }}
      className={cn("grid grid-rows-[1fr,auto]", props.className)}
    >
      <div ref={context.contentRef} className={props.contentClassName}>
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

export function ChatLayout(props: { content: ReactNode; footer: ReactNode }) {
  return (
    <StickToBottom>
      <StickyToBottomContent
        className="absolute inset-0"
        contentClassName="py-8 px-2"
        content={props.content}
        footer={
          <div className="sticky bottom-8 px-2">
            <ScrollToBottom className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4" />
            {props.footer}
          </div>
        }
      />
    </StickToBottom>
  );
}

export function ChatWindow(props: {
  endpoint: string;
  emptyStateComponent: ReactNode;
  placeholder?: string;
  emoji?: string;
  showIngestForm?: boolean;
  showIntermediateStepsToggle?: boolean;
}) {
  /**
   * 组件中主要变量说明（中文注释）：
   * - `showIntermediateSteps`: 是否展示中间步骤（工具调用 / 观察结果等）的开关，由父组件或用户控制。
   * - `intermediateStepsLoading`: 在生成并展示中间步骤时的 loading 状态，避免重复提交。
   * - `sourcesForMessages`: 一个以消息索引为 key 的字典，存放每条消息对应的来源（例如检索到的文档片段），用于在消息气泡中展示来源信息。
   * - `chat`: 来自 `useChat` 的对象，封装了与后端交互、流式更新消息、输入管理等一系列方法/状态（详见下方）。
   */
  const [showIntermediateSteps, setShowIntermediateSteps] = useState(
    !!props.showIntermediateStepsToggle,
  );
  const [intermediateStepsLoading, setIntermediateStepsLoading] =
    useState(false);

  const [sourcesForMessages, setSourcesForMessages] = useState<
    Record<string, any>
  >({});

  console.log("展示state", sourcesForMessages);


  const chat = useChat({
    api: props.endpoint,
    /**
     * `useChat` 使用说明（中文注释）：
     * - `useChat` 是 `ai/react` 提供的 hook，用于在客户端管理聊天状态、发送请求并以流式方式接收模型输出。
     * - 常用字段/方法说明：
     *   - `chat.messages`: 当前已有的消息数组（实时更新，可触发组件重渲染）。
     *   - `chat.input`: 当前输入框的值，通常与输入组件双向绑定。
     *   - `chat.isLoading`: 表示是否正在等待模型/后端响应（包括流式生成）。
     *   - `chat.handleSubmit(e)`: 提交表单的快捷方法，会把当前输入发送到 `api`，并在流式响应到来时逐步追加/更新 `chat.messages`。
     *   - `chat.handleInputChange(e)`: 用于输入框的 onChange，更新 `chat.input`。
     *   - `chat.setMessages(...)` / `chat.setInput(...)`: 手动更新消息或输入，通常用于在展示中间步骤时先插入临时消息。
     * - `streamMode: "text"` 表示以文本块（chunk）流的方式接收后端响应，前端会在收到每个 chunk 时逐步渲染到页面，提升响应体验。
     * - `onResponse` 可用于访问底层 `fetch` 的 `Response` 对象（例如读取响应头 `x-sources`），用于将附加信息关联到消息上。
     */
    onResponse(response) {
      const sourcesHeader = response.headers.get("x-sources");
      const sources = sourcesHeader
        ? JSON.parse(Buffer.from(sourcesHeader, "base64").toString("utf8"))
        : [];

      const messageIndexHeader = response.headers.get("x-message-index");
      if (sources.length && messageIndexHeader !== null) {
        console.log("========>", { messageIndexHeader, sources });

        setSourcesForMessages({
          ...sourcesForMessages,
          [messageIndexHeader]: sources,
        });
      }
    },
    streamMode: "text",
    onError: (e) =>
      toast.error(`Error while processing your request`, {
        description: e.message,
      }),
  });

  async function sendMessage(e: FormEvent<HTMLFormElement>) {
    // 阻止默认表单提交行为
    e.preventDefault();

    // 避免在已有请求正在进行时重复发送
    if (chat.isLoading || intermediateStepsLoading) return;

    // 如果不开启中间步骤展示，则直接使用 `useChat` 提供的 `handleSubmit`，
    // 由 `useChat` 负责发送请求并以流式方式将模型输出逐步追加到 `chat.messages`。
    // 这时前端不需要自行处理流（`useChat` 内部会处理 stream 并触发渲染）。
    if (!showIntermediateSteps) {
      chat.handleSubmit(e);
      return;
    }

    // 开启中间步骤的自定义流程：
    // 1) 手动把用户输入插入到消息列表（本地立即展示），并清空输入框；
    // 2) 向后端发送一个带 `show_intermediate_steps` 标志的 POST 请求，后端会返回包含
    //    中间步骤（tool calls）和最终回复的结构化 JSON（非流式），以便前端逐步展示这些步骤；
    // 3) 前端解析返回的消息数组，提取工具调用/观察结果并以 `system` 消息的形式插入到界面；
    // 4) 最后将最终的 assistant 回复追加到消息列表中完成展示。
    // 这种做法适用于想要显式展示工具调用与观察结果的场景；如果不需要，可以直接使用 `handleSubmit`。
    setIntermediateStepsLoading(true);

    // 清空输入框（仅在 UI 层面）并把当前用户输入追加到本地消息数组，立即展示
    chat.setInput("");
    const messagesWithUserReply = chat.messages.concat({
      id: chat.messages.length.toString(),
      content: chat.input,
      role: "user",
    });
    chat.setMessages(messagesWithUserReply);

    // 发起后端请求以获取中间步骤（此处使用普通的 fetch + JSON，而不是流式处理）
    const response = await fetch(props.endpoint, {
      method: "POST",
      body: JSON.stringify({
        messages: messagesWithUserReply,
        show_intermediate_steps: true,
      }),
    });
    const json = await response.json();
    setIntermediateStepsLoading(false);

    if (!response.ok) {
      // 错误处理：展示 toast 并终止流程
      toast.error(`Error while processing your request`, {
        description: json.error,
      });
      return;
    }

    // 后端返回的结构化消息数组（包含中间步骤与最终回复）
    const responseMessages: Message[] = json.messages;

    // 下面开始将后端返回的“工具调用（tool calls）”信息，转换为可在聊天 UI 中展示的中间步骤：
    // 1) 过滤出包含工具调用或以 `tool` 身份返回的消息（这些通常成对出现：AI 调用 -> 工具返回）
    // 2) 将每对工具调用与对应的观察结果（observation）序列化为 `system` 消息，便于在界面中以“中间步骤”形式展示
    // 3) 逐条把这些中间步骤插入到消息列表，并在插入时添加小的延迟以模拟处理过程的可视化
    // 4) 最后将最终的 assistant 回复追加到消息列表，完成整个请求的展示流程

    // 过滤出所有与工具调用相关的消息（包括作为 tool 身份返回的消息）
    // 注：后端协议在这里假设工具调用通常以一对消息出现：assistant(tool_call) -> tool(返回观测)
    const toolCallMessages = responseMessages.filter((responseMessage: Message) => {
      return (
        (responseMessage.role === "assistant" && !!responseMessage.tool_calls?.length) ||
        responseMessage.role === "tool"
      );
    });

    // intermediateStepMessages 用于存放把 toolCallMessages 转换后的系统消息，供 UI 顺序展示
    const intermediateStepMessages: { id: string; role: "system"; content: string }[] = [];

    // 遍历 toolCallMessages，每两个元素视为一组（AI 的 tool_call 与 tool 的观测结果）
    for (let i = 0; i < toolCallMessages.length; i += 2) {
      const aiMessage = toolCallMessages[i];
      const toolMessage = toolCallMessages[i + 1];

      // 将工具调用的 action 与工具返回的 observation 组合成一个便于展示的 JSON 字符串
      // 这里使用 `system` 角色只是为了在 UI 中以不同样式显示（不作为真正的用户或 AI 回复）
      intermediateStepMessages.push({
        id: (messagesWithUserReply.length + i / 2).toString(),
        role: "system",
        content: JSON.stringify({
          action: aiMessage.tool_calls?.[0], // 工具调用的第一个 action（若有多个，可按需扩展）
          observation: toolMessage?.content, // 工具返回的观测/结果文本
        }),
      });
    }

    // newMessages 起始于用户提交后的消息队列（包含用户刚发送的那条消息）
    const newMessages = messagesWithUserReply;

    // 逐条把中间步骤插入到 UI 中，每插入一条就更新 chat.messages 以触发渲染
    // 同时添加短暂延迟可以让用户看见每一步被“执行”的过程，便于理解内部流程
    for (const message of intermediateStepMessages) {
      newMessages.push(message);
      chat.setMessages([...newMessages]);

      // 等待 1~2 秒之间的随机时间，模拟处理时间并给用户视觉节奏
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    }

    // 最后将后端返回的最终 assistant 回复追加到消息列表
    // responseMessages 的最后一项通常是最终的 assistant 回复（根据后端实现），此处直接取最后一条
    chat.setMessages([
      ...newMessages,
      {
        id: newMessages.length.toString(),
        content: responseMessages[responseMessages.length - 1].content,
        role: "assistant",
      },
    ]);
  }

  return (
    <ChatLayout
      content={
        chat.messages.length === 0 ? (
          <div>{props.emptyStateComponent}</div>
        ) : (
          <ChatMessages
            aiEmoji={props.emoji}
            messages={chat.messages}
            emptyStateComponent={props.emptyStateComponent}
            sourcesForMessages={sourcesForMessages}
          />
        )
      }
      footer={
        <ChatInput
          value={chat.input}
          onChange={chat.handleInputChange}
          onSubmit={sendMessage}
          loading={chat.isLoading || intermediateStepsLoading}
          placeholder={props.placeholder ?? "What's it like to be a pirate?"}
        >
          {props.showIngestForm && (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="pl-2 pr-3 -ml-2"
                  disabled={chat.messages.length !== 0}
                >
                  <Paperclip className="size-4" />
                  <span>Upload document</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload document</DialogTitle>
                  <DialogDescription>
                    Upload a document to use for the chat.
                  </DialogDescription>
                </DialogHeader>
                <UploadDocumentsForm />
              </DialogContent>
            </Dialog>
          )}

          {props.showIntermediateStepsToggle && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="show_intermediate_steps"
                name="show_intermediate_steps"
                checked={showIntermediateSteps}
                disabled={chat.isLoading || intermediateStepsLoading}
                onCheckedChange={(e) => setShowIntermediateSteps(!!e)}
              />
              <label htmlFor="show_intermediate_steps" className="text-sm">
                Show intermediate steps
              </label>
            </div>
          )}
        </ChatInput>
      }
    />
  );
}
