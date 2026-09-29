import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { EnvHideError } from "../core/errors.js";
import { ENV_FILENAMES } from "../config/env-files.js";

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function ensureEnvIgnored(directory: string): Promise<string[]> {
  const path = join(directory, ".gitignore");
  const current = (await exists(path)) ? await readFile(path, "utf8") : "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  const missing = ENV_FILENAMES.filter((name) => !lines.includes(name));
  if (missing.length === 0) return [];
  const suffix = current && !current.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${current}${suffix}${missing.join("\n")}\n`, {
    mode: 0o644,
  });
  return [...missing];
}
export async function ignoredEnvFiles(
  directory: string,
): Promise<readonly string[]> {
  const path = join(directory, ".gitignore");
  if (!(await exists(path))) return [];
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim());
  return ENV_FILENAMES.filter((name) => lines.includes(name));
}
export async function atomicWrite(
  path: string,
  data: string | Buffer,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(
    dirname(path),
    `.${randomBytes(12).toString("hex")}.env-hide.tmp`,
  );
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch {
    await unlink(temp).catch(() => undefined);
    throw new EnvHideError("Unable to safely write output file.");
  }
}
export async function regularReadableFile(
  path: string,
  missingMessage: string,
): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error();
    await access(path, constants.R_OK);
  } catch {
    throw new EnvHideError(missingMessage);
  }
}
