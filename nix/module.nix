# NixOS module for the hacker-news-summarizer service. Exported from the flake
# as `nixosModules.default`; consumers import it and only need to set
# `services.hacker-news-summarizer.enable = true` plus a few host-specific
# overrides (Cloudflare account, secret file paths, target channel) to get a
# running oneshot unit + timer.
#
# Secret handling mirrors the sibling paper-curator service: tokens are wired
# in via systemd `LoadCredential` and read by the binary through `*_FILE` env
# vars, so they never appear in `Environment=` (i.e. never in
# `/proc/<pid>/environ`).
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.hacker-news-summarizer;
in
{
  options.services.hacker-news-summarizer = {
    enable = lib.mkEnableOption "hacker-news-summarizer — Hacker News digest summarized via Cloudflare Workers AI and posted to Slack";

    package = lib.mkOption {
      type = lib.types.package;
      description = ''
        The hacker-news-summarizer package to run. The flake's
        `nixosModules.default` defaults this to the flake's own
        `packages.<system>.default`; override only to pin a different build.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "hacker-news-summarizer";
      description = "User to run hacker-news-summarizer as.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "hacker-news-summarizer";
      description = "Group to run hacker-news-summarizer as.";
    };

    # -----------------------------------------------------------------
    # Article selection
    # -----------------------------------------------------------------

    articleCount = lib.mkOption {
      type = lib.types.ints.between 1 30;
      default = 3;
      description = ''
        Number of fresh (not-yet-posted) top stories to summarize and post
        per run. The fetcher walks the Hacker News top-stories list, skipping
        any id already recorded in the local SQLite dedup store, until it has
        collected this many.
      '';
    };

    slackUsername = lib.mkOption {
      type = lib.types.str;
      default = "Hacker News Summarizer";
      description = "Display username for the posted Slack messages.";
    };

    # -----------------------------------------------------------------
    # Cloudflare Workers AI (summarizer)
    # -----------------------------------------------------------------

    cloudflare = {
      accountId = lib.mkOption {
        type = lib.types.str;
        description = ''
          Cloudflare account ID. Not a secret on its own; combined with
          `apiTokenFile` below to authorise the OpenAI-compatible
          `/ai/v1/chat/completions` endpoint.
        '';
      };

      apiTokenFile = lib.mkOption {
        type = lib.types.path;
        example = lib.literalExpression "config.sops.secrets.\"hacker-news-summarizer-cloudflare-api-token\".path";
        description = ''
          Path to a file whose contents are the Cloudflare API token for
          Workers AI. Typically wired from sops. The token never enters
          `Environment=` — only the path the systemd credential is exposed at
          does (`CLOUDFLARE_API_TOKEN_FILE`).
        '';
      };

      model = lib.mkOption {
        type = lib.types.str;
        default = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
        description = ''
          Cloudflare Workers AI chat model used to generate the Japanese
          summary + discussion points for each story. Needs reliable
          Japanese instruction-following.
        '';
      };

      timeoutSec = lib.mkOption {
        type = lib.types.ints.positive;
        default = 300;
        description = ''
          Per-HTTP-call timeout for a single summarizer Cloudflare Workers AI
          request.
        '';
      };
    };

    # -----------------------------------------------------------------
    # Slack
    # -----------------------------------------------------------------

    slack = {
      channel = lib.mkOption {
        type = lib.types.str;
        default = "#general";
        description = ''
          Slack channel ID or `#channel-name` to post summaries into. Using a
          channel ID (CXXXXXXX) is more robust than a name since rename events
          don't break the unit.
        '';
      };

      botTokenFile = lib.mkOption {
        type = lib.types.path;
        example = lib.literalExpression "config.sops.secrets.\"hacker-news-summarizer-slack-bot-token\".path";
        description = ''
          Path to a file containing the Slack bot user OAuth token (`xoxb-…`).
          Wired via `LoadCredential`, read by the bot as a file path
          (`SLACK_BOT_TOKEN_FILE`).
        '';
      };
    };

    # -----------------------------------------------------------------
    # Scheduling
    # -----------------------------------------------------------------

    onCalendar = lib.mkOption {
      type = lib.types.str;
      default = "*-*-* 0/6:17:00";
      description = ''
        systemd `OnCalendar=` for the run cadence. Default fires every 6 hours
        (00:17, 06:17, 12:17, 18:17 local time) — off the top-of-hour timer
        pile-up shared with sibling units. `Persistent=true` is set on the
        timer so a missed window is caught up after host downtime.
      '';
    };

    randomizedDelaySec = lib.mkOption {
      type = lib.types.str;
      default = "5m";
      description = ''
        systemd `RandomizedDelaySec=` for the timer. Spreads Cloudflare and
        Slack load across a small window so a host full of unrelated timers
        does not all fire at exactly the same second.
      '';
    };

    timeoutStartSec = lib.mkOption {
      type = lib.types.str;
      default = "30min";
      description = ''
        systemd `TimeoutStartSec=` for the oneshot. Sized to cover
        `articleCount` summarizer calls (each up to `cloudflare.timeoutSec`)
        plus the inter-post Slack delays, with margin. The happy path
        completes in a couple of minutes; the wide budget keeps systemd from
        killing a slow-but-healthy run mid-flight.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
    };
    users.groups.${cfg.group} = { };

    systemd.services.hacker-news-summarizer = {
      description = "hacker-news-summarizer — Hacker News digest summarized via Cloudflare Workers AI and posted to Slack";
      # `wantedBy` is intentionally absent: the timer below is the only thing
      # that should start this unit. A manual run is still possible via
      # `systemctl start hacker-news-summarizer.service`.

      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        # Article selection.
        ARTICLE_COUNT = toString cfg.articleCount;
        SLACK_USERNAME = cfg.slackUsername;

        # Cloudflare Workers AI.
        CLOUDFLARE_ACCOUNT_ID = cfg.cloudflare.accountId;
        CLOUDFLARE_MODEL = cfg.cloudflare.model;
        CLOUDFLARE_TIMEOUT_SECS = toString cfg.cloudflare.timeoutSec;
        # _FILE variant: bot reads the path's contents at startup, so the
        # secret never enters this Environment block.
        CLOUDFLARE_API_TOKEN_FILE = "%d/cloudflare-api-token";

        # Slack.
        SLACK_CHANNEL = cfg.slack.channel;
        SLACK_BOT_TOKEN_FILE = "%d/slack-bot-token";

        TZ = "Asia/Tokyo";
        RUST_LOG = "info";
      };

      serviceConfig = {
        Type = "oneshot";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = lib.getExe cfg.package;

        # systemd writes the credential files into $CREDENTIALS_DIRECTORY
        # (mode 0400, owned by User). The binary resolves them via the
        # `*_FILE` env vars above.
        LoadCredential = [
          "cloudflare-api-token:${toString cfg.cloudflare.apiTokenFile}"
          "slack-bot-token:${toString cfg.slack.botTokenFile}"
        ];

        # SQLite dedup store at /var/lib/hacker-news-summarizer/state.db. The
        # binary derives this path from `STATE_DIRECTORY` (set by systemd).
        StateDirectory = "hacker-news-summarizer";
        StateDirectoryMode = "0750";

        TimeoutStartSec = cfg.timeoutStartSec;
        UMask = "0077";

        # -- Hardening --
        # The bot only makes outbound HTTPS (Hacker News, Cloudflare, Slack)
        # and reads/writes a local SQLite file. No subprocess interpreters or
        # JITs, so the strong filter set is safe.
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        PrivateIPC = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        ProtectProc = "invisible";
        ProcSubset = "pid";
        RestrictSUIDSGID = true;
        RestrictRealtime = true;
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        CapabilityBoundingSet = "";
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
          "~@resources"
        ];
      };
    };

    systemd.timers.hacker-news-summarizer = {
      description = "hacker-news-summarizer schedule";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.onCalendar;
        Persistent = true;
        RandomizedDelaySec = cfg.randomizedDelaySec;
        Unit = "hacker-news-summarizer.service";
      };
    };
  };
}
