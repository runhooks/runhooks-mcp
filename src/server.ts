import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RunhooksClient, publicRequest, ApiError } from './client.js';
import {
  createJobSchema,
  updateJobSchema,
  type CreateJobInput,
  type UpdateJobInput,
  type CreateAlertConfigInput,
  type UpdateAlertConfigInput,
} from './api-contract.js';

const DEFAULT_API_URL = 'https://api.runhooks.app';
const VERSION = '0.1.2';

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
  const apiUrl = (process.env.RUNHOOKS_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
  const apiKey = process.env.RUNHOOKS_API_KEY || '';

  const server = new McpServer({ name: 'runhooks', version: VERSION });

  // Authenticated client; throws a helpful error if no key is configured.
  function client(): RunhooksClient {
    if (!apiKey) {
      throw new ApiError(
        'No RUNHOOKS_API_KEY set. Run the "provision_account" tool to create an instant account (no email required), then set the returned apiKey as RUNHOOKS_API_KEY in your MCP client config.',
        401,
      );
    }
    return new RunhooksClient({ apiUrl, apiKey });
  }

  // ── Account ──────────────────────────────────────────────
  server.tool(
    'provision_account',
    'Create a new anonymous Runhooks account (no email required) and return an API key. Save the returned apiKey and set it as RUNHOOKS_API_KEY to use every other tool.',
    { name: z.string().optional().describe('Optional display name for the account') },
    async ({ name }) => run(() =>
      publicRequest(apiUrl, '/auth/register-anonymous', {
        method: 'POST',
        body: JSON.stringify(name ? { name } : {}),
      }),
    ),
  );

  server.tool(
    'whoami',
    'Show the currently authenticated Runhooks account (name, plan, API key prefix).',
    {},
    async () => run(() => client().getMe()),
  );

  server.tool(
    'rotate_key',
    'Rotate the API key. The old key stops working immediately; the new key is returned.',
    {},
    async () => run(() => client().rotateApiKey()),
  );

  // ── Jobs ─────────────────────────────────────────────────
  server.tool(
    'create_job',
    'Create a new scheduled job — an HTTP request fired on a cron or interval schedule.',
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
