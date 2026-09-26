import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Adds .env and .env.local to the consuming project's .gitignore after a local npm install.
 * This intentionally never runs for a global install and never removes or
 * rewrites existing ignore rules.
 */
async function addEnvIgnoreRule(): Promise<void> {
  if (process.env.npm_config_global === "true") return;
  const projectDirectory = process.env.INIT_CWD;
  if (!projectDirectory) return;
  const ignorePath = join(resolve(projectDirectory), ".gitignore");
  try {
    const current = await readFile(ignorePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    const missing = [".env", ".env.local"].filter((name) => !lines.includes(name));
    if (missing.length === 0) return;
    await mkdir(dirname(ignorePath), { recursive: true });
    const newline = current && !current.endsWith("\n") ? "\n" : "";
    await writeFile(ignorePath, `${current}${newline}${missing.join("\n")}\n`, { mode: 0o644 });
  } catch {
    // Installation must not fail because a caller cannot edit .gitignore.
    // The `env-hide init` command remains available to configure it manually.
  }
}

void addEnvIgnoreRule();
