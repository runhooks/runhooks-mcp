import { describe, it, expect } from 'vitest';
import {
  API_PREFIX,
  createJobSchema,
  createAlertConfigSchema,
  validateUrlForSSRF,
} from './api-contract.js';

// Self-contained tests (no @runhooks/shared import), so they travel to the
// public mirror and run as the publish gate there.

describe('api-contract', () => {
  it('exposes the API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });

  describe('createJobSchema', () => {
    const base = {
      name: 'nightly-sync',
      schedule: { type: 'cron' as const, expression: '*/5 * * * *' },
      httpConfig: { url: 'https://api.example.com/sync', method: 'POST' as const, timeoutMs: 30_000 },
    };

    it('accepts a valid cron job', () => {
      expect(createJobSchema.safeParse(base).success).toBe(true);
    });

    it('rejects a job targeting a private/SSRF URL', () => {
      const ssrf = { ...base, httpConfig: { ...base.httpConfig, url: 'http://169.254.169.254/latest/meta-data/' } };
      expect(createJobSchema.safeParse(ssrf).success).toBe(false);
    });

    it('rejects an empty name', () => {
      expect(createJobSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    });
  });

  describe('validateUrlForSSRF', () => {
    it('allows public https URLs', () => {
      expect(validateUrlForSSRF('https://example.com/hook').valid).toBe(true);
    });

    it('blocks localhost, private ranges, and non-http schemes', () => {
      expect(validateUrlForSSRF('http://localhost').valid).toBe(false);
      expect(validateUrlForSSRF('http://127.0.0.1').valid).toBe(false);
      expect(validateUrlForSSRF('http://10.0.0.1').valid).toBe(false);
      expect(validateUrlForSSRF('http://[::1]').valid).toBe(false);
      expect(validateUrlForSSRF('ftp://example.com').valid).toBe(false);
    });
  });

  describe('createAlertConfigSchema', () => {
    it('accepts a valid email alert', () => {
      const r = createAlertConfigSchema.safeParse({ name: 'fail', channel: 'email', target: 'me@example.com' });
      expect(r.success).toBe(true);
    });

    it('rejects a webhook alert whose target is not an http(s) URL', () => {
      const r = createAlertConfigSchema.safeParse({ name: 'fail', channel: 'webhook', target: 'not-a-url' });
      expect(r.success).toBe(false);
    });
  });
});
