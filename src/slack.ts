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

interface ParsedContent {
    mainText: string
    pubTimestamp: number
    extractedPubDateLine: string
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
    if (!summaryOrFullText && summaryOrFullText !== "") {
        throw new Error("summaryOrFullText cannot be null/undefined")
    }
    if (!channelId) throw new Error("Channel ID is required")
    if (!botToken) throw new Error("Slack Bot Token is required")
    if (!model) throw new Error("Model name is required for context")
}

/**
 * Attempts to parse a date string into timestamp
 * @param dateString - Date string to parse
 * @returns Unix timestamp, or current timestamp if parsing fails
 */
const parseDateToTimestamp = (dateString: string): number => {
    const tryParseDate = (input: string): Date | null => {
        const date = new Date(input)
        return (!isNaN(date.getTime()) && date.getFullYear() > 1970) ? date : null
    }

    try {
        // Try standard parsing first
        const standardParsed = tryParseDate(dateString)
        if (standardParsed) {
            const timestamp = Math.floor(standardParsed.getTime() / 1000)
            console.log(`SLACK_DEBUG: (PubDate Check) Parsed timestamp: ${timestamp} from date string: "${dateString}"`)
            return timestamp
        }

        // Try Japanese format: "2025年6月11日" → "2025-6-11"
        const normalizedJapDate = dateString.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
        const japParsed = tryParseDate(normalizedJapDate)
        if (japParsed) {
            const timestamp = Math.floor(japParsed.getTime() / 1000)
            console.log(`SLACK_DEBUG: (PubDate Check) Parsed timestamp: ${timestamp} from Japanese date: "${dateString}"`)
            return timestamp
        }

        // Try slash format: "2025/6/11" → "2025-6-11"
        const normalizedSlashDate = dateString.replace(/\//g, '-')
        const slashParsed = tryParseDate(normalizedSlashDate)
        if (slashParsed) {
            const timestamp = Math.floor(slashParsed.getTime() / 1000)
            console.log(`SLACK_DEBUG: (PubDate Check) Parsed timestamp: ${timestamp} from slash date: "${dateString}"`)
            return timestamp
        }

        // All parsing attempts failed
        console.warn(`SLACK_DEBUG: (PubDate Check) Could not reliably parse date: "${dateString}"`)
        return Math.floor(new Date().getTime() / 1000)
    } catch (e) {
        console.warn(`SLACK_DEBUG: (PubDate Check) Error parsing date from "${dateString}":`, e)
        return Math.floor(new Date().getTime() / 1000)
    }
}

/**
 * Extracts publication date and content from text
 * @param content - Text content to process
 * @returns Parsed content with separated main text and publication info
 */
const parseContentAndDate = (content: string): ParsedContent => {
    const lines = content.split('\n')
    const pubDateRegex = /^(?:[\s\u00A0\u3000•*-]*)(発行日:|Published:)\s*(.*)/i

    const pubDateResult = lines.find(line => {
        const trimmed = line.trim()
        return pubDateRegex.test(trimmed)
    })

    const { extractedPubDateLine, pubTimestamp } = pubDateResult
        ? (() => {
            const trimmed = pubDateResult.trim()
            const match = trimmed.match(pubDateRegex)
            if (match && match[1] && match[2]) {
                const dateString = match[2].trim()
                return {
                    extractedPubDateLine: `${match[1]} ${dateString}`,
                    pubTimestamp: parseDateToTimestamp(dateString)
                }
            }
            return { extractedPubDateLine: "", pubTimestamp: 0 }
        })()
        : { extractedPubDateLine: "", pubTimestamp: 0 }

    const contentLines = lines.filter(line => {
        const trimmed = line.trim()
        return !pubDateRegex.test(trimmed)
    })

    const mainText = contentLines.join('\n').trim()
    const summaryPrefixRegex = /^(?:[\s\u00A0\u3000•*-]*)\*?要約:\*?(?:[\s\u00A0\u3000]*)/i
    const cleanedMainText = mainText.replace(summaryPrefixRegex, "").trim()

    return {
        mainText: cleanedMainText,
        pubTimestamp: pubTimestamp || Math.floor(new Date().getTime() / 1000),
        extractedPubDateLine: extractedPubDateLine || ""
    }
}

interface AttachmentOptions {
    articleTitle?: string
    articleLink?: string
}

/**
 * Creates a Slack attachment from parsed content
 * @param parsedContent - Parsed content with main text and date info
 * @param model - Model name for footer
 * @param currentTimestamp - Current timestamp as fallback
 * @param options - Optional article title and link
 * @returns Slack attachment object formatted for posting
 */
const createSlackAttachment = (
    parsedContent: ParsedContent,
    model: string,
    currentTimestamp: number,
    options: AttachmentOptions = {}
): SlackAttachment => {
    const { articleTitle, articleLink } = options
    const attachment: SlackAttachment = {
        fallback: (articleTitle || parsedContent.mainText || "ニュース項目").substring(0, 100),
        color: "#FF6600",
        text: parsedContent.mainText || "",
        mrkdwn_in: ["text", "pretext"],
        footer: `Hacker News Summarizer (Model: ${model})`,
        footer_icon: SLACK_DEFAULT_APP_ICON,
        ts: parsedContent.pubTimestamp || currentTimestamp
    }

    if (articleTitle && articleLink) {
        attachment.title = articleTitle
        attachment.title_link = articleLink
    } else if (articleTitle) {
        attachment.title = articleTitle
    }

    if (parsedContent.pubTimestamp) {
        console.log(`SLACK_DEBUG: Using parsedPubTimestamp for ts: ${parsedContent.pubTimestamp}.`)
    } else if (parsedContent.extractedPubDateLine) {
        console.log(`SLACK_DEBUG: Extracted pub date string "${parsedContent.extractedPubDateLine}" but failed to parse. ts will be currentTimestamp.`)
    } else {
        console.log(`SLACK_DEBUG: No publication date info. ts will be currentTimestamp.`)
    }

    return attachment
}

/**
 * Creates fallback attachment for empty content
 * @param model - Model name for footer
 * @param currentTimestamp - Current timestamp
 * @returns Fallback attachment with default "no content" message
 */
const createFallbackAttachment = (model: string, currentTimestamp: number): SlackAttachment => ({
    fallback: "表示できる情報がありません。",
    color: "#FF6600",
    text: "表示できる情報がありません。",
    mrkdwn_in: ["text"],
    footer: `Hacker News Summarizer (Model: ${model})`,
    footer_icon: SLACK_DEFAULT_APP_ICON,
    ts: currentTimestamp
})

interface PostToSlackParams {
    summaryOrFullText: string
    channelId: string
    botToken: string
    model: string
    articleTitle?: string
    articleLink?: string
    options?: SlackOptions
}

/**
 * Posts a message to Slack using the Slack Web API.
 * Can handle structured articles with title/link or simple text messages.
 */
export function postToSlack(params: PostToSlackParams): any
export function postToSlack(
    articleTitle: string | undefined,
    articleLink: string | undefined,
    summaryOrFullText: string,
    channelId: string,
    botToken: string,
    model: string,
    options?: SlackOptions
): any
export function postToSlack(...args: any[]): any {
    const params: PostToSlackParams = args.length === 1 && typeof args[0] === 'object'
        ? args[0]
        : (() => {
            const [articleTitle, articleLink, summaryOrFullText, channelId, botToken, model, options] = args
            return { summaryOrFullText, channelId, botToken, model, articleTitle, articleLink, options: options || {} }
        })()

    const { summaryOrFullText, channelId, botToken, model, articleTitle, articleLink, options = {} } = params
    try {
        validateSlackParams(summaryOrFullText, channelId, botToken, model)

        console.log(`Preparing to post to Slack. Title: ${articleTitle || 'N/A'}`)

        const currentTimestamp = Math.floor(new Date().getTime() / 1000)
        const newsItemsContent = [summaryOrFullText.trim()].filter(item => item.length > 0)

        const attachments: SlackAttachment[] = []

        if (newsItemsContent.length > 0) {
            for (const itemContent of newsItemsContent) {
                const parsedContent = parseContentAndDate(itemContent)
                const attachmentOptions: AttachmentOptions = {}
                if (articleTitle) attachmentOptions.articleTitle = articleTitle
                if (articleLink) attachmentOptions.articleLink = articleLink

                const attachment = createSlackAttachment(
                    parsedContent,
                    model,
                    currentTimestamp,
                    attachmentOptions
                )
                attachments.push(attachment)
            }
        } else if (summaryOrFullText?.trim().length > 0) {
            const attachment: SlackAttachment = {
                fallback: summaryOrFullText.substring(0, 100),
                color: "#FF6600",
                text: summaryOrFullText,
                mrkdwn_in: ["text"],
                footer: `Hacker News Summarizer (Model: ${model})`,
                footer_icon: SLACK_DEFAULT_APP_ICON,
                ts: currentTimestamp
            }
            attachments.push(attachment)
        } else {
            attachments.push(createFallbackAttachment(model, currentTimestamp))
        }

        if (attachments.length === 0) {
            console.log("No attachments to send to Slack.")
            return { message: "No content to post." }
        }

        const payload: any = {
            channel: channelId,
            text: "",
            attachments: attachments
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
            title_link: article.link
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
