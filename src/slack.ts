/**
 * @fileoverview Slack API integration module for message posting
 * @description Handles formatting and posting of news summaries to Slack channels
 * with rich attachments, date parsing, and error handling.
 */

import { NewsArticle } from "./types"

interface SlackAttachment {
    fallback: string
    color: string
    text: string
    mrkdwn_in: string[]
    footer: string
    footer_icon: string
    ts: number
    title?: string
    title_link?: string
    fields?: Array<{
        title: string
        value: string
        short: boolean
    }>
}

interface SlackOptions {
    username?: string
    iconEmoji?: string
    iconUrl?: string
}

const SLACK_DEFAULT_APP_ICON = "https://platform.slack-edge.com/img/default_application_icon.png"

/**
 * Validates required parameters for Slack posting
 * @param summaryOrFullText - Main content to post
 * @param channelId - Slack channel ID
 * @param botToken - Slack bot token
 * @param model - Model name for context
 * @throws {Error} When any required parameter is missing or invalid
 */
const validateSlackParams = (summaryOrFullText: string, channelId: string, botToken: string, model: string): void => {
    if (!summaryOrFullText && summaryOrFullText !== "") throw new Error("summaryOrFullText cannot be null/undefined")
    if (!channelId) throw new Error("Channel ID is required")
    if (!botToken) throw new Error("Slack Bot Token is required")
    if (!model) throw new Error("Model name is required for context")
}

/**
 * Posts a message to Slack using the Slack Web API.
 * Can handle structured articles with title/link or simple text messages.
 *
 * @param articleTitle - Optional article title for structured posts
 * @param articleLink - Optional article link for structured posts
 * @param summaryOrFullText - Main content to post to Slack
 * @param channelId - Slack channel ID
 * @param botToken - Slack bot token for authentication
 * @param model - Model name for footer context
 * @param options - Optional Slack formatting options
 * @returns Slack API response object
 */
export function postToSlack(
    articleTitle: string | undefined,
    articleLink: string | undefined,
    summaryOrFullText: string,
    channelId: string,
    botToken: string,
    model: string,
    options?: SlackOptions
): any {
    const { username, iconEmoji, iconUrl } = options || {}
    try {
        validateSlackParams(summaryOrFullText, channelId, botToken, model)
        console.log(`Preparing to post to Slack. Title: ${articleTitle || 'N/A'}`)
        const currentTimestamp = Math.floor(new Date().getTime() / 1000)
        const attachment: SlackAttachment = {
            fallback: (articleTitle || summaryOrFullText || "ニュース項目").substring(0, 100),
            color: "#FF6600",
            text: summaryOrFullText || "表示できる情報がありません。",
            mrkdwn_in: ["text"],
            footer: `Hacker News Summarizer (Model: ${model})`,
            footer_icon: SLACK_DEFAULT_APP_ICON,
            ts: currentTimestamp
        }
        if (articleTitle) {
            attachment.title = articleTitle
            if (articleLink) attachment.title_link = articleLink
        }

        const payload: any = {
            channel: channelId,
            text: "",
            attachments: [attachment]
        }

        if (username) payload.username = username
        if (iconEmoji) payload.icon_emoji = iconEmoji
        else if (iconUrl) payload.icon_url = iconUrl
        const apiUrl = "https://slack.com/api/chat.postMessage"
        const requestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
            method: "post",
            contentType: "application/json",
            headers: { Authorization: `Bearer ${botToken}` },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        }

        const response = UrlFetchApp.fetch(apiUrl, requestOptions)
        const responseCode = response.getResponseCode()
        const responseBody = JSON.parse(response.getContentText())
        if (responseCode !== 200 || !responseBody.ok) {
            console.error(`Slack API error: ${responseCode}, ${JSON.stringify(responseBody)}`)
            throw new Error(`Slack API error: ${responseBody.error || "Unknown error"}`)
        }

        console.log("Message successfully posted to Slack.")
        return responseBody
    } catch (error) {
        console.error("Error in postToSlack function:", error)
        throw error
    }
}

/**
 * Posts a news article to Slack using programmatic values directly
 * @param article - News article with all metadata
 * @param aiSummary - AI-generated summary text (summary and discussion only)
 * @param channelId - Slack channel ID
 * @param botToken - Slack bot token
 * @param model - Model name for footer
 * @param options - Additional Slack options
 * @returns Slack API response
 */
export function postArticleToSlack(
    article: NewsArticle,
    aiSummary: string,
    channelId: string,
    botToken: string,
    model: string,
    options: SlackOptions = {}
): any {
    try {
        validateSlackParams(aiSummary, channelId, botToken, model)
        console.log(`Posting article to Slack: ${article.title}`)
        const mainMessage = aiSummary
        const metadataParts = []
        if (article.score !== undefined) metadataParts.push(`${article.score} points`)
        if (article.author) metadataParts.push(`by ${article.author}`)
        if (article.commentCount !== undefined) metadataParts.push(`${article.commentCount} comments`)
        if (article.articleType && article.articleType !== 'Story') metadataParts.push(`[${article.articleType}]`)
        const metadataLine = metadataParts.join(' | ')
        const footerText = metadataLine ? `${metadataLine} • Summarized by ${model}` : `Hacker News Summarizer (Model: ${model})`
        const articleTimestamp = Math.floor(new Date(article.pubDate).getTime() / 1000)
        const attachment: SlackAttachment = {
            fallback: article.title.substring(0, 100),
            color: "#FF6600",
            text: mainMessage,
            mrkdwn_in: ["text", "pretext"],
            footer: footerText,
            footer_icon: SLACK_DEFAULT_APP_ICON,
            ts: articleTimestamp,
            title: article.title,
            title_link: `https://news.ycombinator.com/item?id=${article.hackerNewsId}`
        }

        const payload: any = {
            channel: channelId,
            text: "",
            attachments: [attachment]
        }

        if (options.username) payload.username = options.username
        if (options.iconEmoji) payload.icon_emoji = options.iconEmoji
        else if (options.iconUrl) payload.icon_url = options.iconUrl
        const apiUrl = "https://slack.com/api/chat.postMessage"
        const requestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
            method: "post",
            contentType: "application/json",
            headers: { Authorization: `Bearer ${botToken}` },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        }

        const response = UrlFetchApp.fetch(apiUrl, requestOptions)
        const responseCode = response.getResponseCode()
        const responseBody = JSON.parse(response.getContentText())
        if (responseCode !== 200 || !responseBody.ok) {
            console.error(`Slack API error: ${responseCode}, ${JSON.stringify(responseBody)}`)
            throw new Error(`Slack API error: ${responseBody.error || "Unknown error"}`)
        }

        console.log("Article successfully posted to Slack.")
        return responseBody
    } catch (error) {
        console.error("Error in postArticleToSlack function:", error)
        throw error
    }
}
