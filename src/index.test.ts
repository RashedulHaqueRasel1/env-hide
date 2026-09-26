import assert from "node:assert/strict";
import test from "node:test";
import { decryptEnv, encryptEnv, parseEncryptedEnv, DecryptionError, EnvHideError } from "./index.js";

const password = "🔐 long-password-with-unicode-秘密";
test("round trips exact environment content", async () => {
  for (const content of ["", "A=1\nMULTI='one\\ntwo'\nUNICODE=☃\n", "KEY=\"!@#$%^&*()\"\n".repeat(1000)]) {
    const secret = await encryptEnv(content, password);
    assert.equal((await decryptEnv(secret, password)).toString(), content);
    assert.ok(!secret.includes("MULTI='one"));
  }
});
test("uses distinct random salt and iv", async () => assert.notEqual(await encryptEnv("A=1", password), await encryptEnv("A=1", password)));
test("rejects wrong or empty passwords", async () => { const secret = await encryptEnv("A=1", password); await assert.rejects(decryptEnv(secret, "wrong"), DecryptionError); await assert.rejects(encryptEnv("A=1", ""), EnvHideError); });
test("fails safely for tampering and malformed inputs", async () => { const secret = await encryptEnv("A=1", password); for (const bad of [secret.replace("data=", "data=A"), secret.replace("iv=", "iv=A"), secret.replace("tag=", "tag=A"), secret.replace("salt=", "salt=A"), "ENVHIDE:v2", secret.slice(0, -10)]) await assert.rejects(decryptEnv(bad, password), DecryptionError); assert.throws(() => parseEncryptedEnv("plain secrets"), DecryptionError); });
