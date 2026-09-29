import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptionError, EnvHideError } from "./errors.js";

const HEADER = "ENVHIDE:recovery:v1";
const OPTIONS = { timeCost: 4, memoryCost: 131072, parallelism: 1 };
const CODE_BYTES = 24;

type Slot = { salt: string; iv: string; tag: string; data: string };
const b64 = (value: Buffer) => value.toString("base64");
const unb64 = (value: string) => Buffer.from(value, "base64");
async function keyFor(code: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(code, { type: argon2.argon2id, salt, hashLength: 32, raw: true, ...OPTIONS }) as Promise<Buffer>;
}

/** Generate high-entropy, URL-safe emergency codes. Display and store them only once. */
export function generateRecoveryCodes(): readonly string[] {
  return Array.from({ length: 3 }, () => `envhide-${randomBytes(CODE_BYTES).toString("base64url")}`);
}

/** Create a shared recovery vault that can unlock the encryption password with any one code. */
export async function createRecoveryVault(password: string, codes: readonly string[]): Promise<string> {
  if (codes.length !== 3 || new Set(codes).size !== 3) throw new EnvHideError("Unable to create recovery codes.");
  const slots: Slot[] = [];
  for (const code of codes) {
    const salt = randomBytes(16), iv = randomBytes(12), key = await keyFor(code, salt);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
      const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
      slots.push({ salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) });
    } finally { key.fill(0); }
  }
  return `${HEADER}\n${slots.flatMap((slot, index) => [`slot${index + 1}Salt=${slot.salt}`, `slot${index + 1}Iv=${slot.iv}`, `slot${index + 1}Tag=${slot.tag}`, `slot${index + 1}Data=${slot.data}`]).join("\n")}\n`;
}

/** Recover the encryption password. A failure intentionally reveals no slot information. */
export async function recoverPassword(vault: string | Buffer, code: string): Promise<string> {
  try {
    const fields = new Map<string, string>();
    const lines = Buffer.isBuffer(vault) ? vault.toString("utf8").split("\n") : vault.split("\n");
    if (lines[0]?.replace(/\r$/, "") !== HEADER || !code.startsWith("envhide-")) throw new DecryptionError();
    for (const raw of lines.slice(1)) { const line = raw.replace(/\r$/, ""); if (!line) continue; const at = line.indexOf("="); if (at < 1 || fields.has(line.slice(0, at))) throw new DecryptionError(); fields.set(line.slice(0, at), line.slice(at + 1)); }
    if (fields.size !== 12) throw new DecryptionError();
    for (let index = 1; index <= 3; index++) {
      const salt = unb64(fields.get(`slot${index}Salt`)!), iv = unb64(fields.get(`slot${index}Iv`)!), tag = unb64(fields.get(`slot${index}Tag`)!), data = unb64(fields.get(`slot${index}Data`)!);
      if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new DecryptionError();
      const key = await keyFor(code, salt);
      try { const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 }); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"); } catch { /* try each slot */ } finally { key.fill(0); }
    }
    throw new DecryptionError();
  } catch { throw new DecryptionError(); }
}

export async function attachRecoverySlots(secret: string, password: string, codes: readonly string[]): Promise<string> {
  const vault = await createRecoveryVault(password, codes);
  return `${secret.trimEnd()}\n${vault.split("\n").slice(1).filter(Boolean).join("\n")}\n`;
}

export async function recoverPasswordFromSecret(secret: string | Buffer, code: string): Promise<string> {
  const text = Buffer.isBuffer(secret) ? secret.toString("utf8") : secret;
  const slots = text.split("\n").filter((line) => /^slot[1-3](Salt|Iv|Tag|Data)=/.test(line));
  return recoverPassword(`${HEADER}\n${slots.join("\n")}\n`, code);
}
