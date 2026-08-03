import type { DeviceRegistry } from "../reminders/device-registry.js";
import {
  toPublic,
  type DeviceStore,
} from "../devices/store.js";
import { type ToolDefinition, z } from "./gateway.js";

export function createDeviceTools(deps: {
  store: DeviceStore;
  registry: DeviceRegistry;
}): ToolDefinition[] {
  return [
    {
      name: "device_list",
      description:
        "List household devices (name, room, purpose, online). Read-only — device metadata is set in client Settings / hello, not via tools. Use when the user asks which devices exist, where they are, or what is connected.",
      parameters: {
        type: "object",
        properties: {
          include_archived: {
            type: "boolean",
            description: "Include archived devices (default false)",
          },
        },
        required: [],
      },
      handler: async (raw) => {
        const schema = z.object({
          include_archived: z.boolean().optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const devices = await deps.store.list({
          includeArchived: parsed.data.include_archived ?? false,
          limit: 100,
        });
        const online = deps.registry.onlineIds();
        return {
          ok: true,
          data: {
            devices: devices.map((d) =>
              toPublic(d, { online: online.has(d.id) }),
            ),
            count: devices.length,
          },
        };
      },
    },
  ];
}
