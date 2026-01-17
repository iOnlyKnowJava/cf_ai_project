import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createWorkersAI } from 'workers-ai-provider';
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import { env, DurableObject } from "cloudflare:workers";
const workersai = createWorkersAI({ binding: env.AI });
const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

export class MessageStorage extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    // Required, as we're extending the base class.
    super(ctx, env)
    console.log("Creating table");
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages(
        id  INTEGER NOT NULL PRIMARY KEY,
        msg TEXT
      );
    `);
    console.log("Finished initializing table");
  }
  async addMessage(msg:string):Promise<string>{
    console.log("Checking that max capacity not reached");
    if(this.ctx.storage.sql.exec(`
      SELECT COUNT(*) FROM messages;
    `).raw().next().value[1]>100){
      console.log("Max capacity reached, removing an entry to make space");
      let entry = this.ctx.storage.sql.exec(`
        SELECT * FROM messages ORDER BY RANDOM() LIMIT 1;
      `).raw().next().value;
      this.ctx.storage.sql.exec(`
        DELETE FROM messages WHERE id = ?;`, entry[0]);
      console.log("One entry removed");
    }
    console.log("Inserting message into table");
    this.ctx.storage.sql.exec(`
      INSERT INTO messages (msg)
      VALUES(?);`, msg);
    console.log("Finished adding message");
    return "Message successfully added";
  }
  async getMessage():Promise<string>{
    console.log("Checking that a message in a bottle exists");
    if(this.ctx.storage.sql.exec(`
      SELECT COUNT(*) FROM messages AS cnt;
    `).raw().next().value[1]==0){
      return "No currently existing messages in bottles";
    }
    console.log("Getting random message...");
    let entry = this.ctx.storage.sql.exec(`
      SELECT * FROM messages ORDER BY RANDOM() LIMIT 1;
    `).raw().next().value;
    console.log("Deleting message from database");
    this.ctx.storage.sql.exec(`
      DELETE FROM messages WHERE id = ?;`, entry[0]);
    console.log("Obtained message");
    return entry[1];
  }
}

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      // ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a helpful assistant that can do various tasks... 

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task. If the user asks for the weather
at a given location, use the getWeatherInformation tool to find the local weather at that location. For example, if the user asks for the weather in Austin,
call getWeatherInformation({"location":"Austin"}). For the local time tool, you must find the BCP 47 language tag the date should be formatted in and the ISO 8601
timezone of the given location, then call the getLocalTime tool using this information. For example, if the user asks
for the local time in Shanghai, you must determine that the appropriate BCP 47 language tag to use is "zh-CN" and the requested timezone
is "Asia/Shanghai", then call getLocalTime("BCP_47_language_tag": "zh-CN","ISO_8601_timezone": "Asia/Shanghai").
If the user asks to send a message in a bottle, use the createMessageInBottle tool to create a message in a bottle with the message.
If the user asks to receive a message in a bottle, use the getMessageInBottle tool to obtain a message in a bottle which contains a message for the user.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(30)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;