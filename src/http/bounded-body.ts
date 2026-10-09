import { McpProtocolError } from '../protocol/mcp/protocol-error.ts';

/** Reads a request body as text, rejecting anything larger than `maxBytes`. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function tooLarge(maxBytes: number): McpProtocolError {
  return McpProtocolError.invalidRequest(`Request body exceeds ${maxBytes} bytes`, 413);
}
