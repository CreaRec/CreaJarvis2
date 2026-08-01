import { z } from "zod";

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: unknown) => Promise<ToolResult>;
}

export interface AuditEntry {
  tool: string;
  args: unknown;
  ok: boolean;
  error?: string;
  ms: number;
  at: string;
}

export class ToolGateway {
  private readonly tools = new Map<string, ToolDefinition>();
  readonly auditLog: AuditEntry[] = [];

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  listRealtimeTools(): Array<{
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return [...this.tools.values()].map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(name: string, rawArgs: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const started = Date.now();
    if (!tool) {
      const result: ToolResult = { ok: false, error: `Unknown tool: ${name}` };
      this.auditLog.push({
        tool: name,
        args: rawArgs,
        ok: false,
        error: result.error,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
      return result;
    }

    try {
      const result = await tool.handler(rawArgs);
      this.auditLog.push({
        tool: name,
        args: rawArgs,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.auditLog.push({
        tool: name,
        args: rawArgs,
        ok: false,
        error,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
      return { ok: false, error };
    }
  }
}

export function parseJsonArgs(args: string): unknown {
  if (!args || !args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { _parseError: true, raw: args };
  }
}

export { z };
