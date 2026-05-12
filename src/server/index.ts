import { readFileSync, existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { createFileRepository } from "./repository.ts";
import { logger } from "../logger.ts";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const app = createApp({ repo: createFileRepository(process.env.SQLITE_PATH) });

app.get("/architecture", (c) => {
  const path = "./docs/architecture.html";
  if (existsSync(path)) return c.html(readFileSync(path, "utf-8"));
  return c.notFound();
});

app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", (c) => {
  if (existsSync("./dist/index.html")) {
    return c.html(readFileSync("./dist/index.html", "utf-8"));
  }
  return c.notFound();
});

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "server.start");
});
