import React, { FormEvent, ReactNode, useState } from "react";
import { useChat, Message } from "ai/react"; // Vercel AI SDK 提供的 React Hook
import { Buffer } from "buffer"; // Node.js Buffer，用于解析 Base64
import { toast } from "sonner"; // 轻量级 toast 通知库
// 以下为自定义组件（根据项目结构）
import ChatLayout from "./ChatLayout";
import ChatMessages from "./ChatMessages";
import ChatInput from "./ChatInput";
import UploadDocumentsForm from "./UploadDocumentsForm";
// UI 组件（假设使用 shadcn/ui）
import { Button, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui";
import { Paperclip } from "lucide-react";

/**
 * ChatWindow 组件：完整的聊天窗口
 * 支持普通流式回复 + 可切换的“显示中间步骤”模式（展示工具调用过程）
 */
function ChatWindow(props: {
  endpoint: string;                    // 后端 API 地址，例如 "/api/chat"
  emptyStateComponent: ReactNode;     // 空状态时显示的组件（欢迎语、提示等）
  placeholder?: string;                // 输入框 placeholder
  emoji?: string;                      // AI 头像 emoji
  showIngestForm?: boolean;            // 是否显示“上传文档”按钮
  showIntermediateStepsToggle?: boolean; // 是否显示“显示中间步骤”开关
}) {
  // 是否开启“显示中间步骤”模式（默认与 props 是否传入开关一致）
  const [showIntermediateSteps, setShowIntermediateSteps] = useState(
    !!props.showIntermediateStepsToggle,
  );

  // 中间步骤请求是否正在加载（非流式请求时使用）
  const [intermediateStepsLoading, setIntermediateStepsLoading] = useState(false);

  // 存储每条消息对应的来源（sources），key 为消息索引（x-message-index），value 为来源数组
  const [sourcesForMessages, setSourcesForMessages] = useState<Record<string, any>>({});

  /**
   * useChat Hook：Vercel AI SDK 提供的强大聊天管理工具
   * 自动处理消息状态、输入、流式响应等
   */
  const chat = useChat({
    api: props.endpoint, // 请求的后端地址

    // 每次收到响应时执行，解析自定义 header 中的 sources
    onResponse(response) {
      const sourcesHeader = response.headers.get("x-sources");
      const sources = sourcesHeader
        ? JSON.parse(Buffer.from(sourcesHeader, "base64").toString("utf8"))
        : [];

      const messageIndexHeader = response.headers.get("x-message-index");
      if (sources.length && messageIndexHeader !== null) {
        console.log("========> 来源数据", { messageIndexHeader, sources });

        // 将当前消息的来源保存到状态中，供 ChatMessages 组件展示引用
        setSourcesForMessages({
          ...sourcesForMessages,
          [messageIndexHeader]: sources,
        });
      }
    },

    streamMode: "text", // 使用文本流模式（而不是 tokens）

    // 请求出错时的统一错误提示
    onError: (e) =>
      toast.error(`请求处理出错`, {
        description: e.message,
      }),
  });

  /**
   * 自定义消息发送函数
   * 当开启“显示中间步骤”时，不走 useChat 的流式提交，而是手动 fetch 并逐步渲染工具调用过程
   */
  async function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // 阻止表单默认提交（页面刷新）

    // 防止重复提交（流式加载或中间步骤加载时禁用）
    if (chat.isLoading || intermediateStepsLoading) return;

    // 如果未开启中间步骤展示，直接使用 useChat 默认的流式提交
    if (!showIntermediateSteps) {
      chat.handleSubmit(e);
      return;
    }

    // ------------------- 开启中间步骤时的特殊处理流程 -------------------
    setIntermediateStepsLoading(true);

    // 立即清空输入框，并把用户当前输入追加到本地消息列表（实现即时显示用户消息）
    chat.setInput("");
    const messagesWithUserReply = chat.messages.concat({
      id: chat.messages.length.toString(),
      content: chat.input,
      role: "user",
    });
    chat.setMessages(messagesWithUserReply);

    // 向后端发起普通 POST 请求（非流式），要求返回完整的中间步骤
    const response = await fetch(props.endpoint, {
      method: "POST",
      body: JSON.stringify({
        messages: messagesWithUserReply,
        show_intermediate_steps: true, // 关键字段：告诉后端返回工具调用细节
      }),
    });

    const json = await response.json();
    setIntermediateStepsLoading(false);

    // 请求失败：弹出错误提示并终止
    if (!response.ok) {
      toast.error(`请求处理出错`, {
        description: json.error || "未知错误",
      });
      return;
    }

    // 后端返回的完整消息数组（包含 user、assistant、tool 调用等）
    const responseMessages: Message[] = json.messages;

    // 筛选出所有工具调用相关的消息（AI 的 tool_calls + tool 的返回）
    const toolCallMessages = responseMessages.filter((msg: Message) => {
      return (
        (msg.role === "assistant" && !!msg.tool_calls?.length) || // AI 发出的工具调用
        msg.role === "tool"                                      // 工具执行后的返回
      );
    });

    // 用于展示的中间步骤消息（转为 system 角色，方便 UI 区别样式）
    const intermediateStepMessages: { id: string; role: "system"; content: string }[] = [];

    // 每两个消息为一组：第偶数项是 AI 的 tool_call，第奇数项是 tool 的 observation
    for (let i = 0; i < toolCallMessages.length; i += 2) {
      const aiMessage = toolCallMessages[i];       // 包含 tool_calls 的 assistant 消息
      const toolMessage = toolCallMessages[i + 1]; // tool 角色返回的观察结果

      intermediateStepMessages.push({
        id: (messagesWithUserReply.length + i / 2).toString(),
        role: "system", // 用 system 角色表示“中间过程”，不参与实际对话逻辑
        content: JSON.stringify({
          action: aiMessage.tool_calls?.[0],      // 工具调用详情（可支持多个，当前取第一个）
          observation: toolMessage?.content,      // 工具执行后的返回内容
        }, null, 2), // 美化 JSON 方便阅读
      });
    }

    // 从用户提交后的消息开始，逐步构建新的消息列表
    let newMessages = messagesWithUserReply;

    // 逐条插入中间步骤，并添加延迟制造“逐步执行”的动画效果
    for (const message of intermediateStepMessages) {
      newMessages = [...newMessages, message];
      chat.setMessages(newMessages);

      // 随机 1~2 秒延迟，让用户看到每一步在“思考执行”
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    }

    // 最后追加真正的 AI 最终回复（通常是 responseMessages 的最后一条 assistant 消息）
    const finalAssistantMessage = responseMessages[responseMessages.length - 1];
    chat.setMessages([
      ...newMessages,
      {
        id: newMessages.length.toString(),
        content: finalAssistantMessage.content,
        role: "assistant",
      },
    ]);
  }

  // ------------------- 渲染部分 -------------------
  return (
    <ChatLayout
      content={
        // 消息为空时显示空状态组件
        chat.messages.length === 0 ? (
          <div>{props.emptyStateComponent}</div>
        ) : (
          // 展示消息列表 + 来源引用
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
          onSubmit={sendMessage} // 关键：替换默认提交为自定义函数
          loading={chat.isLoading || intermediateStepsLoading}
          placeholder={props.placeholder ?? "What's it like to be a pirate?"}
        >
          {/* 上传文档功能（RAG 用） */}
          {props.showIngestForm && (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="pl-2 pr-3 -ml-2"
                  disabled={chat.messages.length !== 0} // 已有对话时禁用上传
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

          {/* 显示中间步骤的开关 */}
          {props.showIntermediateStepsToggle && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="show_intermediate_steps"
                checked={showIntermediateSteps}
                disabled={chat.isLoading || intermediateStepsLoading}
                onCheckedChange={(checked) => setShowIntermediateSteps(!!checked)}
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

export default ChatWindow;