/**
 * Reward Ledger CLI — validate, inspect, append.
 *
 * CRASH MODEL:
 * - Lock: mkdir (atomic POSIX). Always released in finally — no Deno.exit inside lock.
 * - Temp file: same directory, exclusive, random name. writeAll + file.sync + rename.
 *   On macOS, fsync on parent directory is not natively supported by Deno; rename
 *   durability relies on macOS's journal (HFS+/APFS). On Linux ext4, an explicit
 *   Deno.open(dir)+sync would complete the durability guarantee. Documented limitation.
 * - On failure inside lock: temp file cleaned up, original preserved, lock released.
 * - Stale lock (crash between mkdir/rmdir): requires manual rmdir. Documented.
 * - Direct filesystem writers bypass this CLI entirely. This is an honest residual.
 * - Principal authentication and hidden-test access are external controls.
 *
 * APPEND REQUIRES (for non-empty ledger):
 *   --expected-head <hash>     Must match current ledger head.
 *   --expected-length <n>      Must match current event count.
 * For activation (first event): --expected-doc-hash <hash> must match event's protocolDocHash.
 * STDIN: reads complete input with 1 MiB max; rejects trailing/multiple JSON values.
 */

import { computeHash } from './crypto.ts';
import { LedgerEvent } from './schemas.ts';
import { replay } from './state-machine.ts';
import { parseLedger, validateLedger } from './validator.ts';

const DEFAULT_PATH = 'docs/agent-reward-ledger.jsonl';
const MAX_STDIN_BYTES = 1024 * 1024; // 1 MiB

export class AppendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppendError';
  }
}

interface AppendOptions {
  filePath: string;
  rawJson: string;
  expectedHead?: string;
  expectedLength?: number;
  expectedDocHash?: string;
}

/** Core append logic — never calls Deno.exit, throws on failure. Testable. */
export async function appendEvent(
  opts: AppendOptions,
): Promise<{ eventId: string; seq: number; head: string }> {
  const lockDir = opts.filePath + '.lock';
  try {
    await Deno.mkdir(lockDir);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      throw new AppendError('LOCK_HELD', `Lock held: ${lockDir}`);
    }
    throw e;
  }
  let tmpPath: string | null = null;
  try {
    // Read existing ledger — only NotFound treated as empty; other errors fail closed
    let content = '';
    try {
      content = await Deno.readTextFile(opts.filePath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) content = '';
      else {throw new AppendError(
          'LEDGER_READ_ERROR',
          `Cannot read ledger: ${(e as Error).message}`,
        );}
    }

    const { events, parseErrors } = parseLedger(content);
    if (parseErrors.length > 0) {
      throw new AppendError('LEDGER_SCHEMA_ERROR', 'Existing ledger has schema errors');
    }

    const valResult = await validateLedger(events);
    if (!valResult.valid) {
      throw new AppendError('LEDGER_INVALID', 'Existing ledger integrity failure');
    }

    const state = await replay(events);

    // Continuity checks — required for non-empty ledger
    if (events.length > 0) {
      if (opts.expectedHead === undefined) {
        throw new AppendError(
          'CONTINUITY_HEAD_REQUIRED',
          'Non-empty ledger requires --expected-head',
        );
      }
      if (opts.expectedLength === undefined) {
        throw new AppendError(
          'CONTINUITY_LENGTH_REQUIRED',
          'Non-empty ledger requires --expected-length',
        );
      }
      if (opts.expectedHead !== state.headHash) {
        throw new AppendError(
          'CONTINUITY_HEAD_MISMATCH',
          `Expected head ${opts.expectedHead}, actual ${state.headHash}`,
        );
      }
      if (opts.expectedLength !== events.length) {
        throw new AppendError(
          'CONTINUITY_LENGTH_MISMATCH',
          `Expected length ${opts.expectedLength}, actual ${events.length}`,
        );
      }
    }

    // Parse raw JSON strictly — reject trailing values
    const trimmed = opts.rawJson.trim();
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(trimmed);
    } catch {
      throw new AppendError('INVALID_JSON', 'stdin is not valid JSON');
    }
    // Check for trailing content after first JSON value
    const firstEnd = findJsonEnd(trimmed);
    if (firstEnd < trimmed.length && trimmed.slice(firstEnd).trim().length > 0) {
      throw new AppendError('TRAILING_JSON', 'Multiple/trailing JSON values in stdin');
    }

    const obj = rawEvent as Record<string, unknown>;
    obj['sequence'] = state.sequence;
    obj['prevEventHash'] = state.headHash;
    obj['eventHash'] = '';

    const parseResult = LedgerEvent.safeParse(obj);
    if (!parseResult.success) {
      throw new AppendError('SCHEMA_ERROR', `Schema: ${parseResult.error.message}`);
    }

    const candidate = parseResult.data;

    // Activation: require --expected-doc-hash
    if (candidate.type === 'activation') {
      if (!opts.expectedDocHash) {
        throw new AppendError('DOC_HASH_REQUIRED', 'Activation requires --expected-doc-hash');
      }
      if (candidate.protocolDocHash !== opts.expectedDocHash) {
        throw new AppendError('DOC_HASH_MISMATCH', `protocolDocHash mismatch`);
      }
    }

    const eventHash = await computeHash(candidate);
    const stamped = { ...candidate, eventHash } as LedgerEvent;

    // Validate through reducer
    await replay([...events, stamped]);

    // Atomic write
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    tmpPath = `${opts.filePath}.tmp.${rand}`;
    const newLine = JSON.stringify(stamped) + '\n';
    const newContent = content + newLine;
    const file = await Deno.open(tmpPath, { write: true, createNew: true });
    try {
      await file.write(new TextEncoder().encode(newContent));
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(tmpPath, opts.filePath);
    tmpPath = null; // renamed successfully, don't clean up

    return { eventId: stamped.eventId, seq: stamped.sequence, head: stamped.eventHash };
  } finally {
    // Clean up temp file on failure
    if (tmpPath) {
      try {
        await Deno.remove(tmpPath);
      } catch { /* ok */ }
    }
    // Always release lock
    try {
      await Deno.remove(lockDir);
    } catch { /* ok */ }
  }
}

