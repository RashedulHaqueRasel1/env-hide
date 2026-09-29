# env-hide

Encrypt `.env` and `.env.local` before committing their encrypted counterparts to Git.

`env-hide` keeps plaintext environment files local and turns them into authenticated, versioned `.secret` files that can live in a public repository. It uses Argon2id and AES-256-GCM, includes emergency recovery codes, and supports safe password rotation.

> An encrypted file is only as safe as its password and recovery codes. Use long, unique secrets from a password manager.

## Features

- Encrypts `.env` → `.env.secret` and `.env.local` → `.env.local.secret`
- Uses Argon2id key derivation and AES-256-GCM authenticated encryption
- Uses fresh random salts and IVs for every encryption
- Generates three high-entropy emergency recovery codes at `lock` time
- Resets a forgotten password with `env-hide forget`
- Prevents partial restore: all files must decrypt before plaintext is written
- Uses atomic file writes with restrictive `0600` permissions
- Supports legacy `ENVHIDE:v1` files and writes stronger `ENVHIDE:v2` files
- Provides `status` and CI-friendly `check` commands

## Requirements

- Node.js 20 or later
- npm 9 or later recommended

## Install

Install in the project that owns the environment files:

```bash
npm install --save-dev env-hide
```

The install hook attempts to add `.env` and `.env.local` to the consuming project's `.gitignore`. If npm install scripts are disabled, run:

```bash
npx env-hide init
```

## Quick start

```bash
# Ensure plaintext files are ignored by Git
npx env-hide init

# Create one or both local plaintext files
printf 'DATABASE_URL=postgres://localhost/app\n' > .env
printf 'LOG_LEVEL=debug\n' > .env.local

# Encrypt every plaintext file that exists
npx env-hide lock
```

`lock` asks for a password twice. On success, it prints three recovery codes once. Save them in a password manager before closing the terminal.

Commit only the encrypted files:

```bash
git add .gitignore .env.secret .env.local.secret
git commit -m "Add encrypted environment configuration"
```

Another authorised developer can clone the repository and restore the files:

```bash
npm install
npx env-hide unlock
```

## Commands

| Command | Description |
| --- | --- |
| `npx env-hide init` | Adds `.env` and `.env.local` to `.gitignore`. |
| `npx env-hide lock` | Encrypts present plaintext files and creates three recovery codes. |
| `npx env-hide unlock` | Restores available `.secret` files with the main password. |
| `npx env-hide forget` | Uses one recovery code to set a new password and new recovery codes. |
| `npx env-hide status` | Reports plaintext, encrypted-file, and ignore-rule status. |
| `npx env-hide check` | Returns non-zero if ignore rules or encrypted-file format are invalid. |
| `npx env-hide help` | Shows command help. |
| `npx env-hide version` | Prints the installed version. |

### File mapping

```text
.env exists        → .env.secret
.env.local exists  → .env.local.secret
```

`lock` processes only files that exist. It does not remove or modify plaintext files. Before writing a `.secret` file, it decrypts the new value in memory and verifies an exact byte-for-byte match.

## Emergency recovery codes

Every successful `lock` creates three random emergency codes, similar to:

```text
envhide-<random-value>
```

The same three codes work for both `.env.secret` and `.env.local.secret`. Their encrypted recovery slots are embedded directly in each `.secret` file; no additional recovery file is created or committed.

If the main password is forgotten:

```bash
npx env-hide forget
```

Enter one recovery code, choose a new password, and save the newly displayed recovery codes. The current files are re-encrypted and the old recovery codes are replaced.

### Recovery-code rules

- Treat a recovery code like the main password.
- Store codes in a password manager or approved team vault.
- Never put codes in Git, `.env`, chat, screenshots, or a plaintext note.
- A locally stored encrypted file cannot enforce global one-time use: an old Git revision or copied file can contain old recovery slots. For globally enforced one-time codes, use a central service or KMS.

## Security model

New encrypted files use this text format:

