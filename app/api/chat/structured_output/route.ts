import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

export const runtime = "edge";

const TEMPLATE = `Extract the requested fields from the input.

The field "entity" refers to the first mentioned entity in the input.

Input:

{input}`;

/**
 * This handler initializes and calls an OpenAI Functions powered
 * structured output chain. See the docs for more information:
 *
 * https://js.langchain.com/v0.2/docs/how_to/structured_output
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages ?? [];
    const currentMessageContent = messages[messages.length - 1].content;

    const prompt = PromptTemplate.fromTemplate(TEMPLATE);
    /**
     * Function calling is currently only supported with ChatOpenAI models
     */
    // const model = new ChatOpenAI({
    //   temperature: 0.8,
    //   model: "gpt-4o-mini",
    // });

    const model = new ChatOpenAI({
      apiKey: process.env.HUOSHAN_API_KEY,
      model: "doubao-1-5-vision-pro-32k-250115",
      configuration: {
        baseURL: "https://ark.cn-beijing.volces.com/api/v3"
      },
    });

    /**
     * We use Zod (https://zod.dev) to define our schema for convenience,
     * but you can pass JSON schema if desired.
     */
    const schema = z
      .object({
        tone: z
          .enum(["positive", "negative", "neutral"])
          .describe("The overall tone of the input").default("neutral"),
        entity: z.string().describe("The entity mentioned in the input").default("entity"),
        word_count: z.number().describe("The number of words in the input").default(0),
        chat_response: z.string().describe("A response to the human's input").default("chat_response"),
        final_punctuation: z.string().nullable().optional()
          .describe("The final punctuation mark in the input, if any."),
      })
      .describe("Should always be used to properly format output");



    /**
     * Bind schema to the OpenAI model.
     * Future invocations of the returned model will always match the schema.
     *
     * Under the hood, uses tool calling by default.
     */
    // const functionCallingModel = model.withStructuredOutput(AnswerSchema, {
    //   name: "output_formatter",
    // });

    const AnswerSchema = z.object({
      answer: z.string().describe("完整、详细的中文回答，保留所有解释内容"),
      key_points: z.array(z.string()).describe("3~6 条核心知识点总结"),
      confidence: z.number().min(0).max(1).describe("答案置信度 0~1"),
    });

    const AnySchema = z.any();

    // const functionCallingModel = model.withStructuredOutput(AnySchema, {
    //   name: "output_formatter",
    // });

    const functionCallingModel = model.withStructuredOutput(z.any(), {
      method: "jsonSchema",     // 强制走最兼容的 json_schema 方式
      strict: true,             // 让 LangChain 在系统提示里加 “只输出 JSON，禁止任何解释”
      name: "any_output",    // 可选，调试时加上名字能看到更清楚
    });


    /**
     * Returns a chain with the function calling model.
     */
    const chain = prompt.pipe(functionCallingModel);

    const result = await chain.invoke({
      input: currentMessageContent,
    });

    console.log("返回结果", result);


    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
