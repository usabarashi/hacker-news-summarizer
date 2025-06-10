export interface NewsArticle {
    title: string;
    link: string;
    pubDate: string;
    description: string;
    comments?: string[];
    contentBody?: string; // Added to store fetched article content
}
