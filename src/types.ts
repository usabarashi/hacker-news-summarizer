/**
 * @fileoverview Type definitions for the Hacker News Summarizer
 * @description Contains TypeScript interfaces and types used across the application
 * for type safety and better development experience.
 */

export interface NewsArticle {
    title: string
    link: string
    pubDate: string
    description: string
    comments?: string[]
    contentBody?: string
    hackerNewsId: number
    score?: number
    author?: string
    commentCount?: number
    formattedDate?: string
    articleType?: string
}
