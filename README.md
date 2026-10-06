# @runhooks/mcp

Model Context Protocol (MCP) server for [Runhooks](https://runhooks.app) — reliable HTTP
scheduling infrastructure. It lets AI agents (Claude Desktop, Cursor, and any MCP client)
schedule and manage cron jobs and webhooks directly.

The server runs **locally** on your machine: your MCP client spawns it with `npx` and it talks
to the Runhooks REST API over HTTPS. There is no hosted service — just this package.

## Install

Add it to your MCP client config. For Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "runhooks": {
      "command": "npx",
      "args": ["-y", "@runhooks/mcp"],
      "env": { "RUNHOOKS_API_KEY": "rh_live_..." }
    }
  }
}
```

No API key yet? Leave `env` out and ask the agent to run the **`provision_account`** tool — it
creates an instant account (no email) and returns an `rh_live_...` key. Save that key as
`RUNHOOKS_API_KEY` and restart your client.

## Verify

Check the server starts and advertises its tools (replace the key, or omit `env` and use
`provision_account` from inside your client):

```bash
RUNHOOKS_API_KEY=rh_live_... npx -y @runhooks/mcp
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `RUNHOOKS_API_KEY` | Your API key (`rh_live_...`). Required for all tools except `provision_account`. | — |
| `RUNHOOKS_API_URL` | API origin. | `https://api.runhooks.app` |

## Tools

| Tool | Description |
|---|---|
| `provision_account` | Create an anonymous account and get an API key (no email). |
| `whoami` | Show the current account. |
| `rotate_key` | Rotate the API key. |
| `create_job` | Create a scheduled job (cron or interval). |
| `list_jobs` | List jobs with filters and pagination. |
| `get_job` | Get one job by ID. |
| `update_job` | Update a job. |
| `delete_job` | Delete a job. |
| `pause_job` / `resume_job` | Pause or resume a job. |
| `list_executions` | List a job's run history. |
| `replay_execution` | Re-run a past execution. |
| `get_usage` | Show plan usage and limits. |
| `list_alerts` / `create_alert` / `get_alert` / `update_alert` / `delete_alert` | Manage failure alerts (email, webhook, Slack). |

## Links

- Documentation: https://runhooks.app/docs/mcp
- API reference: https://runhooks.app/docs/api
- CLI: https://www.npmjs.com/package/@runhooks/cli

## License

MIT
