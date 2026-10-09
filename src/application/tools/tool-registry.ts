import { UnknownToolError } from '../../domain/errors.ts';
import type { Tool, ToolDefinition } from './tool.ts';

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export class DuplicateToolError extends Error {
  constructor(name: string) {
    super(`Tool already registered: ${name}`);
    this.name = 'DuplicateToolError';
  }
}

/** Immutable lookup of tools by name; owns the metadata the protocol layer advertises. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: readonly Tool[]) {
    for (const tool of tools) {
      const { name } = tool.definition;
      if (!TOOL_NAME_PATTERN.test(name)) throw new Error(`Invalid tool name: ${name}`);
      if (this.tools.has(name)) throw new DuplicateToolError(name);
      this.tools.set(name, tool);
    }
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new UnknownToolError(name);
    return tool;
  }
}
