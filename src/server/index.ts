import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createFileRepository } from "./repository.ts";

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp({ repo: createFileRepository(process.env.SQLITE_PATH) });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PlanWell API listening on http://localhost:${info.port}`);
});
