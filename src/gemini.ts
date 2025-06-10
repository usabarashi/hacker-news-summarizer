/**
 * @fileoverview Gemini AI integration module for text summarization
 * @description Handles communication with Google's Gemini API to generate Japanese summaries
 * of Hacker News articles, including safety filtering and error handling.
 */

import { NewsArticle } from "./types"
import { PROMPTS } from "./loadedPrompts"

export type ProcessResult = 
    | { success: true; articleTitle: string }
    | { success: false; articleTitle: string; reason: string }

const SUMMARY_ERRORS = {
    SAFETY_BLOCKED: "要約の生成が安全上の理由でブロックされました。",
    GENERATION_FAILED: "要約テキストが受信できませんでした。"
} as const

/**
 * Checks if summary is valid (not an error message)
 * @param summary - Summary text to validate
 * @returns True if summary is valid, false otherwise
 */
export const isValidSummary = (summary: string): boolean => {
    return Boolean(summary) &&
        !summary.startsWith(SUMMARY_ERRORS.SAFETY_BLOCKED) &&
        !summary.startsWith(SUMMARY_ERRORS.GENERATION_FAILED)
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>
        }
        finishReason?: string
        safetyRatings?: any[]
    }>
}

interface GeminiResult {
    text: string
    raw: GeminiResponse
    model: string
}

/**
 * Checks if content generation was blocked due to safety ratings
 * @param response - Parsed Gemini API response
 * @param model - Model name used for the request
 * @returns Safety blocked result with boolean indicator
 */
const checkSafetyBlocking = (response: GeminiResponse, model: string): { blocked: true; result: GeminiResult } | { blocked: false } => {
    const candidate = response.candidates?.[0]
    if (candidate?.finishReason === "SAFETY") {
        console.warn("Gemini content generation blocked due to safety ratings:", candidate.safetyRatings)
        return {
            blocked: true,
            result: {
                text: "要約の生成が安全上の理由でブロックされました。",
                raw: response,
                model
            }
        }
    }

    return { blocked: false }
}

/**
 * Parses successful Gemini API response
 * @param response - Parsed Gemini API response
 * @param model - Model name used for the request
 * @returns Formatted result with extracted text
 */
const parseSuccessfulResponse = (response: GeminiResponse, model: string): GeminiResult => {
    const extractedText = response.candidates?.[0]?.content?.parts?.[0]?.text

    return {
        text: extractedText || "要約テキストが受信できませんでした。",
        raw: response,
        model
    }
}

/**
 * Calls the Gemini API with proper API key authentication and error handling
 *
 * This function handles the low-level HTTP communication with Google's Gemini API,
 * including request formatting, authentication, response parsing, and safety filtering.
 *
 * @param apiKey - Google Cloud API key for Gemini API authentication
 * @param model - Gemini model name (e.g., "gemini-1.5-pro")
 * @param contents - JSON string containing the request payload with contents array
 * @returns GeminiResult object containing extracted text, raw response, and model info
 *
 * @throws {Error} When API returns non-200 status code or network request fails
 */
export const callGeminiAPI = (apiKey: string, model: string, contents: string): GeminiResult => {
    try {
        const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?`
        const requestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
            method: 'post',
            contentType: 'application/json',
            headers: { 'x-goog-api-key': apiKey },
            payload: contents,
            muteHttpExceptions: true
        }
        const response = UrlFetchApp.fetch(apiEndpoint, requestOptions)

        const responseCode = response.getResponseCode()
        const responseText = response.getContentText()
        console.log(`Gemini API call for single summary responded with status code: ${responseCode}`)
        if (responseCode !== 200) {
            console.error(`Gemini API Error (${responseCode}): ${responseText}`)
            throw new Error(`Gemini API error: ${responseText}`)
        }

        const parsedResponse: GeminiResponse = JSON.parse(responseText)
        const safetyCheck = checkSafetyBlocking(parsedResponse, model)
        if (safetyCheck.blocked) return safetyCheck.result

        return parseSuccessfulResponse(parsedResponse, model)
    } catch (error) {
        console.error("Failed to call Gemini API:", error)
        throw error
    }
}

/**
 * Builds context information for an article
 * @param article - News article to build context for
 * @returns Formatted context string
 */
const buildArticleContext = (article: NewsArticle): string => {
    const baseInfo = [
        `## 参考記事情報: ${article.title}`,
        `- リンク: ${article.link}`
    ]

    if (article.description && article.description !== article.title) {
        baseInfo.push(`- 概要/HN上のテキスト: ${article.description}`)
    }

    baseInfo.push(`- 日付: ${new Date(article.pubDate).toLocaleString('ja-JP')}`)

    if (article.comments?.length) {
        baseInfo.push(`- 主なコメント:`)
        const commentLines = article.comments
            .slice(0, 3)
            .map(comment => {
                const cleanComment = comment
                    .replace(/\n/g, ' ')
                    .replace(/`/g, "'")
                    .substring(0, 200)
                return `  - ${cleanComment}`
            })
        baseInfo.push(...commentLines)
    }

    return baseInfo.join('\n') + '\n'
}

/**
 * Generates a summary body for a single news article using Gemini API
 *
 * The summary body contains summary, discussion points, and publication date.
 * Title and URL are handled separately by Slack attachment fields.
 *
 * @param apiKey - Google Cloud API key for Gemini API authentication
 * @param model - Gemini model name to use for text generation
 * @param article - News article object containing title, link, description, and comments
 * @returns Generated summary text in Japanese, trimmed of whitespace
 *
 * @throws {Error} When Gemini API call fails or returns error response
 */
export const generateSingleArticleSummary = (apiKey: string, model: string, article: NewsArticle): string => {
    const articleInfoForContext = buildArticleContext(article)

    const outputFormatInstruction = PROMPTS.singleArticleSummary.outputFormatInstruction
    const mainPrompt = PROMPTS.singleArticleSummary.mainPromptTemplate
        .replace('${articleInfoForContext}', articleInfoForContext)

    const contentsPayload = [{
        parts: [
            { text: outputFormatInstruction },
            { text: mainPrompt }
        ]
    }]

    console.log(`Generating summary body for article: "${article.title}" (using prompts from YAML)`)
    const response = callGeminiAPI(apiKey, model, JSON.stringify({ contents: contentsPayload }))
    return response.text.trim()
}
