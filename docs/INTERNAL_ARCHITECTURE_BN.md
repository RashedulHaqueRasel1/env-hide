# env-hide: Internal Architecture ও সম্পূর্ণ flow

`env-hide` হলো Node.js/TypeScript CLI। এটি plaintext `.env` ও `.env.local` Git-এর বাইরে রাখে এবং তাদের authenticated encrypted version Git-এ commit করার উপযোগী করে। নতুন encrypted file `ENVHIDE:v2` format ব্যবহার করে এবং একই file-এর মধ্যে emergency recovery slot রাখে।

## 1. Folder ও layer

```text
src/
├── cli.ts                    # executable entry point ও global error boundary
├── index.ts                  # public library exports
├── cli/
│   ├── index.ts              # init, lock, unlock, forget, status, check workflow
│   └── password.ts           # hidden terminal password/recovery-code prompt
├── config/env-files.ts       # .env/.env.local ও matching .secret mapping
├── core/
│   ├── crypto.ts             # ENVHIDE:v1/v2 encrypt, decrypt, parse
│   ├── recovery.ts           # recovery-code create, embed ও password recovery
│   └── errors.ts             # safe user-facing error type
├── infrastructure/filesystem.ts # atomic write ও .gitignore helper
└── scripts/postinstall.ts    # consuming project setup
```

`core/` terminal বা file-system জানে না। `cli/` user interaction ও command flow চালায়। `infrastructure/` disk operation করে। এই separation-এর ফলে cryptography ও CLI আলাদা test করা যায়।

## 2. Build ও published package

`npm run build` আগে পুরোনো `dist/` remove করে, তারপর TypeScript compile করে। `prepack` এবং `prepublishOnly` build চালায়; তাই পুরোনো compiled file publish হওয়ার ঝুঁকি কমে। Published package-এ production dependency শুধু `argon2`।

Repository source চালাতে:

```bash
npm run build
node dist/cli.js help
```

## 3. File mapping ও Git policy

`src/config/env-files.ts`-এ supported plaintext file list আছে:

```text
.env       → .env.secret
.env.local → .env.local.secret
```

`init`, `lock`, এবং `unlock` নিশ্চিত করে যে `.gitignore`-এ `.env` ও `.env.local` আছে। `.secret` file ignore করা হয় না, কারণ সেগুলোই commit করার জন্য। Plaintext আগে Git-এ commit হয়ে থাকলে শুধু ignore rule যথেষ্ট নয়; actual credentials rotate করতে হবে।

## 4. ENVHIDE:v2 file format

সাধারণ base section:

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

এর পরে `lock` recovery enabled file-এ আরও 12টি field যোগ করে:

```text
slot1Salt=<base64>
slot1Iv=<base64>
slot1Tag=<base64>
slot1Data=<base64>
... একইভাবে slot2 ও slot3
```

`slot` নাম শুধু parser-এর label। সেখানে recovery code, main password, বা `.env` plaintext লেখা থাকে না। Base64 encryption নয়; এটি binary bytes text file-এ রাখার encoding।

## 5. Main password encryption flow

`lock`-এ user password থেকে সরাসরি AES key ব্যবহার করা হয় না। প্রতিটি encrypted file-এর জন্য নতুন random 16-byte salt ও 12-byte IV তৈরি হয়।

```text
password + per-file random salt
            ↓
Argon2id: memory 128 MiB, time cost 4, parallelism 1
            ↓
32-byte AES key
            ↓
AES-256-GCM + random IV
            ↓
ciphertext (data) + authentication tag
```

AES-GCM ciphertext পরিবর্তন বা ভুল password ধরতে পারে। v2-তে algorithm, KDF setting, salt ও IV canonical metadata হিসেবে AES-GCM Additional Authenticated Data (AAD)-এর অংশ; এগুলো বদলালেও authentication fail হবে। Derived key ব্যবহার শেষে `fill(0)` দিয়ে buffer পরিষ্কার করার চেষ্টা করা হয়।

বর্তমান Argon2 cost প্রতি active encryption/decryption-এ আনুমানিক 128 MiB RAM চায়। `.env` ও `.env.local` একই সঙ্গে process হলে peak usage বেশি হতে পারে; এটি password guess ধীর করার security trade-off।

## 6. Emergency recovery codes কীভাবে কাজ করে

`lock` সফল হলে 3টি code terminal-এ একবার দেখানো হয়। প্রতিটির format এমন:

```text
envhide-<24 random bytes, base64url>
```

প্রতিটি code-এ 192 bits random entropy থাকে। একই তিনটি code `.env.secret` এবং `.env.local.secret`—দুই file-এর embedded slots-এ ব্যবহার করা হয়।

প্রতিটি slot-এর flow:

