import type { AppConfig } from "../config.js";
import { logger } from "../log.js";
import { classifyError, recordVoiceError } from "../telemetry.js";
import type { DeviceRegistry } from "./device-registry.js";
import { shiftOutOfQuietHours } from "./quiet-hours.js";
import { toPublic, type ReminderStore } from "./store.js";

export class ReminderPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: ReminderStore,
    private readonly registry: DeviceRegistry,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.REMINDER_POLL_MS);
    void this.tick();
    logger.info("[reminders] poller started", {
      component: "reminders",
      handler: "reminder_poll",
      step: "start",
      poll_ms: this.config.REMINDER_POLL_MS,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.store.claimDue(now);
      for (const reminder of due) {
        if (reminder.quietHoursOverride !== true) {
          const shifted = shiftOutOfQuietHours(
            now,
            reminder.timezone,
            this.config,
          );
          if (shifted.getTime() > now.getTime()) {
            await this.store.update(reminder.id, {
              fireAt: shifted,
              status: "pending",
            });
            continue;
          }
        }

        if (!this.registry.hasNotifiableClients()) {
          await this.store.markMissed(reminder.id);
          continue;
        }

        const sent = this.registry.broadcast({
          type: "reminder.fired",
          reminder: toPublic(reminder),
        });
        if (sent === 0) {
          await this.store.markMissed(reminder.id);
        } else {
          await this.store.completeDelivery(reminder.id);
        }
      }
    } catch (err) {
      const errorType = classifyError(err);
      recordVoiceError({ errorType, handler: "reminder_poll" });
      logger.exception("[reminders] poller tick failed", err, {
        component: "reminders",
        handler: "reminder_poll",
        result: "error",
        error_type: errorType,
      });
    } finally {
      this.running = false;
    }
  }
}
