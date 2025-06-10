/**
 * @fileoverview Slack API integration module for message posting
 * @description Handles formatting and posting of news summaries to Slack channels
 * with rich attachments, date parsing, and error handling.
 */

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
}

interface SlackOptions {
    username?: string
    iconEmoji?: string
    iconUrl?: string
}

interface ParsedContent {
    mainText: string
    pubTimestamp?: number
    extractedPubDateLine?: string
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
 * @returns Unix timestamp or undefined if parsing fails
 */
const parseDateToTimestamp = (dateString: string): number | undefined => {
    try {
        let parsedDate = new Date(dateString)

        if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 1970) {
            const normalizedJapDate = dateString.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
            parsedDate = new Date(normalizedJapDate)
        }

        if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 1970) {
            const normalizedSlashDate = dateString.replace(/\//g, '-')
            parsedDate = new Date(normalizedSlashDate)
        }

        if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 1970) {
            const timestamp = Math.floor(parsedDate.getTime() / 1000)
            console.log(`SLACK_DEBUG: (PubDate Check) Parsed timestamp: ${timestamp} from date string: "${dateString}"`)
            return timestamp
        }

        console.warn(`SLACK_DEBUG: (PubDate Check) Could not reliably parse date: "${dateString}"`)
        return undefined
    } catch (e) {
        console.warn(`SLACK_DEBUG: (PubDate Check) Error parsing date from "${dateString}":`, e)
        return undefined
    }
}

/**
 * Extracts publication date and content from text
 * @param content - Text content to process
 * @returns Parsed content with separated main text and publication info
 */
const parseContentAndDate = (content: string): ParsedContent => {
    const lines = content.split('\n')
    const contentLines: string[] = []
    let extractedPubDateLine: string | undefined
    let pubTimestamp: number | undefined
    let foundPubDate = false

    const pubDateRegex = /^(?:[\s\u00A0\u3000•*-]*)(発行日:|Published:)\s*(.*)/i

    for (const originalLine of lines) {
        const trimmedLine = originalLine.trim()

        if (!foundPubDate) {
            const pubDateMatch = trimmedLine.match(pubDateRegex)
            if (pubDateMatch) {
                extractedPubDateLine = `${pubDateMatch[1]} ${pubDateMatch[2].trim()}`
                const dateString = pubDateMatch[2].trim()
                pubTimestamp = parseDateToTimestamp(dateString)
                foundPubDate = true
                continue
            }
        }

        contentLines.push(originalLine)
    }

    const mainText = contentLines.join('\n').trim()
    const summaryPrefixRegex = /^(?:[\s\u00A0\u3000•*-]*)\*?要約:\*?(?:[\s\u00A0\u3000]*)/i
    const cleanedMainText = mainText.replace(summaryPrefixRegex, "").trim()

    return {
        mainText: cleanedMainText,
        pubTimestamp,
        extractedPubDateLine
    }
}

/**
 * Creates a Slack attachment from parsed content
 * @param parsedContent - Parsed content with main text and date info
 * @param articleTitle - Optional article title
 * @param articleLink - Optional article link
 * @param model - Model name for footer
 * @param currentTimestamp - Current timestamp as fallback
 * @returns Slack attachment object formatted for posting
 */
const createSlackAttachment = (
    parsedContent: ParsedContent,
    articleTitle: string | undefined,
    articleLink: string | undefined,
    model: string,
    currentTimestamp: number
): SlackAttachment => {
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

/**
 * Posts a message to Slack using the Slack Web API.
 * Can handle structured articles with title/link or simple text messages.
 * @param articleTitle - Optional title of the article (for structured messages).
 * @param articleLink - Optional URL of the article (for structured messages).
 * @param summaryOrFullText - The main text content (Gemini summary body or a simple message).
 * @param channelId - The channel ID to post the message to.
 * @param botToken - The Slack Bot User OAuth Token.
 * @param model - The model name (used in contextText for the footer).
 * @param options - Optional configuration for the Slack message (username, icon).
 * @returns Response object from Slack API or null if error.
 * @throws {Error} When API call fails or required parameters are invalid
 */
export const postToSlack = (
    articleTitle: string | undefined,
    articleLink: string | undefined,
    summaryOrFullText: string,
    channelId: string,
    botToken: string,
    model: string,
    options: SlackOptions = {}
): any => {
    try {
        validateSlackParams(summaryOrFullText, channelId, botToken, model)

        console.log(`Preparing to post to Slack. Title: ${articleTitle || 'N/A'}`)

        const currentTimestamp = Math.floor(new Date().getTime() / 1000)
        const newsItemsContent = [summaryOrFullText.trim()].filter(item => item.length > 0)

        const attachments: SlackAttachment[] = []

        if (newsItemsContent.length > 0) {
            for (const itemContent of newsItemsContent) {
                const parsedContent = parseContentAndDate(itemContent)
                const attachment = createSlackAttachment(
                    parsedContent,
                    articleTitle,
                    articleLink,
                    model,
                    currentTimestamp
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
