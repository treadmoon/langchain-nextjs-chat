import { NextRequest, NextResponse } from "next/server";
// ↑ Next.js 13+ App Router 里处理 HTTP 请求和响应的两个核心类型

import { Message as VercelChatMessage, StreamingTextResponse } from "ai";
// ↑ Vercel 官方的 AI SDK 提供的类型和工具
//   VercelChatMessage：前端传来的消息格式 { role: "user" | "assistant", content: "..." }
//   StreamingTextResponse：专门用来返回流式文本（SSE）给前端，让文字可以一个字一个字出现

import { createClient } from "@supabase/supabase-js";
// ↑ 创建 Supabase 客户端，用来操作数据库、向量表、认证等

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
// ↑ LangChain 提供的 OpenAI 系列封装
//   ChatOpenAI：聊天大模型（这里其实用了火山方的豆包模型）
//   OpenAIEmbeddings：把文本转成向量的模型（embedding）

import { PromptTemplate } from "@langchain/core/prompts";
// ↑ LangChain 的提示词模板，支持 {变量} 占位符

import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
// ↑ LangChain 官方提供的 Supabase pgvector 向量库封装

import { Document } from "@langchain/core/documents";
// ↑ LangChain 中代表「一段文本 + 元数据」的标准文档对象

import { RunnableSequence } from "@langchain/core/runnables";
// ↑ LangChain 最核心的概念之一：把多个步骤（prompt → model → parser）用 .pipe() 串成一个「链」（Chain）

import {
  BytesOutputParser,
  StringOutputParser,
} from "@langchain/core/output_parsers";
// ↑ 输出解析器
//   StringOutputParser：把模型返回的文字直接变成字符串
//   BytesOutputParser：把流式输出变成字节流（配合 StreamingTextResponse 使用）

export const runtime = "edge";
// ↑ 强制这个 API 路由运行在 Vercel Edge Runtime（超快冷启动，适合流式接口）

// 把检索出来的多段文档拼接成一段大字符串，后面会塞给大模型当上下文
const combineDocumentsFn = (docs: Document[]) => {
  const serializedDocs = docs.map((doc) => doc.pageContent);
  return serializedDocs.join("\n\n");
};

// 把前端传来的 Vercel 消息格式转成普通文字对话历史（给「提炼独立问题」那一步用）
const formatVercelMessages = (chatHistory: VercelChatMessage[]) => {
  const formattedDialogueTurns = chatHistory.map((message) => {
    if (message.role === "user") {
      return `Human: ${message.content}`;
    } else if (message.role === "assistant") {
      return `Assistant: ${message.content}`;
    } else {
      return `${message.role}: ${message.content}`;
    }
  });
  return formattedDialogueTurns.join("\n");
};

// 第一段 Prompt：把「带聊天历史的追问」变成「一个不依赖上下文的独立问题」
const CONDENSE_QUESTION_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

<chat_history>
  {chat_history}
</chat_history>

Follow Up Input: {question}
Standalone question:`;

const condenseQuestionPrompt = PromptTemplate.fromTemplate(
  CONDENSE_QUESTION_TEMPLATE,
);
// ↑ 创建一个可以填 {chat_history} 和 {question} 的 PromptTemplate

// 第二段 Prompt：真正的回答 Prompt，要求模型扮演一只叫 Dana 的小狗，还要用双关语
const ANSWER_TEMPLATE = `你是一只名叫Dana的精力充沛的会说话的小狗，你默认说中文，必须像一只快乐会说话的狗一样回答所有问题。
使用大量双关语！

仅根据以下上下文和聊天记录回答问题：

<context>
  {context}
</context>

<chat_history>
  {chat_history}
</chat_history>

