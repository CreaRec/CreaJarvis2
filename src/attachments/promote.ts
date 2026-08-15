import { createResponse } from "../openai/responses.js";
import {
  uploadOpenAiFile,
  deleteOpenAiFile,
  openAiFilePurposeForMime,
} from "../openai/files.js";
import type { ChatFetch } from "../openai/chat.js";
import type { ArchivePromoteResult } from "./types.js";
import type { AttachmentDbStore } from "./db-store.js";
import type { AttachmentStore } from "./types.js";
import { logger } from "../log.js";
import { classifyError } from "../telemetry.js";

function attachmentInputContent(input: {
  fileId: string;
  mimeType: string;
}):
  | { type: "input_file"; file_id: string }
  | {
      type: "input_image";
      file_id: string;
      detail: "auto";
    } {
  return input.mimeType.toLowerCase().startsWith("image/")
    ? { type: "input_image", file_id: input.fileId, detail: "auto" }
    : { type: "input_file", file_id: input.fileId };
}

export async function describeAttachment(input: {
  apiKey: string;
  model: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fetchImpl?: ChatFetch;
}): Promise<{ description: string; openAiFileId?: string }> {
  let fileId: string | undefined;
  try {
    const uploaded = await uploadOpenAiFile({
      apiKey: input.apiKey,
      bytes: input.bytes,
      filename: input.filename,
      mimeType: input.mimeType,
      purpose: openAiFilePurposeForMime(input.mimeType),
      fetchImpl: input.fetchImpl,
    });
    fileId = uploaded.id;
    const response = await createResponse({
      apiKey: input.apiKey,
      model: input.model,
      instructions:
        "Write a short Russian description (2-5 sentences) of this attachment for later search. Include key visible text or topics. Do not answer a user question.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Filename: ${input.filename} (${input.mimeType})`,
            },
            attachmentInputContent({
              fileId: uploaded.id,
              mimeType: input.mimeType,
            }),
          ],
        },
      ],
      fetchImpl: input.fetchImpl,
    });
    return {
      description: response.outputText.trim() || input.filename,
      openAiFileId: fileId,
    };
  } catch (err) {
    logger.exception("[attachments] describe failed", err, {
      component: "attachments",
      handler: "http",
      step: "describe",
      result: "error",
      error_type: classifyError(err),
    });
    return { description: input.filename, openAiFileId: fileId };
  } finally {
    if (fileId) {
      await deleteOpenAiFile({
        apiKey: input.apiKey,
        fileId,
        fetchImpl: input.fetchImpl,
      }).catch(() => undefined);
    }
  }
}

export async function promoteInboxToArchive(input: {
  userId: string;
  fsStore: AttachmentStore;
  dbStore: AttachmentDbStore;
  apiKey: string;
  model: string;
  fetchImpl?: ChatFetch;
  /** Pre-read inbox bytes before promote (same files). */
  inboxFiles: Array<{
    filename: string;
    mimeType: string;
    bytes: Buffer;
  }>;
}): Promise<ArchivePromoteResult[]> {
  const promoted = await input.fsStore.promoteAllToArchive(input.userId);
  for (let i = 0; i < promoted.length; i++) {
    const item = promoted[i]!;
    const source = input.inboxFiles[i];
    const bytes =
      source?.bytes ?? (await input.fsStore.readArchiveFile(item.storagePath));
    const { description } = await describeAttachment({
      apiKey: input.apiKey,
      model: input.model,
      filename: item.filename,
      mimeType: item.mimeType,
      bytes,
      fetchImpl: input.fetchImpl,
    });
    await input.dbStore.upsertFromPromote({
      id: item.attachmentId,
      userId: input.userId,
      storagePath: item.storagePath,
      filename: item.filename,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      description,
    });
  }
  return promoted;
}
