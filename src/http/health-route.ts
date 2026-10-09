import { PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from '../protocol/mcp/constants.ts';
import { jsonResponse, methodNotAllowed } from './responses.ts';
import type { Route } from './route.ts';

export class HealthRoute implements Route {
  readonly path = '/health';

  constructor(private readonly notionMode: 'fake' | 'real') {}

  handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return Promise.resolve(methodNotAllowed('GET'));
    return Promise.resolve(jsonResponse({
      status: 'ok',
      service: SERVER_NAME,
      version: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      notionMode: this.notionMode,
    }));
  }
}
