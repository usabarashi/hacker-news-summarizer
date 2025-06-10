import { NewsArticle } from "./types";
import { PROMPTS } from "./loadedPrompts";

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
        finishReason?: string;
        safetyRatings?: any[];
    }>;
}

interface GeminiResult {
    text: string;
    raw: GeminiResponse;
    model: string;
}

/**
 * Checks if content generation was blocked due to safety ratings
 * @param response - Parsed Gemini API response
 * @returns Safety blocked result if blocked, null otherwise
 */
const checkSafetyBlocking = (response: GeminiResponse, model: string): GeminiResult | null => {
    const candidate = response.candidates?.[0];

    if (candidate?.finishReason === "SAFETY") {
        console.warn("Gemini content generation blocked due to safety ratings:", candidate.safetyRatings);
        return {
            text: "要約の生成が安全上の理由でブロックされました。",
            raw: response,
            model
        };
    }

    return null;
};

/**
 * Parses successful Gemini API response
 * @param response - Parsed Gemini API response
 * @param model - Model name used for the request
 * @returns Formatted result with extracted text
 */
const parseSuccessfulResponse = (response: GeminiResponse, model: string): GeminiResult => {
    const extractedText = response.candidates?.[0]?.content?.parts?.[0]?.text;

    return {
        text: extractedText || "要約テキストが受信できませんでした。",
        raw: response,
        model
    };
};

/**
 * Calls the Gemini API with proper API key authentication
 */
export const callGeminiAPI = (apiKey: string, model: string, contents: string): GeminiResult => {
    try {
        const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?`;
        const requestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
            method: 'post',
            contentType: 'application/json',
            headers: { 'x-goog-api-key': apiKey },
            payload: contents,
            muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch(apiEndpoint, requestOptions);
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();

        console.log(`Gemini API call for single summary responded with status code: ${responseCode}`);

        if (responseCode !== 200) {
            console.error(`Gemini API Error (${responseCode}): ${responseText}`);
            throw new Error(`Gemini API error: ${responseText}`);
        }

        const parsedResponse: GeminiResponse = JSON.parse(responseText);

        const safetyBlockedResult = checkSafetyBlocking(parsedResponse, model);
        if (safetyBlockedResult) {
            return safetyBlockedResult;
        }

        return parseSuccessfulResponse(parsedResponse, model);

    } catch (error) {
        console.error("Failed to call Gemini API:", error);
        throw error;
    }
};

/**
 * Builds context information for an article
 * @param article - News article to build context for
 * @returns Formatted context string
 */
const buildArticleContext = (article: NewsArticle): string => {
    const baseInfo = [
        `## 参考記事情報: ${article.title}`,
        `- リンク: ${article.link}`
    ];

    if (article.description && article.description !== article.title) {
        baseInfo.push(`- 概要/HN上のテキスト: ${article.description}`);
    }

    baseInfo.push(`- 日付: ${new Date(article.pubDate).toLocaleString('ja-JP')}`);

    if (article.comments?.length) {
        baseInfo.push(`- 主なコメント:`);
        const commentLines = article.comments
            .slice(0, 3)
            .map(comment => {
                const cleanComment = comment
                    .replace(/\n/g, ' ')
                    .replace(/`/g, "'")
                    .substring(0, 200);
                return `  - ${cleanComment}`;
            });
        baseInfo.push(...commentLines);
    }

    return baseInfo.join('\n') + '\n';
};

/**
 * Generates a summary body for a single news article using Gemini API.
 * The summary body should contain summary, discussion points, and publication date.
 * Title and URL are handled separately by Slack attachment fields.
 */
export const generateSingleArticleSummary = (apiKey: string, model: string, article: NewsArticle): string => {
    const articleInfoForContext = buildArticleContext(article);

    const outputFormatInstruction = PROMPTS.singleArticleSummary.outputFormatInstruction;
    const mainPrompt = PROMPTS.singleArticleSummary.mainPromptTemplate
        .replace('${subject}', 'Hacker News')
        .replace('${articleInfoForContext}', articleInfoForContext);

    const contentsPayload = [{
        parts: [
            { text: outputFormatInstruction },
            { text: mainPrompt }
        ]
    }];

    console.log(`Generating summary body for article: "${article.title}" (using prompts from YAML)`);
    const response = callGeminiAPI(apiKey, model, JSON.stringify({ contents: contentsPayload }));
    return response.text.trim();
};
