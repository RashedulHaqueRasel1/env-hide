#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, cwd } from "node:process";
import { join } from "node:path";
import { decryptEnv, encryptEnv, parseEncryptedEnv, EnvHideError } from "./index.js";
import { atomicWrite, ensureEnvIgnored, ENV_FILENAMES, exists, ignoredEnvFiles, regularReadableFile } from "./files.js";

type EnvName = typeof ENV_FILENAMES[number];
const secretName = (name: EnvName) => `${name}.secret`;
const pathFor = (name: string) => join(cwd(), name);
const usage = `env-hide — encrypt .env and .env.local files for repository storage

Usage: env-hide <command>

Commands:
  init       configure .gitignore for .env and .env.local
  lock       encrypt present environment files into matching .secret files
  unlock     restore present encrypted environment files
  status     show configuration and encryption status
  check      fail if encrypted files are invalid or plaintext files are not ignored
  version    print the version
  help       show this help`;

async function password(prompt: string): Promise<string> {
  if (!input.isTTY) throw new EnvHideError("A TTY is required to enter a password securely.", 2);
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    const target = rl as unknown as { _writeToOutput?: (text: string) => void };
    const original = target._writeToOutput;
    target._writeToOutput = (text) => { if (/password/i.test(text)) output.write(text); else output.write("*"); };
    rl.question(prompt, (answer) => { target._writeToOutput = original; rl.close(); resolve(answer); });
    rl.on("SIGINT", () => { rl.close(); reject(new EnvHideError("Operation cancelled.")); });
  });
}
function ok(message: string): void { output.write(`✓ ${message}\n`); }
async function init(): Promise<void> {
  const added = await ensureEnvIgnored(cwd());
  ok(added.length ? `Added ${added.join(" and ")} to .gitignore` : ".env and .env.local are already ignored");
  output.write("Create .env and/or .env.local, then run env-hide lock to create only the matching .secret file.\n");
}
async function lock(): Promise<void> {
  const sources = (await Promise.all(ENV_FILENAMES.map(async (name) => ({ name, present: await exists(pathFor(name)) })))).filter((item) => item.present);
  if (!sources.length) throw new EnvHideError("No .env or .env.local file found.\nRun `env-hide init` or create an environment file first.");
  for (const source of sources) await regularReadableFile(pathFor(source.name), `${source.name} is not readable.`);
  const first = await password("Enter password: "), second = await password("Confirm password: ");
  if (first !== second) throw new EnvHideError("Passwords do not match.", 2);
  const encrypted = await Promise.all(sources.map(async ({ name }) => { const value = await readFile(pathFor(name)); const secret = await encryptEnv(value, first); if (!(await decryptEnv(secret, first)).equals(value)) throw new EnvHideError("Encryption verification failed."); return { name, secret }; }));
  for (const item of encrypted) { await atomicWrite(pathFor(secretName(item.name)), item.secret, 0o600); ok(`Encrypted ${item.name} → ${secretName(item.name)}`); }
  await ensureEnvIgnored(cwd());
  output.write("You can now commit the generated .secret files to your repository.\n");
}
async function unlock(): Promise<void> {
  const sources = (await Promise.all(ENV_FILENAMES.map(async (name) => ({ name, present: await exists(pathFor(secretName(name))) })))).filter((item) => item.present);
  if (!sources.length) throw new EnvHideError("No .env.secret or .env.local.secret file found.\nRun `env-hide lock` first.");
  for (const source of sources) await regularReadableFile(pathFor(secretName(source.name)), `${secretName(source.name)} is not readable.`);
  const entered = await password("Enter password: ");
  const values = await Promise.all(sources.map(async ({ name }) => ({ name, value: await decryptEnv(await readFile(pathFor(secretName(name))), entered) })));
  for (const item of values) { await atomicWrite(pathFor(item.name), item.value, 0o600); ok(`Restored ${item.name}`); }
  await ensureEnvIgnored(cwd());
}
async function status(checkOnly = false): Promise<boolean> {
  const ignored = await ignoredEnvFiles(cwd());
  const states = await Promise.all(ENV_FILENAMES.map(async (name) => { const secret = secretName(name); const secretExists = await exists(pathFor(secret)); let valid = false; if (secretExists) try { parseEncryptedEnv(await readFile(pathFor(secret))); valid = true; } catch { /* do not reveal content */ } return { name, secret, plain: await exists(pathFor(name)), secretExists, valid, ignored: ignored.includes(name) }; }));
  if (!checkOnly) { output.write("Environment status\n\n"); for (const item of states) output.write(`${item.name.padEnd(18)} ${item.plain ? "✓ exists" : "– missing"}\n${item.secret.padEnd(18)} ${item.secretExists ? (item.valid ? "✓ encrypted" : "! invalid or plaintext") : "– missing"}\n.gitignore ${item.name.padEnd(8)} ${item.ignored ? "✓ configured" : "! not ignored"}\n\n`); }
  return states.some((item) => item.secretExists) && states.filter((item) => item.secretExists).every((item) => item.valid) && states.every((item) => item.ignored);
}
async function main(): Promise<void> {
  const command = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "help";
  if (process.argv.includes("--version") || command === "version") return void output.write("1.0.0\n");
  if (process.argv.includes("--help") || command === "help") return void output.write(`${usage}\n`);
  if (command === "init") return init(); if (command === "lock") return lock(); if (command === "unlock") return unlock(); if (command === "status") return void await status();
  if (command === "check") { if (!(await status(true))) throw new EnvHideError("Environment configuration check failed."); return ok("Environment configuration check passed"); }
  throw new EnvHideError(`Unknown command: ${command}\nRun \`env-hide help\` for usage.`, 2);
}
main().catch((error: unknown) => { const known = error instanceof EnvHideError; output.write(`✗ ${known ? error.message : "Operation failed."}\n`); if (!known && process.argv.includes("--debug")) console.error(error); process.exitCode = known ? error.exitCode : 1; });
