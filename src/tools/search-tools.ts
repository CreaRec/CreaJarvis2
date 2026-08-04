import type { BraveClient } from "../search/brave-client.js";
import type { GooglePlacesClient } from "../search/google-places-client.js";
import { type ToolDefinition, z } from "./gateway.js";

const webSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(10).optional(),
});

const placesSchema = z.object({
  query: z.string().min(1),
  near: z.string().min(1).optional(),
  count: z.number().int().min(1).max(10).optional(),
});

export function createSearchTools(deps: {
  brave: BraveClient;
  places: GooglePlacesClient;
}): ToolDefinition[] {
  return [
    {
      name: "web_search",
      description:
        "Search the live web for current facts, news, docs, and websites. Use for anything that may have changed or is not in memory.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Number of results (default 5)",
          },
        },
        required: ["query"],
      },
      handler: async (raw) => {
        const parsed = webSchema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const result = await deps.brave.searchWeb({
          query: parsed.data.query,
          count: parsed.data.count ?? 5,
        });
        if (!result.ok) return result;
        return { ok: true, data: result.data };
      },
    },
    {
      name: "places_search",
      description:
        "Search Google Places for businesses, restaurants, landmarks, and POIs. Pass near as a city/area when the user mentions a location or when home city is known. Returns name, address, mapsUrl, lat/lon for calendar location fields.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to find, e.g. coffee shops, museums",
          },
          near: {
            type: "string",
            description:
              "Location anchor, e.g. 'austin tx united states' or 'tokyo japan'",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Number of results (default 5)",
          },
        },
        required: ["query"],
      },
      handler: async (raw) => {
        const parsed = placesSchema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const result = await deps.places.searchPlaces({
          query: parsed.data.query,
          near: parsed.data.near,
          count: parsed.data.count ?? 5,
        });
        if (!result.ok) return result;
        return { ok: true, data: result.data };
      },
    },
  ];
}
