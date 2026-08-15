import { describe, expect, it } from "vitest";
import { parseJsonArgs, ToolGateway, type ToolDefinition } from "./gateway.js";

describe("parseJsonArgs", () => {
  it("parses valid JSON", () => {
    expect(parseJsonArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns empty object for blank input", () => {
    expect(parseJsonArgs("")).toEqual({});
    expect(parseJsonArgs("   ")).toEqual({});
  });

  it("returns parse-error envelope for invalid JSON", () => {
    expect(parseJsonArgs("{bad")).toEqual({
      _parseError: true,
      raw: "{bad",
    });
  });
});

describe("ToolGateway", () => {
  it("returns error for unknown tool and audits it", async () => {
    const gw = new ToolGateway();
    const result = await gw.execute("missing", {});
    expect(result).toEqual({ ok: false, error: "Unknown tool: missing" });
    expect(gw.auditLog).toHaveLength(1);
    expect(gw.auditLog[0]).toMatchObject({
      tool: "missing",
      ok: false,
      error: "Unknown tool: missing",
    });
  });

  it("executes a registered tool and audits success", async () => {
    const gw = new ToolGateway();
    const tool: ToolDefinition = {
      name: "echo",
      description: "echo",
      parameters: {},
      handler: async (args) => ({ ok: true, data: args }),
    };
    gw.register(tool);
    const result = await gw.execute("echo", { x: 1 });
    expect(result).toEqual({ ok: true, data: { x: 1 } });
    expect(gw.auditLog[0]).toMatchObject({ tool: "echo", ok: true });
  });

  it("catches handler throws and returns ok:false", async () => {
    const gw = new ToolGateway();
    gw.register({
      name: "boom",
      description: "boom",
      parameters: {},
      handler: async () => {
        throw new Error("kaboom");
      },
    });
    const result = await gw.execute("boom", {});
    expect(result).toEqual({ ok: false, error: "kaboom" });
    expect(gw.auditLog[0]).toMatchObject({ ok: false, error: "kaboom" });
  });

  it("lists tools in neutral and realtime formats", () => {
    const gw = new ToolGateway();
    gw.register({
      name: "t",
      description: "d",
      parameters: { type: "object" },
      handler: async () => ({ ok: true, data: null }),
    });
    expect(gw.listTools()).toEqual([
      {
        name: "t",
        description: "d",
        parameters: { type: "object" },
      },
    ]);
    expect(gw.listRealtimeTools()).toEqual([
      {
        type: "function",
        name: "t",
        description: "d",
        parameters: { type: "object" },
      },
    ]);
  });
});
