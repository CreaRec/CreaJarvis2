import type { AppConfig } from "../config.js";
import { logger } from "../log.js";
import type { DeviceRegistry } from "./device-registry.js";
import type { ReminderStore } from "./store.js";

/**
 * Local Jarvis reminder delivery is disabled. Apple Calendar / VALARM owns
 * event alerts; reminders stay in DB with apple_sync_status=pending until
 * Apple Reminders sync exists.
 */
export class ReminderPoller {
  constructor(
    _store: ReminderStore,
    _registry: DeviceRegistry,
    _config: AppConfig,
  ) {}

  start(): void {
    logger.info("[reminders] poller disabled (Apple-only alerts)", {
      component: "reminders",
      handler: "reminder_poll",
      step: "start",
      result: "skipped",
    });
  }

  stop(): void {}
}
