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
<title>scribbl</title>
<link rel="stylesheet" href="/scribbl.css">
</head>
<body>
<div id="app"></div>
<script type="module">
import { main } from "/scribbl/scribbl.mjs";
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

createServer(async (request, response) => {
  const path = normalize(new URL(request.url, "http://localhost").pathname);
  const page = { "/": app, "/blank": blank }[path];
  const body = page ?? (await file(path));
  const type = page ? "text/html" : types[extname(path)];
  if (body === undefined) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": type }).end(body);
}).listen(Number(process.argv[2]), "127.0.0.1");
