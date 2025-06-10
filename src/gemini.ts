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
 * Generates a summary and discussion points for a single news article using Gemini API
 *
 * @param apiKey - Google Cloud API key for Gemini API authentication
 * @param model - Gemini model name to use for text generation
 * @param article - News article object containing title, link, description, and comments
 * @returns Generated summary text in Japanese, trimmed of whitespace
 *
 * @throws {Error} When Gemini API call fails or returns error response
 */
export const generateSingleArticleSummary = (apiKey: string, model: string, article: NewsArticle): string => {
    const outputFormatInstruction = PROMPTS.singleArticleSummary.outputFormatInstruction
    
    // Build article content directly
    let articleContent = `記事タイトル: ${article.title}\n記事リンク: ${article.link}\n`
    
    if (article.description && article.description !== article.title) {
        articleContent += `記事内容: ${article.description}\n`
    }
    
    if (article.comments?.length) {
        articleContent += `\nコメント:\n`
        const commentLines = article.comments
            .slice(0, 5)
            .map((comment, index) => {
                const cleanComment = comment
                    .replace(/\n/g, ' ')
                    .replace(/`/g, "'")
                    .substring(0, 200)
                return `${index + 1}. ${cleanComment}`
            })
        articleContent += commentLines.join('\n')
    }

    const mainPrompt = PROMPTS.singleArticleSummary.mainPromptTemplate
        .replace('${articleInfoForContext}', articleContent)

    const contentsPayload = [{
        parts: [
            { text: outputFormatInstruction },
            { text: mainPrompt }
        ]
    }]

    console.log(`Generating summary for article: "${article.title}"`)
    const response = callGeminiAPI(apiKey, model, JSON.stringify({ contents: contentsPayload }))
    return response.text.trim()
}
