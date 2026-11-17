import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function appears(file, ended, limitMs) {
  const until = Date.now() + limitMs;
  while (!existsSync(file)) {
    if (ended() !== null) throw new Error(`the command ended (${ended()}) before it wrote ${file}`);
    if (Date.now() > until) throw new Error(`${file} did not appear in ${limitMs} ms`);
    await pause(25);
  }
  await pause(25);
  return readFileSync(file, "utf8");
}

export async function interrupted({ argv, cwd, mark, signal, env = {}, limitMs = 30_000 }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let ended = null;
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const done = new Promise((finish) =>
    child.on("close", (code, by) => {
      ended = by ?? code;
      finish({ code, by });
    }),
  );
  try {
    const held = await appears(mark, () => ended, limitMs);
    child.kill(signal);
    const result = await Promise.race([done, pause(limitMs).then(() => ({ code: null, by: "no exit within the limit" }))]);
    return { ...result, output, held };
  } finally {
    child.kill("SIGKILL");
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function gone(pid, limitMs = 5_000) {
  const until = Date.now() + limitMs;
  while (alive(pid) && Date.now() < until) await pause(25);
  return !alive(pid);
}