```text
ENVHIDE:v2
kdf=argon2id
cipher=aes-256-gcm
memoryCost=131072
timeCost=4
parallelism=1
salt=<base64>
iv=<base64>
tag=<base64>
data=<base64>
slot1Salt=<base64>
slot1Iv=<base64>
slot1Tag=<base64>
slot1Data=<base64>
... slot2 and slot3
```

The main encryption flow is:

```text
password + random 16-byte salt
              ↓
Argon2id (128 MiB memory, time cost 4, parallelism 1)
              ↓
256-bit key
              ↓
AES-256-GCM + random 12-byte IV
              ↓
encrypted file + 128-bit authentication tag
```

Salt, IV, tags, and Base64 values are not passwords. Base64 is an encoding, not encryption. The AES-GCM tag detects modification; v2 also authenticates its main KDF metadata.

### What it protects

- Accidental plaintext `.env` and `.env.local` commits when Git ignore rules are followed
- Repository readers who do not know the password or recovery code
- Tampering with encrypted data

### What it does not protect

- Weak, reused, exposed, or guessable passwords
- A leaked recovery code
- A compromised machine while plaintext files are present
- Secrets copied to logs, screenshots, backups, shell history, or earlier Git commits
- An attacker with unlimited offline guesses against a public encrypted file

Public source code and public `.secret` files are acceptable: cryptographic formats do not need to be hidden. Use a password-manager-generated password of at least 20 characters or a long random passphrase.

### If a password or code leaks

1. Rotate the actual API keys, database passwords, tokens, and other values inside the environment files.
2. Run `npx env-hide lock` with a new password.
3. Store the newly generated recovery codes securely.
4. Commit the newly encrypted files.

Changing only the encryption password does not protect secrets in an older Git revision that an attacker already decrypted.

## Git safety

Never commit plaintext files:

```text
.env
.env.local
```

Check whether they are tracked:

```bash
git ls-files .env .env.local
```

No output is the expected result. If files appear, remove them from the index and rotate exposed secrets:

```bash
git rm --cached --ignore-unmatch .env .env.local
git commit -m "Remove plaintext environment files"
```

This repository includes a local `.githooks/pre-push` guard and a GitHub Actions `env-guard` workflow. Repository maintainers should enable the local guard once:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

For enforced remote protection, make the `env-guard` status check required in the GitHub branch ruleset and restrict bypass permissions. Local hooks alone can be bypassed with `--no-verify` or by changing local Git configuration.

## Status and automation

```bash
npx env-hide status
npx env-hide check
```

`check` does not ask for a password and does not decrypt secrets. It exits with `0` only when at least one encrypted file exists, all present encrypted files have a valid format, and both plaintext filenames are ignored.

## Programmatic API

```ts
import { decryptEnv, encryptEnv } from "env-hide";

const encrypted = await encryptEnv("API_KEY=example\n", password);
const plaintext = await decryptEnv(encrypted, password); // Buffer
```

`decryptEnv` returns a `Buffer` so plaintext handling stays explicit. Do not log passwords, plaintext buffers, or environment-file contents.

## Troubleshooting

### `.env` is not ignored

```bash
npx env-hide init
```

### `Invalid password or corrupted secret file.`

Use the exact password used during `lock`. If the password is correct, restore a trusted encrypted revision or backup. Do not manually edit `.secret` files.

### No recovery code is available

Files created before recovery support do not contain recovery slots. If the main password is also lost, decryption is impossible. If you still know the password, run `npx env-hide lock` again to create recovery slots.

### `npx env-hide` runs an unexpected version

Build and run local source directly when developing this repository:

```bash
npm run build
node dist/cli.js help
```

## Development and release

```bash
npm ci
npm test
npm pack --dry-run
npm publish --dry-run
```

Publish for real only after reviewing the package contents:

```bash
npm login
npm publish
```

## Author

**Rashedul Haque Rasel**

- Email: [rashedulhaquerasel1@gmail.com](mailto:rashedulhaquerasel1@gmail.com)
- GitHub: [RashedulHaqueRasel1](https://github.com/RashedulHaqueRasel1/)
- Portfolio: [rashedul-haque-rasel.vercel.app](https://rashedul-haque-rasel.vercel.app)
