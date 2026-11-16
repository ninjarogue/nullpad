import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const roots = [join(repo, "assets"), join(repo, "build/dev/javascript")];
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".mjs": "text/javascript",
};
const app = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nullpad</title>
<link rel="stylesheet" href="/nullpad.css">
</head>
<body>
<div id="app"></div>
<script type="module">
import { main } from "/nullpad/nullpad.mjs";
main();
</script>
</body>
</html>`;
const blank = "<!doctype html><title>blank</title>";

execFileSync("gleam", ["build"], { cwd: repo, stdio: "inherit" });

async function file(path) {
  for (const root of roots) {
    try {
      return await readFile(join(root, path));
    } catch {}
  }
}

async function answer(request) {
  let path;
  try {
    path = normalize(new URL(request.url, "http://localhost").pathname);
  } catch {
    return { status: 400 };
  }
  const page = { "/": app, "/blank": blank }[path];
  const body = page ?? (await file(path));
  if (body === undefined) return { status: 404 };
  return { status: 200, body, type: page ? "text/html" : (types[extname(path)] ?? "application/octet-stream") };
}

// A request that throws must not stop the server: every test after a dead one
// is refused its connection and says nothing of why.
const complain = (what, error) => console.error(`serve: ${what}: ${error?.stack ?? error}`);
process.on("uncaughtException", (error) => complain("uncaught exception", error));
process.on("unhandledRejection", (error) => complain("unhandled rejection", error));

createServer(async (request, response) => {
  try {
    const { status, body, type } = await answer(request);
    if (body === undefined) response.writeHead(status).end();
    else response.writeHead(status, { "content-type": type }).end(body);
  } catch (error) {
    complain(`${request.method} ${request.url}`, error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}).listen(Number(process.argv[2]), "127.0.0.1");
