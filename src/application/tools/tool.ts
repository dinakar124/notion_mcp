import { z } from 'zod';
import { InvalidArgumentsError } from '../../domain/errors.ts';
import type { JsonObject } from '../../domain/json.ts';
import type { RequestContext } from '../request-context.ts';

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: ToolAnnotations;
}

export interface ToolOutput {
  /** One-line human-readable outcome. */
  readonly summary: string;
  /** Stable, product-owned structured result. */
  readonly data: JsonObject;
}

/** A callable capability exposed over MCP. Implementations validate their own arguments. */
export interface Tool {
  readonly definition: ToolDefinition;
  execute(args: unknown, context: RequestContext): Promise<ToolOutput>;
}

export type ToolMetadata = Omit<ToolDefinition, 'inputSchema'>;

/**
 * Template for tools whose arguments are described by a zod schema:
 * the schema is the single source of the advertised JSON Schema and the runtime validation.
 */
export abstract class SchemaTool<S extends z.ZodType> implements Tool {
  readonly definition: ToolDefinition;

  protected constructor(metadata: ToolMetadata, private readonly schema: S) {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(schema, { io: 'input' });
    this.definition = { ...metadata, inputSchema: inputSchema as JsonObject };
  }

  execute(args: unknown, context: RequestContext): Promise<ToolOutput> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) =>
        `${issue.path.join('.') || '(arguments)'}: ${issue.message}`
      );
      return Promise.reject(
        new InvalidArgumentsError(`Invalid arguments for ${this.definition.name}`, issues),
      );
    }
    return this.run(parsed.data as z.output<S>, context);
  }

  protected abstract run(input: z.output<S>, context: RequestContext): Promise<ToolOutput>;
}
