import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

/** Credentials persisted between MCP server restarts. */
export interface StoredConfig {
  apiUrl: string;
  apiKey: string;
}

const CONFIG_DIR = join(homedir(), '.runhooks');
// The MCP server owns this file; it is the only file we ever write to.
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp.json');
// The CLI stores its credentials here. We read it as a fallback (never write
// it) so a user who already ran `runhooks init` reuses that identity instead
// of spawning a second anonymous account.
const CLI_CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function readFileConfig(path: string): StoredConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredConfig>;
    if (!parsed.apiKey) return null;
    return { apiUrl: parsed.apiUrl ?? '', apiKey: parsed.apiKey };
  } catch {
    // Missing (ENOENT) or malformed file → treat as no stored credentials.
    return null;
  }
}

/** Read persisted credentials: the MCP file first, then the CLI file. */
export function readStoredConfig(): StoredConfig | null {
  return readFileConfig(MCP_CONFIG_FILE) ?? readFileConfig(CLI_CONFIG_FILE);
}

/** Persist credentials to the MCP config file (0600 where supported). */
export function writeStoredConfig(config: StoredConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  try {
    chmodSync(MCP_CONFIG_FILE, 0o600);
  } catch {
    // Platforms without POSIX permissions (Windows) ignore this.
  }
}

export function getConfigPath(): string {
  return MCP_CONFIG_FILE;
}
