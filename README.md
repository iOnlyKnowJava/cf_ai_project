# cf_ai_project

Interact with agent at https://agents-starter.vincexia.workers.dev

Basic AI chat agent project for the Cloudflare AI app assignment. Consists of the base agents-starter code, but modified so that the weather and local time tools are able to give the accurate information, in addition to an added "message in a bottle" functionality which allows users to write messages in bottles which can be retrieved randomly by other users later.

Sometimes the agent will say something along the lines that it is unable to run a tool or that the provided parameters are not adequate, or simply write out the input parameters of the tool requested instead of running the tool. The user should just repeat the prompt or try rephrasing the prompt if this happens.

The `scheduleTask`, `getScheduledTasks`, and `cancelScheduledTask` tools work the same as in the agents-starter code, allowing the user to schedule future tasks and manage their scheduled tasks via the chat agent.

The modified `getWeatherInformation` tool is able to find the weather of a location given by the user, and can be run by asking the agent for the weather at some location. Ex: "What is the current weather in Austin?" The agent should then return many statistics describing the weather at the location requested.

The modified `getLocalTime` tool is able to find the local time of a given location, and can be run by the user requesting the local time for a given location. Ex: "What is the current local time in Shanghai?". Currently, the tool is configured so that the returned time is formatted to match the location requested.

The added `createMessageInBottle` tool creates a message in a bottle to be stored on a durable object so that other users can later receive this message by using the `getMessageInBottle` tool. This tool can be invoked with a prompt such as "Create a message in a bottle with the message 'Example Message'".

The added `getMessageInBottle` tool randomly obtains one message in a bottle which was previously created with the `createMessageInBottle` tool and reads its contents to the user. This tool can be invoked with a prompt such as "Get a message in a bottle".