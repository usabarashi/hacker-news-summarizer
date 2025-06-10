# Hacker News

Posts the results of Gemini prompts to Slack.

# Setup

## 1. Build a development environment

```sh
nix develop
npm install
npx clasp login
npx clasp create --type standalone --title "Hacker News"

npx clasp clone <PROJECT_ID>
npx clasp pull
```

## 2. Setting up a GAS project

### Triggers

Set up the scheduled execution as follows:

1. Choose which function to run: `main`
1. Which runs at deployment: `Head`
1. Select event source: `Time-driven`
1. Select type of time-based trigger: `Minute timer`
1. Select minute interval: `Every minute`
1. Failure notification settings: `Notify me daily`

#### Script Properties

Set the following properties:

| Property         | Note                                      |
| :-------------- | :--------------------------------------- |
| GEMINI_API_KEY  | Set the authentication key for the Gemini API. |
| SLACK_BOT_TOKEN | Set the Slack Bot User OAuth Token.       |
| SLACK_CHANNEL_ID| Set the ID of the Slack channel where messages will be posted. |

## 3. Build and Deploy
//
```console
npm run build
npx clasp push
```

# References

- [Apps Script](https://developers.google.com/apps-script)
- [Google News](https://news.google.com/)
- [Google AI for Developers](https://ai.google.dev/)
- [js-genai](https://github.com/googleapis/js-genai)
- [Slack API Your Apps](https://api.slack.com/apps)
