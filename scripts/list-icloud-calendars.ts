import { config as loadDotenv } from "dotenv";
import { createDAVClient } from "tsdav";

loadDotenv();

async function main(): Promise<void> {
  const username = process.env.ICLOUD_CALDAV_USERNAME?.trim() ?? "";
  const password = process.env.ICLOUD_CALDAV_PASSWORD?.trim() ?? "";
  if (!username || !password) {
    console.error("Missing ICLOUD_CALDAV_USERNAME or PASSWORD in .env");
    process.exit(1);
  }

  const client = await createDAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  const calendars = await client.fetchCalendars();
  for (const c of calendars) {
    console.log(
      JSON.stringify(
        {
          displayName: c.displayName,
          url: c.url,
          ctag: c.ctag ?? null,
        },
        null,
        2,
      ),
    );
  }
  console.error(`\nFound ${calendars.length} calendar(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
