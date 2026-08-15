import { loadBotConfig } from "./config.js";
import { logger } from "./log.js";
import { startTelemetry, shutdownTelemetry, classifyError } from "./telemetry.js";
import { TelegramBotService } from "./bot.js";
import { UsersStore } from "./users-store.js";

async function main(): Promise<void> {
  startTelemetry();
  const config = loadBotConfig();
  const users = new UsersStore(config.USERS_PATH);
  const bot = new TelegramBotService(config, users);
  await bot.start();

  const shutdown = async (signal: string) => {
    logger.info("[telegram] shutting down", {
      component: "telegram",
      handler: "bot",
      step: "finish",
      reason: signal,
    });
    await bot.stop(signal);
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.exception("[telegram] fatal", err, {
    component: "telegram",
    handler: "bot",
    result: "error",
    error_type: classifyError(err),
  });
  void shutdownTelemetry().finally(() => process.exit(1));
});