```text
recovery code + slot-specific random salt
            ↓
Argon2id: memory 128 MiB, time cost 4
            ↓
slot AES-256-GCM key
            ↓
encrypted copy of the main encryption password
```

অর্থাৎ একটি valid recovery code slot-এর encrypted password খুলতে পারে। এরপর সেই recovered password দিয়েই normal `.env.secret` decrypt করা হয়। Recovery code দিয়ে `.env` plaintext সরাসরি encrypt/decrypt করা হয় না।

Recovery slot নিজস্ব AES-GCM tag দিয়ে authenticated। ভুল code, tampered slot, কিংবা invalid format একই ধরনের safe failure দেয়; কোন slot match করেছে তা message-এ বলা হয় না।

## 7. `lock` command-এর complete flow

```text
node dist/cli.js lock
        ↓
present .env/.env.local খোঁজা ও readable check
        ↓
password + confirmation নেওয়া
        ↓
প্রতিটি plaintext read → ENVHIDE:v2 encrypt
        ↓
memory-তে decrypt করে byte-for-byte verification
        ↓
এক সেট 3টি recovery code generate
        ↓
প্রতিটি .secret file-এ একই codes-এর 3টি encrypted slot embed
        ↓
atomic write (0600 permission)
        ↓
terminal-এ code মাত্র একবার print
```

Codes password manager-এ save করতে হবে। এগুলো Git, `.env`, ordinary chat, screenshot, বা shell command-এ রাখা যাবে না। Generated `.secret` file-ই commit করতে হবে; আলাদা recovery file নেই।

## 8. `unlock` command-এর flow

```text
node dist/cli.js unlock
        ↓
সব available .secret file খোঁজা
        ↓
main password নেওয়া
        ↓
সব file memory-তে decrypt করা
        ↓
সবগুলো সফল হলে তবেই atomic write করে plaintext restore
```

একটি file-ও decrypt না হলে কোনো plaintext output write করা হয় না। ভুল password এবং corrupted/tampered file একই `Invalid password or corrupted secret file.` error দেয়।

## 9. `forget` password-reset flow

```text
node dist/cli.js forget
        ↓
একটি embedded recovery code নেওয়া
        ↓
প্রথম available .secret-এর recovery slot থেকে পুরোনো password recover
        ↓
নতুন password + confirmation নেওয়া
        ↓
সব .secret পুরোনো password দিয়ে memory-তে decrypt
        ↓
সব content নতুন password দিয়ে encrypt
        ↓
নতুন shared 3 code ও embedded slots তৈরি
        ↓
atomic write করে সব .secret replace
```

এতে current file state-এ পুরোনো recovery codes revoke হয়। নতুন code terminal-এ একবার দেখানো হয়।

### One-time limitation

Local file ও Git history দিয়ে globally one-time code enforce করা যায় না। কেউ পুরোনো `.secret` commit/copy restore করলে তার embedded old slots-ও restore হবে। Strong global one-time enforcement-এর জন্য remote service/KMS দরকার। তাই recovery-এর পরে নতুন `.secret` files দ্রুত commit করুন এবং পুরোনো recovery code confidential রাখুন।

## 10. Parser validation ও backward compatibility

`parseEncryptedEnv` duplicate field, unknown/missing required structure, wrong algorithm/version, invalid Base64, wrong salt/IV/tag size, এবং unsafe v2 KDF cost reject করে। Valid v2 file optional full set of 3 recovery slots নিতে পারে।

পুরোনো `ENVHIDE:v1` file decrypt করা যায় (legacy Argon2 settings: 64 MiB, time cost 3)। কিন্তু v1-এ recovery slots নেই। v1 file unlock করে আবার `lock` চালালে stronger v2 + recovery slots-এ migrate হবে।

## 11. Safe writing ও errors

`atomicWrite` target directory-তে random temporary filename `wx` mode-এ create করে, file sync করে, তারপর rename করে final path-এ নেয়। একই filesystem-এ rename atomic হওয়ায় half-written final file-এর ঝুঁকি কমে। New plaintext ও secret file mode `0600`-এ তৈরি হয়।

`EnvHideError` controlled message দেয়। `DecryptionError` secret-related failure-এর কারণ আলাদা করে প্রকাশ করে না। Exit status:

```text
0  success
1  operation failure
2  invalid usage/input
```

## 12. Test ও release check

```bash
npm test
npm pack --dry-run
npm publish --dry-run
```

বর্তমান tests v2 round-trip, Unicode/large content, random salt/IV, tamper detection, wrong/empty password, এবং legacy v1 decrypt cover করে। Recovery slot-এর manual verification-ও করা হয়েছে; future change-এ recovery-code test suite যোগ করা উচিত।
