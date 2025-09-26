/**
 * @fileoverview Main orchestration module for Hacker News Summarizer
 * @description Coordinates the entire workflow of fetching Hacker News articles,
 * generating AI summaries, and posting them to Slack with proper error handling.
 */

import { fetchHackerNews } from "./news"
import { generateSingleArticleSummary, isValidSummary } from "./gemini"
import { postToSlack, postArticleToSlack } from "./slack"
import { SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, GEMINI_MODEL, SLACK_USERNAME, GEMINI_API_KEY, ARTICLE_COUNT } from "./config"
import { NewsArticle } from "./types"


/**
 * Processes a single article to generate summary
 * @param article - Article to process
 * @returns Object with article and summary text
 * @throws {Error} When summary generation fails or is blocked by safety filters
 */
const processArticleForSummary = (article: NewsArticle): { article: NewsArticle; summaryBody: string } => {
    console.log(`Generating summary body for: ${article.title}`)
    const summaryBody = generateSingleArticleSummary(GEMINI_API_KEY, GEMINI_MODEL, article)
    if (!isValidSummary(summaryBody)) {
        const reason = summaryBody || '不明な理由'
        console.warn(`Summary generation issue or block for "${article.title}": ${reason}`)
        throw new Error(`要約生成が安全上の理由でブロックされました: ${reason}`)
    }

    return { article, summaryBody }
}

/**
 * Posts an article summary to Slack using programmatic values
 * @param summary - Summary object with article and generated text
 * @throws {Error} When Slack posting fails
 */
const postSummaryToSlack = ({ article, summaryBody }: { article: NewsArticle; summaryBody: string }): void => {
    console.log(`Attempting to post summary for "${article.title}"`)
    postArticleToSlack(article, summaryBody, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL, { username: SLACK_USERNAME })
    console.log(`Successfully posted summary for "${article.title}"`)
}

/**
 * Wrapper function that adds rate limiting to array iteration functions
 * @param fn - Function to apply to each element
 * @param delayMs - Delay in milliseconds between calls (default: 2000)
 * @returns Wrapped function with rate limiting applied that can be used with Array.map or Array.forEach
 */
const withRateLimit = <T, R>(fn: (item: T) => R, delayMs: number = 2000) => {
    return (item: T, index: number, array: T[]): R => {
        const result = fn(item)
        if (index < array.length - 1) {
            console.log(`Waiting ${delayMs}ms before next operation...`)
            Utilities.sleep(delayMs)
        }
        return result
    }
}

/**
 * Main function that executes news fetching and summarization
 * @returns Success message with the number of posted summaries
 * @throws {Error} When critical errors occur during processing
 */
export const main = (): string => {
    console.log(`Fetching recent news for Hacker News...`)
    const articles: NewsArticle[] = fetchHackerNews(ARTICLE_COUNT)

    if (articles.length === 0) {
        console.log("No news articles found.")
        postToSlack(undefined, undefined, "Hacker Newsから最近のニュースは見つかりませんでした。", SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL, { username: SLACK_USERNAME })
        return "Hacker Newsから最近のニュースは見つかりませんでした。"
    }

    console.log(`Found ${articles.length} articles. Generating summaries...`)
    const summaries = articles.map(withRateLimit(processArticleForSummary, 1000))

    console.log(`Posting summaries to Slack...`)
    summaries.forEach(withRateLimit(postSummaryToSlack))

    console.log(`Processing complete. ${summaries.length} articles successfully summarized and posted.`)
    return `${summaries.length} summaries posted.`
}