Question: {question}
`;
const answerPrompt = PromptTemplate.fromTemplate(ANSWER_TEMPLATE);

export async function POST(req: NextRequest) {
  try {
    // 解析前端 POST 过来的 JSON 体
    const body = await req.json();
    const messages = body.messages ?? [];                     // 所有消息（包括历史）
    const previousMessages = messages.slice(0, -1);           // 除了最后一条（历史消息）
    const currentMessageContent = messages[messages.length - 1].content; // 用户最新的问题

    // 这里用的是火山引擎的豆包模型，不是 OpenAI
    const model = new ChatOpenAI({
      apiKey: process.env.HUOSHAN_API_KEY,
      model: "doubao-1-5-vision-pro-32k-250115",
      temperature: 0.2,
      configuration: {
        baseURL: "https://ark.cn-beijing.volces.com/api/v3"   // 火山方舟的接口地址
      },
    });

    console.log("变量", {
      a: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      b: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    });


    // 创建 Supabase 客户端（这里用 service_role 或 private key，权限最高）
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // 创建用于生成向量（embedding）的模型，同样走火山方舟
    // const embeddings = new OpenAIEmbeddings({
    //   openAIApiKey: process.env.HUOSHAN_API_KEY, // 火山引擎的 API 密钥
    //   configuration: {
    //     baseURL: "https://ark.cn-beijing.volces.com/api/v3", // 火山引擎的 API 端点
    //   },
    //   modelName: "doubao-embedding-text-240715", // 替换为豆包支持的嵌入模型名称
    // });

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.QWEN_API_KEY, //  
      configuration: {
        baseURL: "https://api.siliconflow.cn/v1/embeddings", //  
      },
      modelName: "qwen3-rerank",
      dimensions: 1024
    });

    // 连接到 Supabase 的向量表
    const vectorstore = new SupabaseVectorStore(embeddings, {
      client,
      tableName: "documents",          // 你的向量表名
      queryName: "match_documents",    // 必须在 Supabase 里建好的匹配函数
    });

    // 【步骤1】把「用户最新问题 + 历史」变成「独立问题」
    const standaloneQuestionChain = RunnableSequence.from([
      condenseQuestionPrompt,          // 先把模板填上 chat_history 和 question
      model,                           // 大模型生成独立问题
      new StringOutputParser(),        // 把结果解析成普通字符串
    ]);

    // 我们稍后需要把「检索出来的文档传给前端展示来源，所以这里搞个 Promise 等待
    let resolveWithDocuments: (value: Document[]) => void;
    const documentPromise = new Promise<Document[]>((resolve) => {
      resolveWithDocuments = resolve;
    });

    // 创建检索器，并在检索结束时把文档塞进上面的 Promise
    const retriever = vectorstore.asRetriever({
      callbacks: [
        {
          handleRetrieverEnd(documents) {
            resolveWithDocuments(documents);   // 检索完了，把文档交给 Promise
          },
        },
      ],
    });

    // 【步骤2】检索链：输入是问题 → 输出是拼接好的上下文文本
    const retrievalChain = retriever.pipe(combineDocumentsFn);

    // 【步骤3】最终回答链
    const answerChain = RunnableSequence.from([
      {
        // 并行准备三样东西给 answerPrompt 用
        context: RunnableSequence.from([
          (input) => input.question,      // 把独立问题原样传下去
          retrievalChain,                 // 去向量库检索 → 拼接文本
        ]),
        chat_history: (input) => input.chat_history,
        question: (input) => input.question,
      },
      answerPrompt,                       // 填入 {context} {chat_history} {question}
      model,                              // 大模型生成最终答案
    ]);

    // 【总链】把「提炼独立问题」和「回答链」串起来
    const conversationalRetrievalQAChain = RunnableSequence.from([
      {
        question: standaloneQuestionChain,     // 先得到独立问题
        chat_history: (input) => input.chat_history,
      },
      answerChain,
      new BytesOutputParser(),            // 转成字节流，方便流式返回
    ]);

    // 执行整条链，得到流式输出
    const stream = await conversationalRetrievalQAChain.stream({
      question: currentMessageContent,                 // 用户最新问题
      chat_history: formatVercelMessages(previousMessages), // 格式化后的历史对话
    });

    // 等待检索完成的文档（用于前端显示来源）
    const documents = await documentPromise;
    const serializedSources = Buffer.from(
      JSON.stringify(
        documents.map((doc) => ({
          pageContent: doc.pageContent.slice(0, 50) + "...",
          metadata: doc.metadata,
        })),
      ),
    ).toString("base64");

    // 返回流式文本响应，同时把来源塞到 header 里给前端用
    return new StreamingTextResponse(stream, {
      headers: {
        "x-message-index": (previousMessages.length + 1).toString(),
        "x-sources": serializedSources,   // 前端可以读取这个 header 显示“引用了哪几段文档”
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}