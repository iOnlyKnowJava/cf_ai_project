/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

import {env} from "cloudflare:workers"

const createMessageInBottle = tool({
  description: "Create a message in a bottle for users to later find",
  inputSchema: z.object({ message: z.string()})
  // Omitting execute function makes this tool require human confirmation
});

const getMessageInBottle = tool({
  description: "Obtain a message in a bottle which was previously created",
  inputSchema: z.object({})
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description: "show the weather at a given city to the user",
  inputSchema: z.object({ city: z.string(), latitude: z.number().int(), longitude: z.number().int() })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time and date for a specified location",
  inputSchema: z.object({ BCP_47_language_tag: z.string(), ISO_8601_timezone: z.string() }),
  execute: async ({ BCP_47_language_tag, ISO_8601_timezone }) => {
    console.log(`Getting local time for ${ISO_8601_timezone}`);
    return new Intl.DateTimeFormat(BCP_47_language_tag,{dateStyle:"full", timeStyle:"long", timeZone:ISO_8601_timezone}).format(new Date()).toString();
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  createMessageInBottle,
  getMessageInBottle,
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  createMessageInBottle: async ({message}: {message:string}) => {
    const msgId=env.MessageStorage.idFromName("allMessages");
    const stub = env.MessageStorage.get(msgId);
    return await stub.addMessage(message);
  },
  getMessageInBottle: async () => {
    const msgId=env.MessageStorage.idFromName("allMessages");
    const stub = env.MessageStorage.get(msgId);
    return await stub.getMessage();
  },
  getWeatherInformation: async ({ city, latitude, longitude }: { city: string, latitude: number, longitude: number }) => {
    console.log(`Getting weather information for ${city}`);
    let response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,rain,showers,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m`);
    if(!response.ok){
      return `Unable to fetch weather information at ${city}`;
    }
    let info = await response.json();
    return info;
  }
};