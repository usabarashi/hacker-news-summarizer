/**
 * @fileoverview Hacker News API integration module
 * @description Fetches top stories and comments from the Hacker News API,
 * processes article data, and filters out deleted or invalid content.
 */

import { NewsArticle } from "./types"

const MAX_STORY_IDS_TO_PROCESS = 30
const DEFAULT_MAX_COMMENTS = 10

/**
 * Formats a Date object to Japanese date format (YYYY年MM月DD日)
 * @param date - Date object to format
 * @returns Formatted Japanese date string
 */
const formatJapaneseDate = (date: Date): string => {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}年${month.toString().padStart(2, '0')}月${day.toString().padStart(2, '0')}日`
}

/**
 * Detects article type from title
 * @param title - Article title
 * @returns Article type string
 */
const detectArticleType = (title: string): string => {
    const titleLower = title.toLowerCase()
    if (titleLower.startsWith('show hn:')) return 'Show HN'
    if (titleLower.startsWith('ask hn:')) return 'Ask HN'
    if (titleLower.startsWith('tell hn:')) return 'Tell HN'
    if (titleLower.includes('hiring') || titleLower.includes('freelancer')) return 'Job'
    return 'Story'
}

interface HackerNewsItem {
    id: number
    deleted?: boolean
    type?: string
    by?: string
    time: number
    text?: string
    dead?: boolean
    parent?: number
    kids?: number[]
    url?: string
    score?: number
    title?: string
    descendants?: number
}

interface CommentData {
    text?: string
    deleted?: boolean
    dead?: boolean
}

/**
 * Fetches a single comment from Hacker News API
 * @param commentId - The ID of the comment to fetch
 * @returns Object with success boolean; if successful, includes comment text
 */
const fetchSingleComment = (commentId: number): { success: true; text: string } | { success: false } => {
    try {
        const commentUrl = `https://hacker-news.firebaseio.com/v0/item/${commentId}.json`
        const response = UrlFetchApp.fetch(commentUrl, { muteHttpExceptions: true })
        if (response.getResponseCode() !== 200) return { success: false }

        const commentData = JSON.parse(response.getContentText()) as CommentData
        if (commentData?.text && !commentData.deleted && !commentData.dead) {
            return { success: true, text: commentData.text }
        }
        return { success: false }
    } catch (error: any) {
        console.warn(`Error fetching comment ID ${commentId}: ${error.message || error.toString()}`)
        return { success: false }
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
        const result = fetchSingleComment(commentId)
        if (result.success) comments.push(result.text)
    }

    return comments
}

/**
 * Fetches a single story item from Hacker News API
 * @param storyId - The ID of the story to fetch
 * @returns Object with success boolean; if successful, includes NewsArticle; if failed, includes error message
 */
const fetchStoryDetails = (storyId: number): { success: true; article: NewsArticle } | { success: false; error: string } => {
    try {
        const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`
        const response = UrlFetchApp.fetch(itemUrl, { muteHttpExceptions: true })
        if (response.getResponseCode() !== 200) {
            const error = `Failed to fetch details for story ID ${storyId}. Status: ${response.getResponseCode()}`
            console.warn(error)
            return { success: false, error }
        }

        const item = JSON.parse(response.getContentText()) as HackerNewsItem
        if (!item?.time || !item?.title) {
            const error = `Story ID ${storyId} has missing critical data (time or title)`
            console.warn(error)
            return { success: false, error }
        }

        const pubDate = new Date(item.time * 1000)
        const comments = item.kids ? fetchCommentsForStory(item.kids) : []
        const formattedDate = formatJapaneseDate(pubDate)
        const articleType = detectArticleType(item.title)
        const article: NewsArticle = {
            title: item.title,
            link: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
            pubDate: pubDate.toISOString(),
            description: item.text || item.title,
            comments,
            hackerNewsId: item.id,
            ...(item.score !== undefined && { score: item.score }),
            ...(item.by && { author: item.by }),
            commentCount: item.descendants || 0,
            formattedDate,
            articleType
        }
        return { success: true, article }
    } catch (error: any) {
        const errorMessage = `Error processing story ID ${storyId}: ${error.message || error.toString()}`
        console.error(errorMessage)
        return { success: false, error: errorMessage }
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
            const result = fetchStoryDetails(storyId)
            if (result.success) articles.push(result.article)
        }

        console.log(`Found ${articles.length} recent articles from Hacker News.`)
        return articles
    } catch (error: any) {
        console.error(`Critical error in fetchHackerNews: ${error.message || error.toString()}`)
        return []
    }
}

