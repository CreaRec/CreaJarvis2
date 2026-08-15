import { z } from "zod";
import type { AttachmentDbStore } from "../attachments/db-store.js";
import type { AttachmentStore } from "../attachments/types.js";
import {
  openAiFilePurposeForMime,
  uploadOpenAiFile,
} from "../openai/files.js";
import type { ToolGateway } from "./gateway.js";
import type { AgentTurnAttachment } from "../agent/turn.js";

export function registerAttachmentTools(
  gateway: ToolGateway,
  input: {
    dbStore: AttachmentDbStore;
    fsStore: AttachmentStore;
    apiKey: string;
    getPendingInputFiles: () => AgentTurnAttachment[] | undefined;
    getUserId: () => string | undefined;
  },
): void {
  gateway.register({
    name: "attachment_search",
    description:
      "Search previously uploaded user attachments (screenshots, PDFs, files) by meaning. Use for «найди тот скрин», old docs. NOT for biography facts (memory_search) or trip notebooks (theme_*).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = z
        .object({
          query: z.string().trim().min(1),
          limit: z.number().int().min(1).max(10).optional(),
        })
        .safeParse(raw);
      if (!args.success) {
        return { ok: false, error: "query required" };
      }
      const userId = input.getUserId();
      if (!userId) {
        return { ok: false, error: "userId unavailable for attachment search" };
      }
      const hits = await input.dbStore.search({
        userId,
        query: args.data.query,
        limit: args.data.limit,
      });
      return {
        ok: true,
        data: {
          hits: hits.map((h) => ({
            id: h.id,
            filename: h.filename,
            mime_type: h.mimeType,
            description: h.description.slice(0, 500),
            score: h.score,
          })),
        },
      };
    },
  });

  gateway.register({
    name: "attachment_open",
    description:
      "Open up to 3 archived attachments by id into the current turn so you can see the file contents. Call after attachment_search when the raw file is needed.",
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = z
        .object({
          ids: z.array(z.string().uuid()).min(1).max(3),
        })
        .safeParse(raw);
      if (!args.success) {
        return { ok: false, error: "ids required (1-3 uuids)" };
      }
      const pending = input.getPendingInputFiles();
      if (!pending) {
        return { ok: false, error: "attachment_open unavailable in this turn" };
      }
      const opened: Array<{ id: string; filename: string; file_id: string }> =
        [];
      for (const id of args.data.ids) {
        const row = await input.dbStore.getById(id);
        if (!row) continue;
        const bytes = await input.fsStore.readArchiveFile(row.storagePath);
        const uploaded = await uploadOpenAiFile({
          apiKey: input.apiKey,
          bytes,
          filename: row.filename,
          mimeType: row.mimeType,
          purpose: openAiFilePurposeForMime(row.mimeType),
        });
        pending.push({
          fileId: uploaded.id,
          filename: row.filename,
          mimeType: row.mimeType,
        });
        opened.push({
          id: row.id,
          filename: row.filename,
          file_id: uploaded.id,
        });
      }
      return { ok: true, data: { opened } };
    },
  });
}
