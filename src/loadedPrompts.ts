// This file is auto-generated by build.ts. Do not edit directly.
// Loaded from: src/prompts.yaml
// WARNING: Any manual changes to this file will be overwritten on next build!

interface PromptTemplate {
  outputFormatInstruction: string;
  mainPromptTemplate: string;
}

interface PromptsConfig {
  singleArticleSummary: PromptTemplate;
}

export const PROMPTS: PromptsConfig = {
  "singleArticleSummary": {
    "outputFormatInstruction": "# AI要約生成指示\n\nあなたは、提供されたHacker Newsの記事情報から**要約と議論のポイントのみ**を\n日本語で生成するAIです。\n\n**出力形式:**\n記事の核心を捉えた簡潔な日本語の要約（2-3文程度、150文字以内厳守）を出力してください。\n\n**コメントがある場合のみ追加:**\n改行後に「主な議論ポイント:」として代表的なコメントや議論のポイントを1-2点、\n箇条書きで記述してください（各ポイントは1文程度、75文字以内）。\n\n**マークダウンの使用:**\n- 太字: \\`*テキスト*\\`\n- イタリック: \\`_テキスト_\\` (必要に応じて)\n- リスト: 行頭に \\`•\\` を使用。\n\n**出力例:**\n新技術Xは、これまでの問題を解決する画期的なアプローチを採用しており、\n特にパフォーマンス面で注目されています。\n初期のレビューでは肯定的な評価が多いです。\n\n*主な議論ポイント:*\n• これは本当にゲームチェンジャーになる可能性があるとの声が多数あります。\n• 一方で、セキュリティ面での懸念や既存システムとの互換性についての指摘もいくつか見られます。\n",
    "mainPromptTemplate": "以下のHacker Newsの記事情報を分析してください。\n\n${articleInfoForContext}\n\n上記の「AI要約生成指示」に従って、記事の要約と議論のポイントのみを生成してください。\n\n重要なガイドライン:\n- **要約:** 記事の核心を捉えた簡潔な日本語で、*2-3文程度、150文字以内*にしてください。\n- **議論ポイント:** 上記の「主なコメント」セクションを参考に、\n  代表的なものを*1-2点*、箇条書きで記述してください。\n  各ポイントは*1文程度、75文字以内*としてください。\n  コメント情報がない場合は、このセクションは省略してください。\n- **言語:** 全て日本語で記述してください。\n- **フォーマット:** 要約テキストのみを出力してください。\n  追加のヘッダーや挨拶、前置き、後書きは一切不要です。\n"
  }
};
