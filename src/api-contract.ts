/**
 * Self-contained Runhooks API contract for the CLI.
 *
 * The CLI deliberately does NOT import the internal `@runhooks/shared` package:
 * that barrel also carries server-only constants (service ports, Redis channels,
 * auth rate limits, plan tables) that must never ship in a published client. This
 * file holds only the public API surface the CLI needs — the same contract already
 * documented in the public OpenAPI spec — so the published bundle and the public
 * mirror repo leak nothing internal.
 *
 * Kept in sync with `@runhooks/shared` by `api-contract.conformance.test.ts`
 * (monorepo-only; excluded from the public mirror). If that test fails, the
 * server contract changed — update the copies below to match.
 */
import { z } from 'zod';

/** API version prefix, e.g. `https://api.runhooks.app/api/v1`. */
export const API_PREFIX = '/api/v1';

// ── Entity / response types (copied from @runhooks/shared types.ts) ──────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type PlanTier = 'free' | 'starter' | 'production' | 'growth';

export type JobStatus = 'active' | 'paused' | 'completed' | 'failed';

export type ScheduleType = 'cron' | 'interval';

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'dead_letter'
  | 'quota_exceeded';

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

export interface HttpConfig {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface Schedule {
  type: ScheduleType;
  expression: string; // cron expression or interval in ms
  timezone?: string;
}

export interface Job {
  id: string;
  name: string;
  description?: string;
  userId?: string;
  schedule: Schedule;
  httpConfig: HttpConfig;
  retryPolicy: RetryPolicy;
  status: JobStatus;
  pausedReason?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  lastExecutionAt?: Date;
  nextExecutionAt?: Date;
}

export interface ExecutionLog {
  id: string;
  jobId: string;
  jobName?: string;
  userName?: string;
  userEmail?: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  httpStatusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  attempt: number;
  retryOf?: string;
  expiresAt?: Date;
}

export type BillingInterval = 'monthly' | 'annual';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'trialing';

export interface SubscriptionInfo {
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: SubscriptionStatus;
  plan: PlanTier;
  billingInterval: BillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  scheduledPlan?: PlanTier;
  updatedAt: string;
}

export interface PlanGrant {
  plan: PlanTier;
  expiresAt: string;
  grantedAt: string;
  reason?: string;
}

/** Per-user job counts broken down by status (admin list view). */
export interface JobStats {
  total: number;
  active: number;
  paused: number;
  completed: number;
  failed: number;
}

export interface User {
  id: string;
  email?: string;
  name: string;
  role: 'admin' | 'user';
  plan: PlanTier;
  isAnonymous?: boolean;
  onboardingCompleted?: boolean;
  apiKeyPrefix?: string;
  subscription?: SubscriptionInfo;
  planGrant?: PlanGrant;
  jobStats?: JobStats;
  createdAt: Date;
  updatedAt: Date;
}

export type AlertChannel = 'email' | 'webhook' | 'slack';

export interface AlertConfig {
  id: string;
  userId: string;
  name: string;
  channel: AlertChannel;
  target: string;
  jobId?: string | null;
  consecutiveFailuresThreshold: number;
  cooldownMinutes: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageMetric {
  used: number;
  /** Either a concrete limit or -1 when unlimited. */
  limit: number;
  unlimited: boolean;
  /** ISO timestamp when the counter resets; only set for rolling-window metrics. */
  resetsAt?: string;
}

export interface UsageSnapshot {
  plan: PlanTier;
  limits: {
    maxJobs: number;
    maxDailyRuns: number;
    maxMonthlyRuns: number;
    maxRetries: number;
    maxRequestTimeoutMs: number;
    maxAlertConfigs: number;
    retentionDays: number;
    concurrency: number;
  };
  usage: {
    jobs: UsageMetric;
    dailyRuns: UsageMetric;
    monthlyRuns: UsageMetric;
    alertConfigs: UsageMetric;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ── SSRF-safe URL check (copied from @runhooks/shared url-validation.ts) ──────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]);

const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^/:?#]*)(?:[/:?#]|$)/i;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const raw = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = raw.toLowerCase();
  if (lower === '::1') return true;
  if (lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80%')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUrlForSSRF(urlString: string): UrlValidationResult {
  const match = URL_PATTERN.exec(urlString);
  if (!match) return { valid: false, reason: 'Invalid URL' };

  const scheme = match[1]!.toLowerCase();
  const hostname = match[2]!.toLowerCase();

  if (scheme !== 'http' && scheme !== 'https') {
    return { valid: false, reason: `Unsupported URL scheme "${scheme}". Only http and https are allowed` };
  }
  if (!hostname) return { valid: false, reason: 'URL must include a hostname' };
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Hostname "${hostname}" is not allowed` };
  }
  if (isPrivateIPv4(hostname)) {
    return { valid: false, reason: 'URLs targeting private or reserved IP addresses are not allowed' };
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      return { valid: false, reason: 'URLs targeting private or reserved IP addresses are not allowed' };
    }
  }
  return { valid: true };
}

// ── Request schemas (copied from @runhooks/shared schemas.ts) ────────────────

export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export const jobStatusSchema = z.enum(['active', 'paused', 'completed', 'failed']);
export const scheduleTypeSchema = z.enum(['cron', 'interval']);

export const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  initialDelay: z.number().int().min(100).max(60_000).default(1_000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  maxDelay: z.number().int().min(1_000).max(3_600_000).default(300_000),
});

const safeUrlSchema = z.string().url().refine(
  (url) => validateUrlForSSRF(url).valid,
  (url) => ({ message: validateUrlForSSRF(url).reason ?? 'Invalid URL' }),
);

export const httpConfigSchema = z.object({
  url: safeUrlSchema,
  method: httpMethodSchema.default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().max(1_048_576).optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
});

export const scheduleSchema = z.object({
  type: scheduleTypeSchema,
  expression: z.string().min(1),
  timezone: z.string().optional(),
});

export const createJobSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2_000).optional(),
  schedule: scheduleSchema,
  httpConfig: httpConfigSchema,
  retryPolicy: retryPolicySchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const updateJobSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2_000).optional(),
  schedule: scheduleSchema.optional(),
  httpConfig: httpConfigSchema.optional(),
  retryPolicy: retryPolicySchema.optional(),
  status: jobStatusSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const alertChannelSchema = z.enum(['email', 'webhook', 'slack']);

const httpUrlPattern = /^https?:\/\//i;

export function isValidAlertTarget(channel: string, target: string): boolean {
  switch (channel) {
    case 'email':
      return z.string().email().safeParse(target).success;
    case 'webhook':
    case 'slack':
      return z.string().url().safeParse(target).success
        && httpUrlPattern.test(target)
        && validateUrlForSSRF(target).valid;
    default:
      return false;
  }
}

export const createAlertConfigSchema = z.object({
  name: z.string().min(1).max(100),
  channel: alertChannelSchema,
  target: z.string().min(1).max(500),
  jobId: z.string().nullable().optional(),
  consecutiveFailuresThreshold: z.number().int().min(1).max(100).default(1),
  cooldownMinutes: z.number().int().min(0).max(10_080).default(60),
  enabled: z.boolean().default(true),
}).refine(
  (data) => isValidAlertTarget(data.channel, data.target),
  { message: 'Invalid target for the selected channel: use a valid email for "email" or an http(s) URL for "webhook"/"slack"', path: ['target'] },
);

export const updateAlertConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  channel: alertChannelSchema.optional(),
  target: z.string().min(1).max(500).optional(),
  jobId: z.string().nullable().optional(),
  consecutiveFailuresThreshold: z.number().int().min(1).max(100).optional(),
  cooldownMinutes: z.number().int().min(0).max(10_080).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.channel && data.target) {
      return isValidAlertTarget(data.channel, data.target);
    }
    return true;
  },
  { message: 'Invalid target for the selected channel: use a valid email for "email" or an http(s) URL for "webhook"/"slack"', path: ['target'] },
);

export const upgradeAccountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255).optional(),
});

// ── Inferred request-input types (single source: the schemas above) ──────────

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type CreateAlertConfigInput = z.infer<typeof createAlertConfigSchema>;
export type UpdateAlertConfigInput = z.infer<typeof updateAlertConfigSchema>;
export type UpgradeAccountInput = z.infer<typeof upgradeAccountSchema>;
