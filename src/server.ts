import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RunhooksClient, publicRequest, ApiError } from './client.js';
import { readStoredConfig, writeStoredConfig, getConfigPath } from './config.js';
import {
  createJobSchema,
  updateJobSchema,
  type CreateJobInput,
  type UpdateJobInput,
  type CreateAlertConfigInput,
  type UpdateAlertConfigInput,
  type User,
} from './api-contract.js';

const DEFAULT_API_URL = 'https://api.runhooks.app';
// Single source of truth for the version: package.json. Read at runtime so the
// number is never duplicated here. The path resolves to the package root both in
// dev (tsx src/index.ts) and when bundled (dist/index.js) — each sits one level
// under the package root — and package.json always ships in the npm tarball.
// (server.json carries its own copy because the MCP Registry schema requires an
// explicit version; scripts/sync-version.mjs keeps it in step with package.json.)
const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

export function createServer(): McpServer {
  // Resolve credentials once at startup: env vars win, then any key persisted
  // by a previous provision (or by the CLI). Both live in `let` bindings so a
  // key provisioned or rotated mid-session takes effect on the very next tool
  // call — the key is never re-captured per request, but it IS mutable.
  const stored = readStoredConfig();
  const apiUrl = (process.env.RUNHOOKS_API_URL || stored?.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  let apiKey = process.env.RUNHOOKS_API_KEY || stored?.apiKey || '';
  // An env-supplied key lives in the client's MCP config, which we cannot
  // rewrite; a file-supplied (or freshly provisioned) key we own. This governs
  // whether rotation persists silently or has to warn the user.
  let keyFromEnv = Boolean(process.env.RUNHOOKS_API_KEY);

  const server = new McpServer({ name: 'runhooks', version: VERSION });

  // Authenticated client; throws a helpful error if no key is configured.
  function client(): RunhooksClient {
    if (!apiKey) {
      throw new ApiError(
        'No Runhooks API key configured. If you already have an account, set its key as RUNHOOKS_API_KEY in this MCP server\'s config. Otherwise call "provision_account" ONCE — it creates an account and saves the key locally, so every later tool works without re-provisioning. Do NOT call provision_account again to recover from an auth error; it only makes duplicate accounts.',
        401,
      );
    }
    return new RunhooksClient({ apiUrl, apiKey });
  }

  // Adopt a new key for the rest of this session and persist it so restarts
  // (and the CLI) reuse the same account instead of creating another.
  function adoptKey(newKey: string): void {
    apiKey = newKey;
    keyFromEnv = false;
    writeStoredConfig({ apiUrl, apiKey: newKey });
  }

  // ── Account ──────────────────────────────────────────────
  server.tool(
    'provision_account',
    'Create a new anonymous Runhooks account (no email required) and save its API key locally for reuse. Idempotent: if this server already has a key (from RUNHOOKS_API_KEY or a previous provision), it returns the EXISTING account instead of creating a duplicate. Call this at most once — never to recover from an auth error.',
    { name: z.string().optional().describe('Optional display name for the account') },
    async ({ name }) => run(async () => {
      // Already authenticated → return the existing account, never a new one.
      if (apiKey) {
        const account = await client().getMe();
        return {
          reused: true,
          message:
            'This MCP server already has an account configured, so no new account was created. ' +
            'To use a different account, set a different RUNHOOKS_API_KEY in the server config.',
          account,
        };
      }
      const result = await publicRequest<{ user: User; apiKey: string }>(
        apiUrl,
        '/auth/register-anonymous',
        { method: 'POST', body: JSON.stringify(name ? { name } : {}) },
      );
      adoptKey(result.apiKey);
      return {
        created: true,
        message:
          `Account created and the API key was saved to ${getConfigPath()}. ` +
          'It is active for every tool right now — no restart needed, and no need to call provision_account again. ' +
          'For portability across machines you may also set this key as RUNHOOKS_API_KEY in the server config.',
        ...result,
      };
    }),
  );

  server.tool(
    'whoami',
    'Show the currently authenticated Runhooks account (name, plan, API key prefix).',
    {},
    async () => run(() => client().getMe()),
  );

  server.tool(
    'rotate_key',
    'Rotate the API key. The old key stops working immediately; the new key is returned, saved locally, and used for the rest of this session.',
    {},
    async () => run(async () => {
      const result = await client().rotateApiKey();
      if (keyFromEnv) {
        // We can't edit the client's RUNHOOKS_API_KEY; keep the session alive
        // on the new key but make the stale-config risk explicit.
        apiKey = result.apiKey;
        return {
          ...result,
          warning:
            'The rotated key is active for this session, but your key was supplied via RUNHOOKS_API_KEY, ' +
            'which this server cannot edit. Update RUNHOOKS_API_KEY to the new key (the old one no longer works) ' +
            'or the next restart will fail to authenticate.',
        };
      }
      adoptKey(result.apiKey);
      return { ...result, message: `New key saved to ${getConfigPath()}.` };
    }),
  );

  // ── Jobs ─────────────────────────────────────────────────
  server.tool(
    'create_job',
    'Create a new scheduled job — an HTTP request fired on a schedule. The schedule.type is one of: ' +
      '"cron" (schedule.expression is a cron string, e.g. "0 9 * * 1,4" for every Monday & Thursday at ' +
      '09:00 — build/preview expressions at https://runhooks.app/tools/cron-expression-builder; optional IANA schedule.timezone), ' +
      '"interval" (schedule.expression is the number of milliseconds between runs, as a string), or ' +
      '"once" for a single future run (schedule.expression is an ISO-8601 date-time — either an absolute ' +
      'instant like "2026-12-25T14:00:00Z"/with offset, or a naive wall-clock time like "2026-12-25T09:00:00" ' +
      'interpreted in schedule.timezone, defaulting to UTC; the time must be in the future). One-off jobs ' +
      'support the same retries, alerts and logs as recurring jobs.',
    createJobSchema.shape,
    async (args) => run(() => client().createJob(args as CreateJobInput)),
  );

  server.tool(
    'list_jobs',
    'List your scheduled jobs with optional filters and pagination.',
    {
      status: z.enum(['active', 'paused', 'completed', 'failed']).optional(),
      tag: z.string().optional(),
      name: z.string().optional().describe('Filter by name (regex)'),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async (args) => run(() => client().listJobs(args)),
  );

  server.tool(
    'get_job',
    'Get a single job by its ID.',
    { id: z.string() },
    async ({ id }) => run(() => client().getJob(id)),
  );

  server.tool(
    'update_job',
    'Update an existing job. Only the fields you provide are changed.',
    { id: z.string(), ...updateJobSchema.shape },
    async ({ id, ...input }) => run(() => client().updateJob(id, input as UpdateJobInput)),
  );

  server.tool(
    'delete_job',
    'Delete a job permanently.',
    { id: z.string() },
    async ({ id }) => run(async () => {
      await client().deleteJob(id);
      return { deleted: id };
    }),
  );

  server.tool(
    'pause_job',
    'Pause a job — it stops executing until resumed.',
    { id: z.string() },
    async ({ id }) => run(() => client().updateJob(id, { status: 'paused' } as UpdateJobInput)),
  );

  server.tool(
    'resume_job',
    'Resume a paused job.',
    { id: z.string() },
    async ({ id }) => run(() => client().updateJob(id, { status: 'active' } as UpdateJobInput)),
  );

  // ── Executions ───────────────────────────────────────────
  server.tool(
    'list_executions',
    'List recent executions (run history) for a job.',
    {
      jobId: z.string(),
      status: z.enum(['success', 'failed', 'timeout', 'running', 'pending', 'dead_letter', 'quota_exceeded']).optional(),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ jobId, ...query }) => run(() => client().getJobExecutions(jobId, query)),
  );

  server.tool(
    'replay_execution',
    'Re-run a past execution immediately.',
    { executionId: z.string() },
    async ({ executionId }) => run(async () => {
      await client().replayExecution(executionId);
      return { replayed: executionId };
    }),
  );

  // ── Usage ────────────────────────────────────────────────
  server.tool(
    'get_usage',
    'Show the current plan usage and limits for the account.',
    {},
    async () => run(() => client().getMyUsage()),
  );

  // ── Alerts ───────────────────────────────────────────────
  // Alert schemas use .refine() (no `.shape`), so the input shapes are inline.
  // The server still enforces the full channel/target validation.
  server.tool(
    'list_alerts',
    'List your failure-alert configurations.',
    {},
    async () => run(() => client().listAlerts()),
  );

  server.tool(
    'create_alert',
    'Create a failure alert. Fires when a job dead-letters. Channel is email, webhook, or slack.',
    {
      name: z.string().min(1).max(100),
      channel: z.enum(['email', 'webhook', 'slack']),
      target: z.string().min(1).max(500).describe('Email address, webhook URL, or Slack webhook URL'),
      jobId: z.string().nullable().optional().describe('Scope to one job; omit for all jobs'),
      consecutiveFailuresThreshold: z.number().int().min(1).max(100).optional(),
      cooldownMinutes: z.number().int().min(0).max(10_080).optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => run(() => client().createAlert(args as CreateAlertConfigInput)),
  );

  server.tool(
    'get_alert',
    'Get a single alert configuration by its ID.',
    { id: z.string() },
    async ({ id }) => run(() => client().getAlert(id)),
  );

  server.tool(
    'update_alert',
    'Update an alert configuration. Only the fields you provide are changed.',
    {
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      channel: z.enum(['email', 'webhook', 'slack']).optional(),
      target: z.string().min(1).max(500).optional(),
      jobId: z.string().nullable().optional(),
      consecutiveFailuresThreshold: z.number().int().min(1).max(100).optional(),
      cooldownMinutes: z.number().int().min(0).max(10_080).optional(),
      enabled: z.boolean().optional(),
    },
    async ({ id, ...input }) => run(() => client().updateAlert(id, input as UpdateAlertConfigInput)),
  );

  server.tool(
    'delete_alert',
    'Delete an alert configuration.',
    { id: z.string() },
    async ({ id }) => run(async () => {
      await client().deleteAlert(id);
      return { deleted: id };
    }),
  );

  return server;
}
