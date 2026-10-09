import type { RealNotionConfig } from '../../config/config.ts';
import type { Logger } from '../../observability/logger.ts';
import { NotionHttpClient, type NotionHttpClientDeps } from './notion-http-client.ts';
import { RealNotionGateway } from './real-notion-gateway.ts';
import { RetryPolicy } from './retry-policy.ts';

export type NotionIo = Pick<NotionHttpClientDeps, 'fetch' | 'sleep'>;

const systemIo: NotionIo = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Builds the real gateway; `io` lets tests substitute the network and clock. */
export function createRealNotionGateway(
  config: RealNotionConfig,
  logger: Logger,
  io: NotionIo = systemIo,
): RealNotionGateway {
  const client = new NotionHttpClient(config, { ...io, retryPolicy: new RetryPolicy(), logger });
  return new RealNotionGateway(client);
}
