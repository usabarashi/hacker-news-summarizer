export const GEMINI_API_KEY: string = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || (() => { throw new Error("GEMINI_API_KEY is required but not set in script properties."); })();
export const SLACK_BOT_TOKEN: string = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_TOKEN") || (() => { throw new Error("SLACK_BOT_TOKEN is required but not set in script properties."); })();
export const SLACK_CHANNEL_ID: string = PropertiesService.getScriptProperties().getProperty("SLACK_CHANNEL_ID") || (() => { throw new Error("SLACK_CHANNEL_ID is required but not set in script properties."); })();

export const SLACK_USERNAME = "Hacker News";
export const GEMINI_MODEL_NAME = "gemini-1.5-pro";
