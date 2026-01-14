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
  description: "Creates a message in a bottle containing the message given by the user. Should be called if user asks to create a message in a bottle. This tool returns the status of this operation.",
  inputSchema: z.object({ message: z.string()})
  // Omitting execute function makes this tool require human confirmation
});

const getMessageInBottle = tool({
  description: "Obtains a message in a bottle and returns the message found inside. Should be called if user asks to get a message in a bottle.",
  inputSchema: z.object({})
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description: "returns the weather information of a given location. Should be called if user asks for the weather at any location.",
  inputSchema: z.object({ location: z.string() })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "returns the local time and date for a specified timezone given the BCP 47 language tag the date should be formatted in and the requested ISO 8601 timezone. Should be called if user asks for the local time at any given timezone.",
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
    console.log(`Creating message in a bottle...`);
    const msgId=env.MessageStorage.idFromName("allMessages");
    const stub = env.MessageStorage.get(msgId);
    const response = await stub.addMessage(message);
    console.log(`Finished creating message in bottle`);
    return response;
  },
  getMessageInBottle: async () => {
    console.log(`Getting message in a bottle...`);
    const msgId=env.MessageStorage.idFromName("allMessages");
    const stub = env.MessageStorage.get(msgId);
    const response = await stub.getMessage();
    console.log(`Finished getting message in bottle`);
    return response;
  },
  getWeatherInformation: async ({ location }: { location:string }) => {
    console.log(`Getting weather information for ${location}`);
    let url = `https://geocode.maps.co/search?q=${location}&api_key=${env.MAPS_CO_KEY}`;
    url = encodeURI(url);
    let response = await fetch(url);
    if(!response.ok){
      return `Unable to fetch weather information at ${location}`;
    }
    let loc_info:{lat:number,lon:number}[] = await response.json();
    if(loc_info.length<1){
      return `Unable to fetch weather information at ${location}`;
    }
    response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc_info[0].lat}&longitude=${loc_info[0].lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,rain,showers,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m`);
    if(!response.ok){
      return `Unable to fetch weather information at ${location}`;
    }
    let info = await response.json();
    return info;
  }
};