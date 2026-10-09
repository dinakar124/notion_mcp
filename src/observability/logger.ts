export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|secret|authorization|password|credential|api[-_]?key/i;

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Writes one JSON object per line and masks values under sensitive-looking keys. */
export class JsonLogger implements Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly write: (line: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields);
  }

  private log(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const entry: Record<string, unknown> = { time: this.now().toISOString(), level, message };
    for (const [key, value] of Object.entries(fields)) {
      entry[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : value;
    }
    this.write(JSON.stringify(entry));
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
