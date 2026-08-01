import type { AppConfig } from "../config.js";
import type { ClientRegistry } from "./client-registry.js";
import { shiftOutOfQuietHours } from "./quiet-hours.js";
import { toPublic, type ReminderStore } from "./store.js";

export class ReminderPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: ReminderStore,
    private readonly registry: ClientRegistry,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.REMINDER_POLL_MS);
    void this.tick();
    console.log(
      `[reminders] poller started (every ${this.config.REMINDER_POLL_MS}ms)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

        if (!this.registry.hasClients()) {
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
      console.error("[reminders] poller tick failed:", err);
    } finally {
      this.running = false;
    }
  }
}
