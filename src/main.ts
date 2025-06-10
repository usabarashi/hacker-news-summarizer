import { fetchCompanyNews } from "./news";
import { generateSingleArticleSummary } from "./gemini";
import { postToSlack } from "./slack";
import { SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, GEMINI_MODEL_NAME, SLACK_USERNAME, GEMINI_API_KEY } from "./config";
import { NewsArticle } from "./types";

interface ProcessResult {
    success: boolean;
    articleTitle: string;
    reason?: string;
}

const SUMMARY_ERRORS = {
    SAFETY_BLOCKED: "要約の生成が安全上の理由でブロックされました。",
    GENERATION_FAILED: "要約テキストが受信できませんでした。"
} as const;

/**
 * Posts a no-news message to Slack
 */
const handleNoNewsFound = (): string => {
    const noNewsMessage = `Hacker Newsから最近のニュースは見つかりませんでした。`;

    try {
        postToSlack(undefined, undefined, noNewsMessage, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL_NAME, { username: SLACK_USERNAME });
    } catch (slackError) {
        console.error("Failed to post 'no news' message to Slack:", slackError);
    }

    return noNewsMessage;
};

/**
 * Checks if summary is valid (not an error message)
 * @param summary - Summary text to validate
 * @returns True if summary is valid, false otherwise
 */
const isValidSummary = (summary: string): boolean => {
    return Boolean(summary) &&
        !summary.startsWith(SUMMARY_ERRORS.SAFETY_BLOCKED) &&
        !summary.startsWith(SUMMARY_ERRORS.GENERATION_FAILED);
};

/**
 * Posts an error message for a specific article
 * @param article - Article that failed processing
 * @param reason - Reason for failure
 */
const postArticleError = (article: NewsArticle, reason: string): void => {
    const errorMessage = `この記事（${article.title} - ${article.link}）の要約取得に失敗しました (理由: ${reason})。\n----------ITEM_SEPARATOR----------\n`;

    try {
        postToSlack(undefined, undefined, errorMessage, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL_NAME, { username: SLACK_USERNAME });
    } catch (slackError) {
        console.error(`Failed to post error message for article "${article.title}" to Slack:`, slackError);
    }
};

/**
 * Posts a processing error message for a specific article
 * @param article - Article that failed processing
 * @param error - Error that occurred
 */
const postProcessingError = (article: NewsArticle, error: any): void => {
    const errorMessage = `この記事（${article.title} - ${article.link}）の処理中または投稿中にエラーが発生しました: ${error.message}\n----------ITEM_SEPARATOR----------\n`;

    try {
        postToSlack(undefined, undefined, errorMessage, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL_NAME, { username: SLACK_USERNAME });
    } catch (slackError) {
        console.error(`Failed to post error message for article "${article.title}" to Slack:`, slackError);
    }
};

/**
 * Processes a single article: generates summary and posts to Slack
 * @param article - Article to process
 * @returns ProcessResult indicating success or failure
 */
const processArticle = (article: NewsArticle): ProcessResult => {
    try {
        console.log(`Generating summary body for: ${article.title}`);
        const summaryBody = generateSingleArticleSummary(GEMINI_API_KEY, GEMINI_MODEL_NAME, article);

        if (!isValidSummary(summaryBody)) {
            const reason = summaryBody || '不明な理由';
            console.warn(`Summary generation issue or block for "${article.title}": ${reason}`);
            postArticleError(article, reason);
            return { success: false, articleTitle: article.title, reason };
        }

        console.log(`Attempting to post summary for "${article.title}"`);
        postToSlack(article.title, article.link, summaryBody, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL_NAME, { username: SLACK_USERNAME });
        console.log(`Successfully posted summary for "${article.title}"`);

        return { success: true, articleTitle: article.title };

    } catch (error) {
        console.error(`Error processing or posting article "${article.title}":`, error);
        postProcessingError(article, error);
        return { success: false, articleTitle: article.title, reason: error.message };
    }
};

/**
 * Posts a general error message to Slack
 * @param error - Error that occurred
 */
const postGeneralError = (error: any): void => {
    try {
        const errorMessage = `処理全体で予期せぬエラーが発生しました: ${error.message}`;
        postToSlack(undefined, undefined, errorMessage, SLACK_CHANNEL_ID, SLACK_BOT_TOKEN, GEMINI_MODEL_NAME, { username: SLACK_USERNAME });
    } catch (slackError) {
        console.error("Failed to post overall error message to Slack:", slackError);
    }
};

/**
 * Main async function that executes news fetching and summarization
 */
export const main = async (): Promise<string> => {
    try {
        console.log(`Fetching recent news for Hacker News...`);
        const articles: NewsArticle[] = fetchCompanyNews();

        if (articles.length === 0) {
            console.log("No news articles found.");
            return handleNoNewsFound();
        }

        console.log(`Found ${articles.length} articles. Generating summaries and posting for each...`);
        const articlesToSummarize = articles.slice(0, 3);

        const results: ProcessResult[] = [];

        for (const article of articlesToSummarize) {
            const result = processArticle(article);
            results.push(result);

            Utilities.sleep(2000);
        }

        const successfulPosts = results.filter(result => result.success).length;

        console.log(`Processing complete. ${successfulPosts} of ${articlesToSummarize.length} articles successfully summarized and posted.`);
        return `${successfulPosts} summaries posted.`;

    } catch (error) {
        console.error("Error in main function:", error);
        postGeneralError(error);
        throw error;
    }
};

/**
 * Synchronous handler that properly manages async execution in GAS
 */
export const handler = () => {
    try {
        main().then(result => {
            console.log("Process completed successfully: ", result);
            PropertiesService.getScriptProperties().setProperty("LAST_RUN_RESULT", "Success: " + result);
        }).catch(error => {
            console.error("Error in async handler:", error);
            PropertiesService.getScriptProperties().setProperty("LAST_RUN_RESULT", "Error: " + error.message);
        });
        console.log("Async process initiated");
    } catch (error) {
        console.error("Error in synchronous handler:", error);
    }
}

/**
 * Standard web app entry point for Google Apps Script
 */
export function doGet(e: any) {
    handler();
    return HtmlService.createHtmlOutput('The process has started (please check the logs for results later).');
}

/**
 * Time-driven trigger function for scheduled execution
 */
export function runDaily() {
    handler();
    console.log("Daily trigger executed at " + new Date().toISOString());
}
