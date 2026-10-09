import { ConfigError } from '../domain/errors.ts';
import { LOG_LEVELS, type LogLevel } from '../observability/logger.ts';

export interface EnvSource {
  get(name: string): string | undefined;
}

export interface FakeNotionConfig {
  readonly mode: 'fake';
}

export interface RealNotionConfig {
  readonly mode: 'real';
  readonly token: string;
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly timeoutMs: number;
}

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxBodyBytes: number;
  readonly logLevel: LogLevel;
  readonly notion: FakeNotionConfig | RealNotionConfig;
}

/** Environment variables read by loadConfig; the dev task grants --allow-env for exactly these. */
export const CONFIG_ENV_VARS = [
  'MCP_SERVER_HOST',
  'MCP_SERVER_PORT',
  'MCP_ALLOWED_ORIGINS',
  'MCP_ALLOW_NON_LOOPBACK',
  'LOG_LEVEL',
  'NOTION_MODE',
  'NOTION_TOKEN',
  'NOTION_API_BASE_URL',
  'NOTION_ALLOW_LOOPBACK_BASE_URL',
  'NOTION_API_VERSION',
  'NOTION_TIMEOUT_MS',
] as const;

const LOOPBACK_BASE_URL_FLAG = 'NOTION_ALLOW_LOOPBACK_BASE_URL';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 3000,
  baseUrl: 'https://api.notion.com',
  apiVersion: '2022-06-28',
  timeoutMs: 10_000,
  maxBodyBytes: 1_048_576,
} as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Parses and validates the environment. Reports every problem at once; never echoes secrets. */
export function loadConfig(env: EnvSource): AppConfig {
  const issues: string[] = [];
  const read = (name: string) => env.get(name)?.trim() || undefined;

  const host = read('MCP_SERVER_HOST') ?? DEFAULTS.host;
  if (!LOOPBACK_HOSTS.has(host) && read('MCP_ALLOW_NON_LOOPBACK') !== 'true') {
    issues.push(
      'MCP_SERVER_HOST is not loopback; the server has no inbound authentication. ' +
        'Set MCP_ALLOW_NON_LOOPBACK=true only behind a trusted network boundary',
    );
  }

  const port = parseInteger(read('MCP_SERVER_PORT'), DEFAULTS.port, 0, 65_535);
  if (port === null) issues.push('MCP_SERVER_PORT must be an integer between 0 and 65535');

  const logLevel = read('LOG_LEVEL') ?? 'info';
  if (!isLogLevel(logLevel)) issues.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  const origins = parseOrigins(read('MCP_ALLOWED_ORIGINS'), issues);

  const mode = read('NOTION_MODE') ?? 'fake';
  let notion: FakeNotionConfig | RealNotionConfig = { mode: 'fake' };
  if (mode === 'real') {
    const real = loadRealNotionConfig(read, issues);
    if (real) notion = real;
  } else if (mode !== 'fake') {
    issues.push('NOTION_MODE must be "fake" or "real"');
  }

  if (issues.length > 0 || port === null || !isLogLevel(logLevel)) throw new ConfigError(issues);
  return {
    host,
    port,
    allowedOrigins: origins,
    maxBodyBytes: DEFAULTS.maxBodyBytes,
    logLevel,
    notion,
  };
}

function loadRealNotionConfig(
  read: (name: string) => string | undefined,
  issues: string[],
): RealNotionConfig | null {
  const before = issues.length;
  const token = read('NOTION_TOKEN');
  if (token === undefined) {
    issues.push('NOTION_TOKEN is required when NOTION_MODE=real');
  } else if (!/^[\x21-\x7e]{8,512}$/.test(token)) {
    issues.push('NOTION_TOKEN must be 8-512 printable characters without whitespace');
  }

  const baseUrl = resolveBaseUrl(
    read('NOTION_API_BASE_URL'),
    read(LOOPBACK_BASE_URL_FLAG) === 'true',
    issues,
  );

  const apiVersion = read('NOTION_API_VERSION') ?? DEFAULTS.apiVersion;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) {
    issues.push('NOTION_API_VERSION must look like YYYY-MM-DD');
  }

  const timeoutMs = parseInteger(read('NOTION_TIMEOUT_MS'), DEFAULTS.timeoutMs, 1_000, 60_000);
  if (timeoutMs === null) {
    issues.push('NOTION_TIMEOUT_MS must be an integer between 1000 and 60000');
  }

  if (issues.length > before || token === undefined || baseUrl === null || timeoutMs === null) {
    return null;
  }
  return { mode: 'real', token, baseUrl, apiVersion, timeoutMs };
}

function resolveBaseUrl(
  raw: string | undefined,
  allowLoopback: boolean,
  issues: string[],
): string | null {
  if (raw === undefined) return DEFAULTS.baseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push('NOTION_API_BASE_URL must be an absolute URL');
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '')) {
    issues.push(
      'NOTION_API_BASE_URL must be an origin only: no credentials, path, query or fragment',
    );
    return null;
  }
  if (url.origin === DEFAULTS.baseUrl) return url.origin;

  // The bearer token goes to this origin, so only Notion itself or an explicit local test server qualifies.
  if (!allowLoopback) {
    issues.push(
      `NOTION_API_BASE_URL must be ${DEFAULTS.baseUrl}; ` +
        `a loopback test server needs ${LOOPBACK_BASE_URL_FLAG}=true`,
    );
    return null;
  }
  if (
    !(url.protocol === 'http:' || url.protocol === 'https:') || !LOOPBACK_HOSTS.has(url.hostname)
  ) {
    issues.push(
      `NOTION_API_BASE_URL must be a loopback origin when ${LOOPBACK_BASE_URL_FLAG}=true`,
    );
    return null;
  }
  return url.origin;
}

function parseOrigins(raw: string | undefined, issues: string[]): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of raw?.split(',') ?? []) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    try {
      const url = new URL(trimmed);
      if (url.origin === 'null' || url.origin !== trimmed.replace(/\/$/, '')) throw new Error();
      origins.add(url.origin);
    } catch {
      issues.push(`MCP_ALLOWED_ORIGINS has an invalid origin: ${trimmed}`);
    }
  }
  return origins;
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
