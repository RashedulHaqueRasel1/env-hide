# env-hide

Encrypt `.env` and `.env.local` files before committing them to Git.

`env-hide` keeps plaintext environment files out of version control and creates encrypted counterparts that a team can commit safely.

| Plaintext (ignored by Git) | Encrypted (commit to Git) |
| --- | --- |
| `.env` | `.env.secret` |
| `.env.local` | `.env.local.secret` |

It uses **Argon2id** to derive an encryption key from a password and **AES-256-GCM** to encrypt and authenticate the complete file. Passwords, keys, and plaintext secret values are never written to an encrypted file or printed by the CLI.

## Requirements

- Node.js 20 or newer
- npm 9 or newer recommended

## Install

Install it in the project that owns your environment files:

```bash
npm install --save-dev env-hide
```

On a normal local install, `env-hide` automatically adds `.env` and `.env.local` to that project's `.gitignore` when absent. Existing ignore rules remain unchanged. It intentionally does not ignore `.env.secret` or `.env.local.secret`, because those are the files you commit.

> If your npm configuration disables install scripts, run `npx env-hide init` once after installation.

## Quick start

```bash
# Configure Git ignore rules (safe to run more than once)
npx env-hide init

# Create one or both plaintext files
printf 'DATABASE_URL=postgres://localhost/app\n' > .env
printf 'LOG_LEVEL=debug\n' > .env.local

# Encrypt every plaintext environment file that exists
npx env-hide lock

# Commit only encrypted files and .gitignore
git add .gitignore .env.secret .env.local.secret
git commit -m "Add encrypted environment configuration"
```

Another authorised developer can restore the files after cloning:

```bash
npm install
npx env-hide unlock
```

## Commands

| Command | Description |
| --- | --- |
| `npx env-hide init` | Adds `.env` and `.env.local` to `.gitignore`; it does not create empty encrypted files. |
| `npx env-hide lock` | Encrypts each present plaintext file into its matching `.secret` file. |
| `npx env-hide unlock` | Restores each present encrypted file as its matching plaintext file. |
| `npx env-hide status` | Shows file presence, ignore configuration, and encrypted-format status. |
| `npx env-hide check` | Returns non-zero when configuration needs attention; suited to CI. |
| `npx env-hide help` | Shows command help. |
| `npx env-hide version` | Prints the installed package version. |

### File mapping

`lock` processes only plaintext files that exist:

```text
.env exists        → creates or updates .env.secret
.env.local exists  → creates or updates .env.local.secret
```

Before replacing an encrypted file, `env-hide` decrypts the newly generated value in memory and verifies it exactly matches the source. It never deletes or modifies `.env` or `.env.local` during `lock`.

### Safe unlock behavior

`unlock` decrypts every available encrypted file before writing any plaintext file. If any file fails authentication, no plaintext file is written or overwritten. A wrong password and a corrupted file intentionally produce the same message:

```text
Invalid password or corrupted secret file.
```

## Status and CI checks

For a human-readable local report:

```bash
npx env-hide status
```

For CI or a pre-commit script:

```bash
npx env-hide check
```

`check` exits with `0` when setup is valid and `1` when an encrypted file is missing/invalid or a plaintext environment file is not ignored. It does not ask for a password and does not decrypt secrets.

## Git workflow

### Plaintext push protection

This repository includes a Git pre-push guard. Enable it once after cloning:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

The guard blocks a push when `.env` or `.env.local` is tracked, or either required
ignore rule has been removed. A matching GitHub Actions check is included in this
repository. To make the remote check mandatory, configure it as a required status
check in the repository's protected-branch rules.

Commit encrypted files:

```bash
git add .gitignore .env.secret .env.local.secret
```

Never commit these plaintext files:

```text
.env
.env.local
```

Adding a file to `.gitignore` does not remove it from existing Git history. If plaintext credentials were previously committed, revoke or rotate them and follow your organisation's Git-history remediation procedure.

## Security model

Every `lock` creates fresh random values:

```text
password + random 16-byte salt
              ↓
         Argon2id
              ↓
        256-bit key
              ↓
AES-256-GCM + random 12-byte IV
              ↓
       encrypted file
```

New encrypted files use the versioned, machine-readable `v2` format:

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
```

Salt and IV are not secret. Base64 is binary-to-text encoding, not encryption. AES-GCM authentication detects changes to the protected data.
The v2 metadata, including its KDF settings, is authenticated by AES-GCM. `unlock` remains compatible with legacy `ENVHIDE:v1` files; run `lock` again after a successful unlock to migrate them to v2.

### What it protects

- Accidental plaintext `.env` or `.env.local` commits.
- Repository readers who do not know the password.
- Undetected modification of an encrypted file.

### What it does not protect

- A compromised computer while plaintext files are present.
- Anyone who knows the encryption password.
- Secrets leaked through logs, backups, screenshots, shell history, or old Git commits.
- Weak or reused passwords.

Use a long, unique password stored in an approved password manager. Share it through a controlled team vault, never through Git or ordinary chat. Password recovery is not possible; without the password, encrypted files cannot be decrypted.

When a former team member knew the password, rotate the actual secrets inside the files (database password, API keys, JWT secret, and so on), then lock again with a new password.

## Programmatic API

```ts
import { decryptEnv, encryptEnv } from "env-hide";

const encrypted = await encryptEnv("API_KEY=example\n", password);
const plaintext = await decryptEnv(encrypted, password); // Buffer
```

`decryptEnv` returns a `Buffer` so handling plaintext stays explicit. Never log the password, plaintext buffer, or source environment contents.

## Troubleshooting

### Plaintext files are not ignored

```bash
npx env-hide init
```

This appends missing rules without replacing existing `.gitignore` content.

### `Invalid password or corrupted secret file.`

Use the exact password used during `lock`. If the password is correct, restore the encrypted file from a trusted Git revision or backup; do not manually edit a `.secret` file.

### No `.secret` file exists after `init`

This is expected. `init` only configures `.gitignore`. Create `.env` and/or `.env.local`, then run `npx env-hide lock`; it creates only the matching encrypted file or files.

## Development and release checks

From this repository:

```bash
npm test
npm pack --dry-run
npm publish --dry-run
```

The last command validates the release workflow but does not upload the package. For an actual release, log in with `npm login` and then run `npm publish`.

## Author

**Rashedul Haque Rasel**

- Email: [rashedulhaquerasel1@gmail.com](mailto:rashedulhaquerasel1@gmail.com)
- LinkedIn: [Rashedul Haque Rasel](https://www.linkedin.com/in/rashedul-haque-rasel/?isSelfProfile=true)
- GitHub: [RashedulHaqueRasel1](https://github.com/RashedulHaqueRasel1/)
- Portfolio: [rashedul-haque-rasel.vercel.app](https://rashedul-haque-rasel.vercel.app)
