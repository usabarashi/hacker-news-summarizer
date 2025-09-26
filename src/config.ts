/**
 * @fileoverview Configuration constants and environment variables
 * @description Exports configuration values from Google Apps Script properties
 * and defines default settings for the application.
 */

export const GEMINI_API_KEY: string = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || (() => { throw new Error("GEMINI_API_KEY is required but not set in script properties.") })()
export const GEMINI_MODEL: string = PropertiesService.getScriptProperties().getProperty("GEMINI_MODEL") || (() => { throw new Error("GEMINI_MODEL is required but not set in script properties.") })()
export const SLACK_BOT_TOKEN: string = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_TOKEN") || (() => { throw new Error("SLACK_BOT_TOKEN is required but not set in script properties.") })()
export const SLACK_CHANNEL_ID: string = PropertiesService.getScriptProperties().getProperty("SLACK_CHANNEL_ID") || (() => { throw new Error("SLACK_CHANNEL_ID is required but not set in script properties.") })()
export const ARTICLE_COUNT = parseInt(PropertiesService.getScriptProperties().getProperty("ARTICLE_COUNT") || "3", 10)

export const SLACK_USERNAME = "Hacker News Summarizer"
