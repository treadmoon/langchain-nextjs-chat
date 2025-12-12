import { NextRequest, NextResponse } from "next/server";
import { Message as VercelChatMessage, StreamingTextResponse } from "ai";

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { SerpAPI } from "@langchain/community/tools/serpapi";
import { Calculator } from "@langchain/community/tools/calculator";
import {
  AIMessage,
  BaseMessage,
  ChatMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

export const runtime = "edge";

const convertVercelMessageToLangChainMessage = (message: VercelChatMessage) => {
  if (message.role === "user") {
    return new HumanMessage(message.content);
  } else if (message.role === "assistant") {
    return new AIMessage(message.content);
  } else {
    return new ChatMessage(message.content, message.role);
  }
};

const convertLangChainMessageToVercelMessage = (message: BaseMessage) => {
  if (message._getType() === "human") {
    return { content: message.content, role: "user" };
  } else if (message._getType() === "ai") {
    return {
      content: message.content,
      role: "assistant",
      tool_calls: (message as AIMessage).tool_calls,
    };
  } else {
    return { content: message.content, role: message._getType() };
  }
};

const AGENT_SYSTEM_TEMPLATE = `You are a talking parrot named Polly. All final responses must be how a talking parrot would respond. Squawk often!`;

/**
 * This handler initializes and calls an tool caling ReAct agent.
 * See the docs for more information:
 *
 * https://langchain-ai.github.io/langgraphjs/tutorials/quickstart/
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const returnIntermediateSteps = body.show_intermediate_steps;
    /**
     * We represent intermediate steps as system messages for display purposes,
     * but don't want them in the chat history.
     */
    const messages = (body.messages ?? [])
      .filter(
        (message: VercelChatMessage) =>
          message.role === "user" || message.role === "assistant",
      )
      .map(convertVercelMessageToLangChainMessage);

    // Requires process.env.SERPAPI_API_KEY to be set: https://serpapi.com/
    // You can remove this or use a different tool instead.
    const tools = [
      new Calculator(),
      new SerpAPI(process.env.SERPAPI_API_KEY, {
        hl: "zh-cn",            // 可选：界面语言
      })
    ];


    const chat1 = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    });

    const chat = new ChatOpenAI({
      apiKey: process.env.HUOSHAN_API_KEY,
      model: "doubao-1-5-vision-pro-32k-250115",
      configuration: {
        baseURL: "https://ark.cn-beijing.volces.com/api/v3"
      },
    });

    /**
     * Use a prebuilt LangGraph agent.
     */
    const agent = createReactAgent({
      llm: chat,
      tools,
      /**
       * Modify the stock prompt in the prebuilt agent. See docs
       * for how to customize your agent:
       *
       * https://langchain-ai.github.io/langgraphjs/tutorials/quickstart/
       */
      messageModifier: new SystemMessage(AGENT_SYSTEM_TEMPLATE),
    });

    if (!returnIntermediateSteps) {
      /**
       * Stream back all generated tokens and steps from their runs.
       *
       * We do some filtering of the generated events and only stream back
       * the final response as a string.
       *
       * For this specific type of tool calling ReAct agents with OpenAI, we can tell when
       * the agent is ready to stream back final output when it no longer calls
       * a tool and instead streams back content.
       *
       * See: https://langchain-ai.github.io/langgraphjs/how-tos/stream-tokens/
       */
      /**
       * 使用 agent.streamEvents 建立事件流（event stream）：
       * - `agent.streamEvents({ messages }, { version: "v2" })` 会返回一个异步可迭代
       *   的事件流（async iterable），该流不断产出 agent 运行过程中的事件。
       * - 这些事件可能包含：模型生成的中间 token/chunk、工具调用（tool calls）、工具返回
       *   的观测结果（observations）、以及其他运行时事件。
       * - 通过流式事件可以在后端边运行 agent 边把生成结果发送给前端，适用于实时显示
       *   模型 token、工具调用状态和其它中间信息。
       */
      const eventStream = await agent.streamEvents(
        { messages },
        { version: "v2" },
      );

      // 文本编码器：把字符串转换为 Uint8Array 字节序列，以便通过 ReadableStream 输出
      const textEncoder = new TextEncoder();

      /**
       * 使用 ReadableStream 将 agent 的事件流 (eventStream) 转换为可供 Next.js
       * `StreamingTextResponse` 使用的字节流（stream）。主要处理步骤：
       * - 遍历 eventStream 中的每个事件（`for await (const { event, data } of eventStream)`）
       * - 只关心特定事件类型（例如这里关注 `on_chat_model_stream`，表示模型正在
       *   逐块生成文本）；对于该事件，从 `data.chunk.content` 中取出文本块并通过
       *   `controller.enqueue(...)` 推入流中
       * - 在事件流结束后调用 `controller.close()` 结束可读流
       *
       * 这样做的好处：前端可以逐块接收并渲染模型生成的文本（即所谓的流式输出），
       * 用户体验更即时，同时我们还能在事件处理逻辑中对工具调用等中间状态做过滤
       * 或其它自定义处理。
       */
      const transformStream = new ReadableStream({
        async start(controller) {
          for await (const { event, data } of eventStream) {
            // 这里根据事件类型过滤并只把模型生成的文本内容输出到客户端
            if (event === "on_chat_model_stream") {
              // 有些中间生成 chunk 可能只包含工具调用信息而无 content，故需判空
              if (!!data.chunk.content) {
                controller.enqueue(textEncoder.encode(data.chunk.content));
              }
            }
            // 如果需要，也可以在此分支中处理其它事件类型：
            // - 工具调用开始/结束 => 可以推送特殊标记或日志到前端
            // - 观察结果（observations） => 同样可以作为中间信息展示
          }

          // 事件流结束，关闭可读流
          controller.close();
        },
      });

      // 将可读流包装成 StreamingTextResponse 返回，Next.js 会把流中的字节逐步发给客户端
      return new StreamingTextResponse(transformStream);
    } else {
      /**
       * We could also pick intermediate steps out from `streamEvents` chunks, but
       * they are generated as JSON objects, so streaming and displaying them with
       * the AI SDK is more complicated.
       */
      const result = await agent.invoke({ messages });

      return NextResponse.json(
        {
          messages: result.messages.map(convertLangChainMessageToVercelMessage),
        },
        { status: 200 },
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
