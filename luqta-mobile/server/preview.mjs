import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const port = Number(process.env.PREVIEW_PORT || 8082);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const requested = path.resolve(root, `.${pathname}`);
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let target;
    for (const candidate of [
      requested,
      requested + ".html",
      path.join(requested, "index.html"),
    ]) {
      try {
        if ((await stat(candidate)).isFile()) {
          target = candidate;
          break;
        }
      } catch {
        /* Try the next exported path. */
      }
    }
    if (!target) {
      res.writeHead(404).end("Not found");
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(400).end("Bad request");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Luqta preview: http://localhost:${port}`),
);