/** Find the end index of the first JSON value in a string. */
function findJsonEnd(s: string): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

/** Read complete stdin with strict max size. */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > MAX_STDIN_BYTES) {
        throw new AppendError('STDIN_TOO_LARGE', `Stdin exceeds ${MAX_STDIN_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new AppendError('STDIN_EMPTY', 'No data on stdin');
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(merged);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(`Usage:
  reward-ledger validate [--file <path>] [--expected-head <hash>] [--expected-length <n>]
  reward-ledger inspect  [--file <path>]
  reward-ledger append   [--file <path>] --expected-head <hash> --expected-length <n>
                         [--expected-doc-hash <hash>] < event.json

Append requires continuity inputs for non-empty ledger. First activation requires --expected-doc-hash.
Direct filesystem writers bypass this CLI. Principal auth is external.`);
  Deno.exit(2);
}

async function main() {
  const args = [...Deno.args];
  if (args.length === 0) usage();
  const command = args.shift()!;
  let filePath = DEFAULT_PATH;
  let expectedHead: string | undefined;
  let expectedLength: number | undefined;
  let expectedDocHash: string | undefined;
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === '--file' && args.length > 0) filePath = args.shift()!;
    else if (a === '--expected-head' && args.length > 0) expectedHead = args.shift()!;
    else if (a === '--expected-length' && args.length > 0) {
      expectedLength = parseInt(args.shift()!, 10);
    } else if (a === '--expected-doc-hash' && args.length > 0) expectedDocHash = args.shift()!;
    else {
      console.error(`Unknown: ${a}`);
      usage();
    }
  }
  switch (command) {
    case 'validate': {
      await runValidate(filePath, expectedHead, expectedLength);
      break;
    }
    case 'inspect': {
      await runInspect(filePath);
      break;
    }
    case 'append': {
      try {
        const rawJson = await readStdin();
        const result = await appendEvent({
          filePath,
          rawJson,
          expectedHead,
          expectedLength,
          expectedDocHash,
        });
        console.log(
          `Appended ${result.eventId} seq=${result.seq} head=${result.head.slice(0, 16)}...`,
        );
      } catch (e) {
        console.error(`Append failed: ${(e as Error).message}`);
        Deno.exit(1);
      }
      break;
    }
    default: {
      console.error(`Unknown: ${command}`);
      usage();
    }
  }
}

async function runValidate(fp: string, head?: string, len?: number) {
  let content: string;
  try {
    content = await Deno.readTextFile(fp);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error(`Not found: ${fp}`);
      Deno.exit(1);
    }
    throw e;
  }
  if (content.trim().length === 0 && !head && len === undefined) {
    console.log('Empty. Valid.');
    Deno.exit(0);
  }
  const { events, parseErrors } = parseLedger(content);
  if (parseErrors.length > 0) {
    for (const e of parseErrors) console.error(`  [${e.code}] ${e.message}`);
    Deno.exit(1);
  }
  const r = await validateLedger(events, { expectedHeadHash: head, expectedLength: len });
  if (r.valid) {
    console.log(`Valid: ${r.length} events`);
    Deno.exit(0);
  }
  for (const e of r.errors) console.error(`  [${e.code}] ${e.message}`);
  Deno.exit(1);
}

async function runInspect(fp: string) {
  let content: string;
  try {
    content = await Deno.readTextFile(fp);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error(`Not found: ${fp}`);
      Deno.exit(1);
    }
    throw e;
  }
  if (content.trim().length === 0) {
    console.log('Empty. Protocol inactive.');
    return;
  }
  const { events } = parseLedger(content);
  const state = await replay(events);
  console.log(
    `Activated: ${state.activated}, Events: ${events.length}, Items: ${state.items.size}`,
  );
}

if (import.meta.main) await main();
