/**
 * @fileoverview Hacker News API integration module
 * @description Fetches top stories and comments from the Hacker News API,
 * processes article data, and filters out deleted or invalid content.
 */

import { NewsArticle } from "./types"

const MAX_STORY_IDS_TO_PROCESS = 30
const DEFAULT_MAX_COMMENTS = 10

interface HackerNewsItem {
    id: number
    title: string
    url?: string
    text?: string
    time: number
    kids?: number[]
    deleted?: boolean
    dead?: boolean
}

interface CommentData {
    text?: string
    deleted?: boolean
    dead?: boolean
}

/**
 * Fetches a single comment from Hacker News API
 * @param commentId - The ID of the comment to fetch
 * @returns Comment text if successful, null if failed or comment is deleted/dead
 */
const fetchSingleComment = (commentId: number): string | null => {
    try {
        const commentUrl = `https://hacker-news.firebaseio.com/v0/item/${commentId}.json`
        const response = UrlFetchApp.fetch(commentUrl, { muteHttpExceptions: true })
        if (response.getResponseCode() !== 200) return null

        const commentData = JSON.parse(response.getContentText()) as CommentData
        return (commentData?.text && !commentData.deleted && !commentData.dead)
            ? commentData.text
            : null
    } catch (error: any) {
        console.warn(`Error fetching comment ID ${commentId}: ${error.message || error.toString()}`)
        return null
    }
}

/**
 * Fetches comments for a story using functional approach
 * @param commentIds - Array of comment IDs
 * @param maxComments - Maximum number of comments to fetch (default: 10)
 * @returns Array of valid comment texts, filtered from deleted/dead comments
 */
const fetchCommentsForStory = (commentIds: number[], maxComments: number = DEFAULT_MAX_COMMENTS): string[] => {
    const candidateIds: number[] = commentIds.slice(0, maxComments * 2)
    const comments: string[] = []
    for (const commentId of candidateIds) {
        if (comments.length >= maxComments) break
        const commentText = fetchSingleComment(commentId)
        if (commentText) comments.push(commentText)
    }

    return comments
}

/**
 * Fetches a single story item from Hacker News API
 * @param storyId - The ID of the story to fetch
 * @returns NewsArticle object if successful, null if failed or story is invalid
 */
const fetchStoryDetails = (storyId: number): NewsArticle | null => {
    try {
        const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`
        const response = UrlFetchApp.fetch(itemUrl, { muteHttpExceptions: true })
        if (response.getResponseCode() !== 200) {
            console.warn(`Failed to fetch details for story ID ${storyId}. Status: ${response.getResponseCode()}`)
            return null
        }

        const item = JSON.parse(response.getContentText()) as HackerNewsItem
        if (!item?.time || !item.title) {
            console.warn(`Story ID ${storyId} has missing critical data (time or title)`)
            return null
        }

        const pubDate = new Date(item.time * 1000)
        const comments = item.kids ? fetchCommentsForStory(item.kids) : []
        return {
            title: item.title,
            link: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
            pubDate: pubDate.toISOString(),
            description: item.text || item.title,
            comments,
            hackerNewsId: item.id
        }
    } catch (error: any) {
        console.error(`Error processing story ID ${storyId}: ${error.message || error.toString()}`)
        return null
    }
}

/**
 * Fetches news from Hacker News.
 * @param limit - Maximum number of articles to fetch (default: 10)
 * @returns Array of news articles from Hacker News.
 */
export const fetchHackerNews = (limit: number = 10): NewsArticle[] => {
    try {
        const topStoriesUrl = "https://hacker-news.firebaseio.com/v0/topstories.json"
        console.log("Fetching Hacker News top story IDs...")

        const idResponse = UrlFetchApp.fetch(topStoriesUrl, { muteHttpExceptions: true })
        if (idResponse.getResponseCode() !== 200) {
            console.error(`Failed to fetch Hacker News story IDs. Status: ${idResponse.getResponseCode()}`)
            return []
        }

        const storyIds = JSON.parse(idResponse.getContentText()) as number[]
        if (!storyIds?.length) {
            console.log("No story IDs received from Hacker News.")
            return []
        }

        console.log(`Received ${storyIds.length} story IDs. Fetching details for recent stories...`)
        const targetStoryIds: number[] = storyIds.slice(0, MAX_STORY_IDS_TO_PROCESS)
        const articles: NewsArticle[] = []
        for (const storyId of targetStoryIds) {
            if (articles.length >= limit) break
            const article = fetchStoryDetails(storyId)
            if (article) articles.push(article)
        }

        console.log(`Found ${articles.length} recent articles from Hacker News.`)
        return articles
    } catch (error: any) {
        console.error(`Critical error in fetchHackerNews: ${error.message || error.toString()}`)
        return []
    }
}

/**
 * Generates a Hacker News discussion link for an article
 * @param article - News article with Hacker News ID
 * @returns Hacker News discussion URL
 */
export const getHackerNewsLink = (article: NewsArticle): string => {
    return `https://news.ycombinator.com/item?id=${article.hackerNewsId}`
}
