import { NewsArticle } from "./types";

interface HackerNewsItem {
    id: number;
    title: string;
    url?: string;
    text?: string;
    time: number;
    kids?: number[];
    deleted?: boolean;
    dead?: boolean;
}

interface CommentData {
    text?: string;
    deleted?: boolean;
    dead?: boolean;
}

/**
 * Fetches a single comment from Hacker News API
 * @param commentId - The ID of the comment to fetch
 * @returns Comment text if successful, null otherwise
 */
const fetchSingleComment = (commentId: number): string | null => {
    try {
        const commentUrl = `https://hacker-news.firebaseio.com/v0/item/${commentId}.json`;
        const response = UrlFetchApp.fetch(commentUrl, { muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) return null;

        const commentData = JSON.parse(response.getContentText()) as CommentData;

        return (commentData?.text && !commentData.deleted && !commentData.dead)
            ? commentData.text
            : null;
    } catch (error: any) {
        console.warn(`Error fetching comment ID ${commentId}: ${error.message || error.toString()}`);
        return null;
    }
};

/**
 * Fetches comments for a story using functional approach
 * @param commentIds - Array of comment IDs
 * @param maxComments - Maximum number of comments to fetch
 * @returns Array of comment texts
 */
const fetchCommentsForStory = (commentIds: number[], maxComments: number = 10): string[] => {
    const candidateIds: number[] = commentIds.slice(0, maxComments * 2);

    const comments: string[] = [];

    for (const commentId of candidateIds) {
        if (comments.length >= maxComments) break;
        const commentText = fetchSingleComment(commentId);
        if (commentText) comments.push(commentText);
    }

    return comments;
};

/**
 * Fetches a single story item from Hacker News API
 * @param storyId - The ID of the story to fetch
 * @returns NewsArticle if successful, null otherwise
 */
const fetchStoryDetails = (storyId: number): NewsArticle | null => {
    try {
        const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`;
        const response = UrlFetchApp.fetch(itemUrl, { muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
            console.warn(`Failed to fetch details for story ID ${storyId}. Status: ${response.getResponseCode()}`);
            return null;
        }

        const item = JSON.parse(response.getContentText()) as HackerNewsItem;

        if (!item?.time || !item.title) {
            console.warn(`Story ID ${storyId} has missing critical data (time or title)`);
            return null;
        }

        const pubDate = new Date(item.time * 1000);
        const comments = item.kids ? fetchCommentsForStory(item.kids) : [];

        return {
            title: item.title,
            link: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
            pubDate: pubDate.toISOString(),
            description: item.text || item.title,
            comments
        };
    } catch (error: any) {
        console.error(`Error processing story ID ${storyId}: ${error.message || error.toString()}`);
        return null;
    }
};

/**
 * Fetches news from Hacker News.
 * @returns Array of news articles from Hacker News.
 */
export const fetchHackerNews = (): NewsArticle[] => {
    try {
        const topStoriesUrl = "https://hacker-news.firebaseio.com/v0/topstories.json";
        console.log("Fetching Hacker News top story IDs...");

        const idResponse = UrlFetchApp.fetch(topStoriesUrl, { muteHttpExceptions: true });

        if (idResponse.getResponseCode() !== 200) {
            console.error(`Failed to fetch Hacker News story IDs. Status: ${idResponse.getResponseCode()}`);
            return [];
        }

        const storyIds = JSON.parse(idResponse.getContentText()) as number[];

        if (!storyIds?.length) {
            console.log("No story IDs received from Hacker News.");
            return [];
        }

        console.log(`Received ${storyIds.length} story IDs. Fetching details for recent stories...`);

        const targetStoryIds: number[] = storyIds.slice(0, 30);
        const articles: NewsArticle[] = [];

        for (const storyId of targetStoryIds) {
            if (articles.length >= 10) break;

            const article = fetchStoryDetails(storyId);
            if (article) articles.push(article);
        }

        console.log(`Found ${articles.length} recent articles from Hacker News.`);
        return articles;

    } catch (error: any) {
        console.error(`Critical error in fetchHackerNews: ${error.message || error.toString()}`);
        return [];
    }
};

/**
 * Fetches news from Hacker News
 * @returns Array of unique news articles from Hacker News
 */
export const fetchCompanyNews = (): NewsArticle[] => {
    console.log(`Fetching Hacker News articles...`);
    const articles = fetchHackerNews();

    const uniqueArticles = removeDuplicateArticles(articles);
    console.log(`Found ${uniqueArticles.length} unique news articles after deduplication`);

    return uniqueArticles;
};

/**
 * Remove duplicate articles based on title using functional approach
 * @param articles - Array of news articles that may contain duplicates
 * @returns Array of unique news articles
 */
export const removeDuplicateArticles = (articles: NewsArticle[]): NewsArticle[] => {
    const normalizeTitle = (title: string): string =>
        title.replace(/\s+/g, ' ').trim();

    const uniqueTitles = new Set<string>();

    return articles.filter(article => {
        const normalizedTitle = normalizeTitle(article.title);

        if (uniqueTitles.has(normalizedTitle)) return false;

        uniqueTitles.add(normalizedTitle);
        return true;
    });
};
