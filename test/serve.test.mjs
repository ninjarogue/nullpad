import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, createServer } from "node:http";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { root } from "./steps.mjs";

const built = join(root, "build/dev/javascript");
const plant = join(built, `serve-test-${process.pid}`);
const planted = { ".cache_meta": "meta", "style.unknownext": "odd", noextension: "bare" };
mkdirSync(plant, { recursive: true });
for (const [name, text] of Object.entries(planted)) writeFileSync(join(plant, name), text);
after(() => rmSync(plant, { recursive: true, force: true }));

const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const get = (port, path) =>
  new Promise((done, fail) => {
    const sent = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => done({ status: response.statusCode, type: response.headers["content-type"], body: Buffer.concat(chunks).toString() }));
    });
    sent.on("error", fail);
    sent.end();
  });

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function serving(use) {
  const port = await freePort();
  const child = spawn("node", ["e2e/serve.mjs", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stdout.on("data", (chunk) => (said += chunk));
  child.stderr.on("data", (chunk) => (said += chunk));
  const alive = () => (child.exitCode === null && child.signalCode === null ? "" : `the server is gone (exit ${child.exitCode}, ${child.signalCode}). It said:\n${said.slice(-600)}`);
  try {
    const deadline = Date.now() + 200_000;
    for (;;) {
      if (alive()) assert.fail(`the server stopped before it answered: ${alive()}`);
      try {
        if ((await get(port, "/blank")).status === 200) break;
      } catch {}
      if (Date.now() > deadline) assert.fail(`the server did not answer in time. It said:\n${said.slice(-600)}`);
      await pause(100);
    }
    await use(port, alive);
  } finally {
    child.kill("SIGKILL");
  }
}

async function stillAnswers(port, alive, after) {
  await pause(50);
  assert.equal(alive(), "", `after ${after}: ${alive()}`);
  assert.equal((await get(port, "/blank")).status, 200, `after ${after}, /blank does not answer`);
  assert.equal((await get(port, "/nullpad.css")).status, 200, `after ${after}, /nullpad.css does not answer`);
}

const slow = { timeout: 300_000 };

describe("a request the server cannot answer", () => {
  test("a path of two slashes gets an error status, and the server goes on", slow, async () => {
    await serving(async (port, alive) => {
      const answer = await get(port, "//").catch((error) => ({ status: error.code }));
      assert.ok([400, 404].includes(answer.status), `GET // got ${answer.status}`);
      await stillAnswers(port, alive, "GET //");
    });
  });

  test("a percent escape that is not text gets an error status, and the server goes on", slow, async () => {
    await serving(async (port, alive) => {
      const answer = await get(port, "/%E0%A4%A").catch((error) => ({ status: error.code }));
      assert.ok([400, 404].includes(answer.status), `GET /%E0%A4%A got ${answer.status}`);
      await stillAnswers(port, alive, "a bad percent escape");
    });
  });

  test("a directory and a path that is no file get a 404, and the server goes on", slow, async () => {
    await serving(async (port, alive) => {
      for (const path of ["/nullpad/", "/nope.mjs", "/%00", `/${"a".repeat(5000)}`]) {
        const answer = await get(port, path).catch((error) => ({ status: error.code }));
        assert.ok([400, 404, 414].includes(answer.status), `GET ${path.slice(0, 40)} got ${answer.status}`);
        await stillAnswers(port, alive, `GET ${path.slice(0, 40)}`);
      }
    });
  });

  test("a file the server has no content type for is sent as bytes, and the server goes on", slow, async () => {
    await serving(async (port, alive) => {
      for (const [name, text] of Object.entries(planted)) {
        const answer = await get(port, `/${plant.slice(built.length + 1)}/${name}`).catch((error) => ({ status: error.code }));
        assert.equal(answer.status, 200, `GET ${name} got ${answer.status}`);
        assert.equal(answer.type, "application/octet-stream", `GET ${name} was sent as ${answer.type}`);
        assert.equal(answer.body, text);
        await stillAnswers(port, alive, `GET ${name}`);
      }
    });
  });

  test("both at once, one after the other: the server still answers every later request", slow, async () => {
    await serving(async (port, alive) => {
      await get(port, "//").catch(() => {});
      await get(port, `/${plant.slice(built.length + 1)}/.cache_meta`).catch(() => {});
      for (let round = 0; round < 3; round++) await stillAnswers(port, alive, `both bad requests, round ${round + 1}`);
    });
  });

  test("a page and a stylesheet and a module are still sent with their own types", slow, async () => {
    await serving(async (port) => {
      assert.equal((await get(port, "/")).type, "text/html");
      assert.equal((await get(port, "/blank")).type, "text/html");
      assert.equal((await get(port, "/nullpad.css")).type, "text/css");
      assert.equal((await get(port, "/nullpad/nullpad.mjs")).type, "text/javascript");
    });
  });
});
