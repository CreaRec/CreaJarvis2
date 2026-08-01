import { loadConfig } from "../src/config.js";
import { BraveClient } from "../src/search/brave-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const mode = process.argv[2] ?? "web";
  const rest = process.argv.slice(3);

  const client = new BraveClient(
    config.BRAVE_API_KEY,
    config.BRAVE_COUNTRY,
    config.BRAVE_SEARCH_LANG,
  );

  if (mode === "places") {
    const nearIdx = rest.indexOf("--near");
    let near: string | undefined;
    let queryParts = rest;
    if (nearIdx >= 0) {
      near = rest[nearIdx + 1];
      queryParts = [...rest.slice(0, nearIdx), ...rest.slice(nearIdx + 2)];
    }
    const query = queryParts.join(" ") || "coffee";
    console.log(`[smoke-search] places query=${JSON.stringify(query)} near=${JSON.stringify(near ?? null)}`);
    const result = await client.searchPlaces({ query, near, count: 5 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (mode !== "web") {
    console.error("Usage: smoke:search web [query...]");
    console.error("       smoke:search places [query...] [--near location]");
    process.exit(1);
  }

  const query = rest.join(" ") || "OpenAI Realtime API";
  console.log(`[smoke-search] web query=${JSON.stringify(query)}`);
  const result = await client.searchWeb({ query, count: 5 });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-search] fatal:", err);
  process.exit(1);
});
