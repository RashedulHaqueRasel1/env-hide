#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { stdout as output, cwd } from "node:process";
import { join } from "node:path";
import { decryptEnv, encryptEnv, parseEncryptedEnv } from "../core/crypto.js";
import { EnvHideError } from "../core/errors.js";
import { attachRecoverySlots, generateRecoveryCodes, recoverPasswordFromSecret } from "../core/recovery.js";
import { ENV_FILENAMES, secretFilename } from "../config/env-files.js";
import {
  atomicWrite,
  ensureEnvIgnored,
  exists,
  ignoredEnvFiles,
  regularReadableFile,
} from "../infrastructure/filesystem.js";
import { password } from "./password.js";

const secretName = secretFilename;
const pathFor = (name: string) => join(cwd(), name);
const usage = `env-hide — encrypt .env and .env.local files for repository storage

Usage: env-hide <command>

Commands:
  init       configure .gitignore for .env and .env.local
  lock       encrypt present environment files into matching .secret files
  unlock     restore present encrypted environment files
  forget     reset the password with an emergency recovery code
  status     show configuration and encryption status
  check      fail if encrypted files are invalid or plaintext files are not ignored
  version    print the version
  help       show this help`;

function ok(message: string): void {
  output.write(`✓ ${message}\n`);
}
async function init(): Promise<void> {
  const added = await ensureEnvIgnored(cwd());
  ok(
    added.length
      ? `Added ${added.join(" and ")} to .gitignore`
      : ".env and .env.local are already ignored",
  );
  output.write(
    "Create .env and/or .env.local, then run env-hide lock to create only the matching .secret file.\n",
  );
}
async function lock(): Promise<void> {
  const sources = (
    await Promise.all(
      ENV_FILENAMES.map(async (name) => ({
        name,
        present: await exists(pathFor(name)),
      })),
    )
  ).filter((item) => item.present);
  if (!sources.length)
    throw new EnvHideError(
      "No .env or .env.local file found.\nRun `env-hide init` or create an environment file first.",
    );
  for (const source of sources)
    await regularReadableFile(
      pathFor(source.name),
      `${source.name} is not readable.`,
    );
  const first = await password("Enter password: "),
    second = await password("Confirm password: ");
  if (first !== second) throw new EnvHideError("Passwords do not match.", 2);
  const encrypted = await Promise.all(
    sources.map(async ({ name }) => {
      const value = await readFile(pathFor(name));
      const secret = await encryptEnv(value, first);
      if (!(await decryptEnv(secret, first)).equals(value))
        throw new EnvHideError("Encryption verification failed.");
      return { name, secret };
    }),
  );
  const codes = generateRecoveryCodes();
  for (const item of encrypted) {
    await atomicWrite(pathFor(secretName(item.name)), await attachRecoverySlots(item.secret, first, codes), 0o600);
    ok(`Encrypted ${item.name} → ${secretName(item.name)}`);
  }
  await ensureEnvIgnored(cwd());
  output.write("\nStore these emergency recovery codes in a password manager. They are shown only once:\n");
  for (const code of codes) output.write(`${code}\n`);
  output.write(
    "You can now commit the generated .secret files to your repository.\n",
  );
}
async function forget(): Promise<void> {
  const sources = (await Promise.all(ENV_FILENAMES.map(async (name) => ({ name, present: await exists(pathFor(secretName(name))) })))).filter((item) => item.present);
  if (!sources.length) throw new EnvHideError("Encrypted environment file not found.");
  const code = await password("Enter recovery code: ");
  const oldPassword = await recoverPasswordFromSecret(await readFile(pathFor(secretName(sources[0]!.name))), code);
  const next = await password("Enter new password: "), confirm = await password("Confirm new password: ");
  if (next !== confirm) throw new EnvHideError("Passwords do not match.", 2);
  const values = await Promise.all(sources.map(async ({ name }) => ({ name, value: await decryptEnv(await readFile(pathFor(secretName(name))), oldPassword) })));
  const codes = generateRecoveryCodes();
  const encrypted = await Promise.all(values.map(async ({ name, value }) => ({ name, secret: await encryptEnv(value, next) })));
  for (const item of encrypted) await atomicWrite(pathFor(secretName(item.name)), await attachRecoverySlots(item.secret, next, codes), 0o600);
  output.write("Password reset. Old recovery codes are revoked. Store these new codes securely:\n");
  for (const nextCode of codes) output.write(`${nextCode}\n`);
}
async function unlock(): Promise<void> {
  const sources = (
    await Promise.all(
      ENV_FILENAMES.map(async (name) => ({
        name,
        present: await exists(pathFor(secretName(name))),
      })),
    )
  ).filter((item) => item.present);
  if (!sources.length)
    throw new EnvHideError(
      "No .env.secret or .env.local.secret file found.\nRun `env-hide lock` first.",
    );
  for (const source of sources)
    await regularReadableFile(
      pathFor(secretName(source.name)),
      `${secretName(source.name)} is not readable.`,
    );
  const entered = await password("Enter password: ");
  const values = await Promise.all(
    sources.map(async ({ name }) => ({
      name,
      value: await decryptEnv(
        await readFile(pathFor(secretName(name))),
        entered,
      ),
    })),
  );
  for (const item of values) {
    await atomicWrite(pathFor(item.name), item.value, 0o600);
    ok(`Restored ${item.name}`);
  }
  await ensureEnvIgnored(cwd());
}
async function status(checkOnly = false): Promise<boolean> {
  const ignored = await ignoredEnvFiles(cwd());
  const states = await Promise.all(
    ENV_FILENAMES.map(async (name) => {
      const secret = secretName(name);
      const secretExists = await exists(pathFor(secret));
      let valid = false;
      if (secretExists)
        try {
          parseEncryptedEnv(await readFile(pathFor(secret)));
          valid = true;
        } catch {
          /* do not reveal content */
        }
      return {
        name,
        secret,
        plain: await exists(pathFor(name)),
        secretExists,
        valid,
        ignored: ignored.includes(name),
      };
    }),
  );
  if (!checkOnly) {
    output.write("Environment status\n\n");
    for (const item of states)
      output.write(
        `${item.name.padEnd(18)} ${item.plain ? "✓ exists" : "– missing"}\n${item.secret.padEnd(18)} ${item.secretExists ? (item.valid ? "✓ encrypted" : "! invalid or plaintext") : "– missing"}\n.gitignore ${item.name.padEnd(8)} ${item.ignored ? "✓ configured" : "! not ignored"}\n\n`,
      );
  }
  return (
    states.some((item) => item.secretExists) &&
    states.filter((item) => item.secretExists).every((item) => item.valid) &&
    states.every((item) => item.ignored)
  );
}
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = args.find((arg) => !arg.startsWith("--")) ?? "help";
  if (args.includes("--version") || command === "version")
    return void output.write("1.0.0\n");
  if (args.includes("--help") || command === "help")
    return void output.write(`${usage}\n`);
  if (command === "init") return init();
  if (command === "lock") return lock();
  if (command === "unlock") return unlock();
  if (command === "forget") return forget();
  if (command === "status") return void (await status());
  if (command === "check") {
    if (!(await status(true)))
      throw new EnvHideError("Environment configuration check failed.");
    return ok("Environment configuration check passed");
  }
  throw new EnvHideError(
    `Unknown command: ${command}\nRun \`env-hide help\` for usage.`,
    2,
  );
}
