import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptionError, EnvHideError } from "./errors.js";

export const FORMAT_HEADER = "ENVHIDE:v2";
const LEGACY_FORMAT_HEADER = "ENVHIDE:v1";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const V1_KDF_OPTIONS = Object.freeze({
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
});
const V2_KDF_OPTIONS = Object.freeze({
  timeCost: 4,
  memoryCost: 131072,
  parallelism: 1,
});
const KDF_LIMITS = Object.freeze({
  minMemoryCost: 65536,
  maxMemoryCost: 262144,
  minTimeCost: 3,
  maxTimeCost: 10,
  minParallelism: 1,
  maxParallelism: 4,
});

type KdfOptions = Readonly<{
  timeCost: number;
  memoryCost: number;
  parallelism: number;
}>;
type EncryptedFields = {
  kdf: "argon2id";
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  data: string;
};
export type EncryptedEnv =
  | (EncryptedFields & { version: 1 })
  | (EncryptedFields & {
      version: 2;
      timeCost: number;
      memoryCost: number;
      parallelism: number;
    });

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length === 0)
    throw new EnvHideError("Password must not be empty.", 2);
}
function encode(value: Buffer): string {
  return value.toString("base64");
}
function decode(value: string): Buffer {
  if (
    value !== "" &&
    (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0)
  )
    throw new DecryptionError();
  return Buffer.from(value, "base64");
}
function validateBinaryFields(value: EncryptedFields): void {
  if (
    decode(value.salt).length !== SALT_BYTES ||
    decode(value.iv).length !== IV_BYTES ||
    decode(value.tag).length !== TAG_BYTES
  )
    throw new DecryptionError();
}
function validateV2Kdf(options: KdfOptions): void {
  const { memoryCost, timeCost, parallelism } = options;
  if (
    !Number.isInteger(memoryCost) ||
    !Number.isInteger(timeCost) ||
    !Number.isInteger(parallelism) ||
    memoryCost < KDF_LIMITS.minMemoryCost ||
    memoryCost > KDF_LIMITS.maxMemoryCost ||
    timeCost < KDF_LIMITS.minTimeCost ||
    timeCost > KDF_LIMITS.maxTimeCost ||
    parallelism < KDF_LIMITS.minParallelism ||
    parallelism > KDF_LIMITS.maxParallelism
  )
    throw new DecryptionError();
}
async function deriveKey(
  password: string,
  salt: Buffer,
  options: KdfOptions,
): Promise<Buffer> {
  const { timeCost, memoryCost, parallelism } = options;
  return argon2.hash(password, {
    type: argon2.argon2id,
    salt,
    hashLength: KEY_BYTES,
    raw: true,
    timeCost,
    memoryCost,
    parallelism,
  }) as Promise<Buffer>;
}
function metadata(value: Extract<EncryptedEnv, { version: 2 }>): Buffer {
  return Buffer.from(
    `${FORMAT_HEADER}\nkdf=${value.kdf}\ncipher=${value.cipher}\nmemoryCost=${value.memoryCost}\ntimeCost=${value.timeCost}\nparallelism=${value.parallelism}\nsalt=${value.salt}\niv=${value.iv}\n`,
    "utf8",
  );
}

/** Encrypt content using ENVHIDE:v2 with authenticated metadata and stronger Argon2id defaults. */
export async function encryptEnv(
  input: string | Buffer,
  password: string,
): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, V2_KDF_OPTIONS);
  try {
    const partial = {
      version: 2 as const,
      kdf: "argon2id" as const,
      cipher: "aes-256-gcm" as const,
      ...V2_KDF_OPTIONS,
      salt: encode(salt),
      iv: encode(iv),
    };
    const cipher = createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(metadata({ ...partial, tag: "", data: "" }));
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    return serializeEncryptedEnv({
      ...partial,
      tag: encode(cipher.getAuthTag()),
      data: encode(ciphertext),
    });
  } finally {
    key.fill(0);
  }
}

/** Decrypt v1 and v2 values. V2 metadata is authenticated before plaintext is returned. */
export async function decryptEnv(
  encrypted: string | Buffer,
  password: string,
): Promise<Buffer> {
  validatePassword(password);
  const parsed = parseEncryptedEnv(encrypted);
  try {
    const salt = decode(parsed.salt),
      iv = decode(parsed.iv),
      tag = decode(parsed.tag),
      data = decode(parsed.data);
    const options = parsed.version === 1 ? V1_KDF_OPTIONS : parsed;
    const key = await deriveKey(password, salt, options);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: TAG_BYTES,
      });
      if (parsed.version === 2) decipher.setAAD(metadata(parsed));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } finally {
      key.fill(0);
    }
  } catch (error) {
    if (error instanceof EnvHideError && !(error instanceof DecryptionError))
      throw error;
    throw new DecryptionError();
  }
}

export function serializeEncryptedEnv(value: EncryptedEnv): string {
  if (value.version === 1)
    return `${LEGACY_FORMAT_HEADER}\nkdf=${value.kdf}\ncipher=${value.cipher}\nsalt=${value.salt}\niv=${value.iv}\ntag=${value.tag}\ndata=${value.data}\n`;
  return `${FORMAT_HEADER}\nkdf=${value.kdf}\ncipher=${value.cipher}\nmemoryCost=${value.memoryCost}\ntimeCost=${value.timeCost}\nparallelism=${value.parallelism}\nsalt=${value.salt}\niv=${value.iv}\ntag=${value.tag}\ndata=${value.data}\n`;
}

export function parseEncryptedEnv(encrypted: string | Buffer): EncryptedEnv {
  const text = Buffer.isBuffer(encrypted)
    ? encrypted.toString("utf8")
    : encrypted;
  const lines = text.split("\n");
  const header = lines[0]?.replace(/\r$/, "");
  if (header !== LEGACY_FORMAT_HEADER && header !== FORMAT_HEADER)
    throw new DecryptionError();
  const fields = new Map<string, string>();
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || fields.has(line.slice(0, separator)))
      throw new DecryptionError();
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const base = ["kdf", "cipher", "salt", "iv", "tag", "data"] as const;
  const v2 = [
    "kdf",
    "cipher",
    "memoryCost",
    "timeCost",
    "parallelism",
    "salt",
    "iv",
    "tag",
    "data",
  ] as const;
  const required = header === FORMAT_HEADER ? v2 : base;
  const recoveryFields = Array.from({ length: 3 }, (_, index) => [`slot${index + 1}Salt`, `slot${index + 1}Iv`, `slot${index + 1}Tag`, `slot${index + 1}Data`]).flat();
  const hasRecovery = header === FORMAT_HEADER && recoveryFields.every((field) => fields.has(field));
  if (
    fields.size !== required.length + (hasRecovery ? recoveryFields.length : 0) ||
    required.some((field) => !fields.has(field)) ||
    fields.get("kdf") !== "argon2id" ||
    fields.get("cipher") !== "aes-256-gcm"
  )
    throw new DecryptionError();
  const common: EncryptedFields = {
    kdf: "argon2id",
    cipher: "aes-256-gcm",
    salt: fields.get("salt")!,
    iv: fields.get("iv")!,
    tag: fields.get("tag")!,
    data: fields.get("data")!,
  };
  validateBinaryFields(common);
  if (header === LEGACY_FORMAT_HEADER) return { version: 1, ...common };
  const output = {
    version: 2 as const,
    ...common,
    memoryCost: Number(fields.get("memoryCost")),
    timeCost: Number(fields.get("timeCost")),
    parallelism: Number(fields.get("parallelism")),
  };
  validateV2Kdf(output);
  return output;
}

export { DecryptionError, EnvHideError };
