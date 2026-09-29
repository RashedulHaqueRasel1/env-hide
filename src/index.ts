export { decryptEnv, encryptEnv, parseEncryptedEnv, serializeEncryptedEnv, FORMAT_HEADER, DecryptionError, EnvHideError } from "./core/crypto.js";
export type { EncryptedEnv } from "./core/crypto.js";
export { attachRecoverySlots, createRecoveryVault, generateRecoveryCodes, recoverPassword, recoverPasswordFromSecret } from "./core/recovery.js";
