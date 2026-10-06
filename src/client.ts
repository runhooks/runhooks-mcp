import { API_PREFIX } from './api-contract.js';
import type {
  ApiResponse,
  CreateJobInput,
  UpdateJobInput,
  Job,
  ExecutionLog,
  PaginatedResponse,
  UsageSnapshot,
  User,
  AlertConfig,
  CreateAlertConfigInput,
  UpdateAlertConfigInput,
  UpgradeAccountInput,
} from './api-contract.js';
/** Minimal connection config — the MCP server reads these from env. */
export interface ClientConfig {
  apiUrl: string;
  apiKey: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class RunhooksClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, '') + API_PREFIX;
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiError(`Network error: ${message}`, 0);
    }

    let body: unknown;
    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const errorMessage =
        (body as { error?: string })?.error ||
        `Request failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status, body);
    }

    const apiResponse = body as ApiResponse<T>;
    if (apiResponse && typeof apiResponse === 'object' && 'success' in apiResponse) {
      if (!apiResponse.success) {
        throw new ApiError(
          apiResponse.error ?? 'Request failed',
          response.status,
          body
        );
      }
      return apiResponse.data as T;
    }
    return body as T;
  }

  // --- Jobs ---

  async createJob(input: CreateJobInput): Promise<Job> {
    return this.request<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async listJobs(query: {
    page?: number;
    limit?: number;
    status?: string;
    tag?: string;
    name?: string;
  } = {}): Promise<PaginatedResponse<Job>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<PaginatedResponse<Job>>(`/jobs${suffix}`);
  }

  async getJob(id: string): Promise<Job> {
    return this.request<Job>(`/jobs/${encodeURIComponent(id)}`);
  }

  async updateJob(id: string, input: UpdateJobInput): Promise<Job> {
    return this.request<Job>(`/jobs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteJob(id: string): Promise<void> {
    await this.request<null>(`/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getJobExecutions(
    jobId: string,
    query: { page?: number; limit?: number; status?: string } = {}
  ): Promise<PaginatedResponse<ExecutionLog>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<PaginatedResponse<ExecutionLog>>(
      `/jobs/${encodeURIComponent(jobId)}/executions${suffix}`
    );
  }

  // --- Executions ---

  async replayExecution(executionId: string): Promise<void> {
    await this.request<null>(
      `/executions/${encodeURIComponent(executionId)}/replay`,
      { method: 'POST' }
    );
  }

  // --- Usage ---

  async getMyUsage(): Promise<UsageSnapshot> {
    return this.request<UsageSnapshot>('/usage/me');
  }

  // --- Auth ---

  async getMe(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async ping(): Promise<void> {
    await this.getMe();
  }

  async upgradeAccount(input: UpgradeAccountInput): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/upgrade', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async claimUpgradeToken(): Promise<{ token: string; expiresAt: string; claimUrl: string }> {
    return this.request<{ token: string; expiresAt: string; claimUrl: string }>(
      '/auth/upgrade/claim-token',
      { method: 'POST' }
    );
  }

  async rotateApiKey(): Promise<{ apiKey: string; apiKeyPrefix: string }> {
    return this.request<{ apiKey: string; apiKeyPrefix: string }>(
      '/auth/rotate-key',
      { method: 'POST' }
    );
  }

  // --- Alerts ---

  async listAlerts(): Promise<AlertConfig[]> {
    return this.request<AlertConfig[]>('/alerts');
  }

  async createAlert(input: CreateAlertConfigInput): Promise<AlertConfig> {
    return this.request<AlertConfig>('/alerts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getAlert(id: string): Promise<AlertConfig> {
    return this.request<AlertConfig>(`/alerts/${encodeURIComponent(id)}`);
  }

  async updateAlert(id: string, input: UpdateAlertConfigInput): Promise<AlertConfig> {
    return this.request<AlertConfig>(`/alerts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteAlert(id: string): Promise<void> {
    await this.request<null>(`/alerts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

// --- Public (unauthenticated) requests ---

export async function publicRequest<T>(apiUrl: string, path: string, init?: RequestInit): Promise<T> {
  const baseUrl = apiUrl.replace(/\/$/, '') + API_PREFIX;
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Network error: ${message}`, 0);
  }

  let body: unknown;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const errorMessage =
      (body as { error?: string })?.error ||
      `Request failed with status ${response.status}`;
    throw new ApiError(errorMessage, response.status, body);
  }

  const apiResponse = body as ApiResponse<T>;
  if (apiResponse && typeof apiResponse === 'object' && 'success' in apiResponse) {
    if (!apiResponse.success) {
      throw new ApiError(
        apiResponse.error ?? 'Request failed',
        response.status,
        body
      );
    }
    return apiResponse.data as T;
  }
  return body as T;
}
