import assert from "node:assert/strict";
import argon2 from "argon2";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import {
  decryptEnv,
  encryptEnv,
  parseEncryptedEnv,
  serializeEncryptedEnv,
  DecryptionError,
  EnvHideError,
} from "../core/crypto.js";

const password = "🔐 long-password-with-unicode-秘密";
test("round trips exact environment content", async () => {
  for (const content of [
    "",
    "A=1\nMULTI='one\\ntwo'\nUNICODE=☃\n",
    'KEY="!@#$%^&*()"\n'.repeat(1000),
  ]) {
    const secret = await encryptEnv(content, password);
    assert.equal((await decryptEnv(secret, password)).toString(), content);
    assert.ok(!secret.includes("MULTI='one"));
  }
});
test("uses distinct random salt and iv", async () =>
  assert.notEqual(
    await encryptEnv("A=1", password),
    await encryptEnv("A=1", password),
  ));
test("writes v2 with stronger KDF parameters and authenticated metadata", async () => {
  const secret = await encryptEnv("A=1", password);
  assert.match(secret, /^ENVHIDE:v2\n/);
  assert.match(secret, /memoryCost=131072\ntimeCost=4\nparallelism=1\n/);
  assert.equal(parseEncryptedEnv(secret).version, 2);
  await assert.rejects(
    decryptEnv(secret.replace("timeCost=4", "timeCost=5"), password),
    DecryptionError,
  );
});
test("decrypts legacy v1 files", async () => {
  const salt = Buffer.alloc(16, 7);
  const iv = Buffer.alloc(12, 9);
  const input = Buffer.from("LEGACY=yes\n");
  const key = (await argon2.hash(password, {
    type: argon2.argon2id, salt, hashLength: 32, raw: true, timeCost: 3, memoryCost: 65536, parallelism: 1,
  })) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const data = Buffer.concat([cipher.update(input), cipher.final()]);
  key.fill(0);
  const legacy = serializeEncryptedEnv({ version: 1, kdf: "argon2id", cipher: "aes-256-gcm", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
  assert.equal((await decryptEnv(legacy, password)).toString(), input.toString());
});
test("rejects wrong or empty passwords", async () => {
  const secret = await encryptEnv("A=1", password);
  await assert.rejects(decryptEnv(secret, "wrong"), DecryptionError);
  await assert.rejects(encryptEnv("A=1", ""), EnvHideError);
});
test("fails safely for tampering and malformed inputs", async () => {
  const secret = await encryptEnv("A=1", password);
  for (const bad of [
    secret.replace("data=", "data=A"),
    secret.replace("iv=", "iv=A"),
    secret.replace("tag=", "tag=A"),
    secret.replace("salt=", "salt=A"),
    "ENVHIDE:v2",
    secret.slice(0, -10),
  ])
    await assert.rejects(decryptEnv(bad, password), DecryptionError);
  assert.throws(() => parseEncryptedEnv("plain secrets"), DecryptionError);
});
