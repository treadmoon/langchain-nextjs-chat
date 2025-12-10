import { NextRequest, NextResponse } from "next/server";
import { Message as VercelChatMessage, streamText, StreamingTextResponse } from "ai";


import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

export const runtime = "edge";


// VercelChatMessage 是 Vercel AI SDK 中的 消息类型，用来表示一次对话中的单条消息。
// 通常在构建聊天应用时，会用它来定义消息的内容、角色等信息。
const formatMessage = (message: VercelChatMessage) => {
  return `${message.role}: ${message.content}`;
};

const TEMPLATE = `你是人类最厉害的程序员，脾气很暴躁，精通所有开发语言，有30年的开发经验，你讲的中文，香港腔调.

Current conversation:
{chat_history}

User: {input}
AI:`;

/**
 * This handler initializes and calls a simple chain with a prompt,
 * chat model, and output parser. See the docs for more information:
 *
 * https://js.langchain.com/docs/guides/expression_language/cookbook#prompttemplate--llm--outputparser
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages ?? [];
    const formattedPreviousMessages = messages.slice(0, -1).map(formatMessage);
    const currentMessageContent = messages[messages.length - 1].content;
    const prompt = PromptTemplate.fromTemplate(TEMPLATE);

    /**
     * You can also try e.g.:
     *
     * import { ChatAnthropic } from "@langchain/anthropic";
     * const model = new ChatAnthropic({});
     *
     * See a full list of supported models at:
     * https://js.langchain.com/docs/modules/model_io/models/
     */
    // const model = new ChatOpenAI({
    //   temperature: 0.8,
    //   model: "gpt-4o-mini",
    // });


    const model = new ChatOpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      model: "moonshot-v1-8k",
      temperature: 0.3,
      configuration: {
        baseURL: "https://api.moonshot.cn/v1",
      },
    });

    /**
     * Chat models stream message chunks rather than bytes, so this
     * output parser handles serialization and byte-encoding.
     */
    const outputParser = new StringOutputParser();

    /**
     * 也可以这样初始化：
     *
     * import { RunnableSequence } from "@langchain/core/runnables";
     * const chain = RunnableSequence.from([prompt, model, outputParser]);
     */

    /**
     * 关于 `pipe` 的说明（中文）：
     * - 在 LangChain 的表达式语言中，`pipe` 用于将多个可运行单元（runnables）串联起来，
     *   即把前一个单元的输出作为下一个单元的输入。
     * - 这里 `prompt.pipe(model).pipe(outputParser)` 的含义是：
     *   1) 首先用 `prompt` 构建最终发送到模型的字符串/上下文；
     *   2) 将该字符串传入 `model`（例如 `ChatOpenAI`）进行推理；
     *   3) 最后将模型输出传入 `outputParser` 做格式化/解析，得到最终的序列化文本。
     * - 这种链式组合的好处是语义清晰，便于复用和插入中间处理步骤（如缓存、检索、后处理等）。
     */
    const chain = prompt.pipe(model).pipe(outputParser);

    /**
     * 关于 `stream` 的说明（中文）：
     * - `chain.stream(...)` 会以流式方式执行链中最后一个可流化的可运行单元（通常是聊天模型），
     *   返回一个异步可迭代或可读流，用于逐块（chunk）地传输模型生成的文本。
     * - 典型使用场景是聊天或实时生成，前端可以逐步接收并渲染模型输出，提升响应感。
     * - 这里传入的参数是链的输入映射：例如 `chat_history` 和 `input`，
     *   它们会被 `prompt` 用来构建发送给模型的最终提示文本。
     * - 返回的 `stream` 可直接传入 `StreamingTextResponse`，由 Next.js 在边缘环境中将流式响应
     *   转发到客户端。
     */
    const stream = await chain.stream({
      chat_history: formattedPreviousMessages.join("\n"),
      input: currentMessageContent,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })

    // StreamingTextResponse 是 流式文本响应工具，用于处理 AI 模型生成的文本流（streaming response），
    // 让你可以 边生成边显示，而不是等整个结果生成完毕。
    // return new StreamingTextResponse(stream);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
