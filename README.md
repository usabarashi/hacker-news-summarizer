# Hacker News Summarizer

A Google Apps Script application that fetches top Hacker News articles, generates AI summaries, and posts them to Slack.

## Features

- 🔥 **Hacker News Integration**: Fetches top stories from Hacker News API
- 🤖 **AI Summarization**: Uses Gemini AI to generate concise Japanese summaries
- 💬 **Slack Integration**: Posts formatted summaries with article titles and discussion links

# Setup

## 1. Development Environment

### Prerequisites

- Node.js (managed via Nix)
- TypeScript (included in dev dependencies)
- Google Apps Script CLI (clasp)
- Google Cloud Project with Gemini API access
- Slack workspace with bot permissions

### Environment Setup

```sh
# Using Nix (recommended)
nix develop

# Install dependencies
npm install

# Setup Google Apps Script CLI (first time only)
npx clasp login
npx clasp create --type standalone --title "Hacker News Summarizer"

# Clone existing project (optional)
npx clasp clone <PROJECT_ID>
npx clasp pull
```

### clasp.json Configuration

**Note**: `clasp.json` is excluded from git as it contains project-specific settings.

After setting up your Google Apps Script project, create a `clasp.json` file in the project root:

```json
{
  "scriptId": "your-google-apps-script-project-id",
  "rootDir": "./dist"
}
```

**How to find your Script ID**:
1. Open your Google Apps Script project in the web editor
2. Click ⚙️ **Project Settings** in the left sidebar
3. Copy the **Script ID** from the IDs section
4. Paste it into your `clasp.json` file

**Alternative**: Use `npx clasp create` or `npx clasp clone <PROJECT_ID>` to automatically generate this file.

## 2. Google Apps Script Configuration

### Script Properties

Configure the following properties in Google Apps Script:

| Property         | Description                               | Required | Default |
| :-------------- | :--------------------------------------- | :------: | :------ |
| GEMINI_API_KEY  | Gemini AI API authentication key         | ✅       | -       |
| GEMINI_MODEL    | Gemini model name                        | ✅       | -       |
| SLACK_BOT_TOKEN | Slack Bot User OAuth Token               | ✅       | -       |
| SLACK_CHANNEL_ID| Target Slack channel ID                  | ✅       | -       |
| ARTICLE_COUNT   | Number of articles to process            | ❌       | 3       |

### Triggers Setup

Set up automated execution:

1. **Function to run**: `main` (for both time-driven and manual execution)
2. **Deployment**: Head
3. **Event source**: Time-driven
4. **Trigger type**:
   - Hour timer (recommended for production)
   - Minute timer (for testing only)
5. **Interval**: Every 6 hours (recommended)
6. **Failure notifications**: Daily

### API Permissions

Required OAuth scopes (automatically configured):
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.scriptapp`

## 3. Build and Deploy

```console
# Build the project (type check + compile + bundle for Google Apps Script)
npm run build

# Deploy to Google Apps Script
npx clasp push

# Create a new deployment (optional)
npx clasp deploy --description "Hacker News Summarizer v1.0"
```

## Usage

### Manual Execution

```javascript
// In Google Apps Script editor
main()  // Returns: "X summaries posted."
```

### Automated Execution

Set up time-driven triggers in the Google Apps Script editor:
1. Go to **Triggers** (⏰) in the left sidebar
2. Click **+ Add Trigger**
3. Choose function: `main`
4. Choose event source: **Time-driven**
5. Choose type: **Hour timer** or **Day timer**
6. Choose interval as needed (e.g., Every 6 hours)

### Entry Points

- `main()`: Main processing function (synchronous)
  - Returns: String with number of summaries posted
  - Usage: Direct execution in GAS editor or via triggers

## Configuration

### Rate Limiting

- **Gemini API**: 1000ms delay between requests
- **Slack API**: 2000ms delay between posts
- Configurable via `withRateLimit()` higher-order function

### Article Processing

- **Default count**: 3 articles (configurable via `ARTICLE_COUNT`)
- **Source**: Top 30 Hacker News stories
- **Filtering**: Auto-filters deleted/dead articles
- **Comments**: Up to 10 comments per article

### AI Prompts

Prompts are externalized in `src/prompts.yaml`:
- Japanese output format
- Structured summary format
- Configurable without code changes

## Development

### Build Process

1. **YAML Processing**: Converts `prompts.yaml` to TypeScript with strict type definitions
2. **TypeScript Type Checking**: Validates all code with strict compiler settings
3. **esbuild Bundling**: Single file output for Google Apps Script
4. **Manifest Copy**: Copies Apps Script manifest to dist

Generated files:
- `src/loadedPrompts.ts`: Auto-generated from YAML with typed interfaces

# API Integrations

## Hacker News API

- **Endpoint**: `https://hacker-news.firebaseio.com/v0/`
- **Rate Limit**: No official limit (built-in delays for safety)
- **Data**: Top stories, article details, comments

## Gemini AI

### Model Selection
- **Configuration**: Model name is configurable in script properties
- **Selection Criteria**: Choose based on cost, performance, and feature requirements
- **Model Types**: Flash models for speed/cost, Pro models for complex reasoning

### API Integration
- **Rate Limiting**: Configurable delays between requests (default: 1000ms)
- **Input Processing**: Article content + comments formatted for AI analysis
- **Output Generation**: Japanese summaries with structured formatting
- **Error Handling**: Automatic retry logic with exponential backoff

### Resources & Documentation
- **Available Models**: [Model Catalog](https://ai.google.dev/gemini-api/docs/models)
- **API Reference**: [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- **Pricing Information**: [Current Rates](https://ai.google.dev/pricing)
- **Best Practices**: [Usage Guidelines](https://ai.google.dev/gemini-api/docs/get-started)

## Slack API

- **Method**: `chat.postMessage`
- **Format**: Rich attachments with titles and links
- **Rate Limit**: ~1 message per second

# References

- [Nix Package Manager](https://nixos.org/)
- [Google Apps Script](https://developers.google.com/apps-script)
- [esbuild](https://esbuild.github.io/)
- [Hacker News API](https://github.com/HackerNews/API)
- [Gemini AI API](https://ai.google.dev/)
- [Slack API](https://api.slack.com/apps)
