# env-hide: ভেতরের কাজের বিস্তারিত ব্যাখ্যা

এই document-এ project-এর প্রতিটি প্রধান layer কীভাবে কাজ করে তা বলা হয়েছে।

## 1. Build এবং package layer

Source code `src/`-এ TypeScript-এ লেখা। `npm run build` TypeScript compiler
চালিয়ে JavaScript ও type declaration `dist/`-এ তৈরি করে। Published npm package
শুধু `dist/`, `README.md`, এবং `LICENSE` অন্তর্ভুক্ত করে। `package.json`-এর
`bin` field-এর কারণে `npx env-hide` চালালে `dist/cli.js` execute হয়।

`prepublishOnly` publish করার ঠিক আগে build চালায়। ফলে publish-এর সময় current
compiled output ছাড়া package পাঠানো হয় না। Node.js 20 বা তার নতুন version
প্রয়োজন।

## 2. File mapping

`src/files.ts`-এর `ENV_FILENAMES` হলো single source of truth:

```ts
[".env", ".env.local"]
```

CLI এই list ধরে প্রতিটির `.secret` name বানায়:

```text
.env       + .secret = .env.secret
.env.local + .secret = .env.local.secret
```

ফলে নতুন environment file support করতে হলে এই list এবং mapping policy পরিবর্তন
করলেই হয়।

## 3. Password থেকে key বানানো

`src/index.ts` password-কে কখনও AES key হিসেবে সরাসরি ব্যবহার করে না। প্রতিবার
lock-এর সময় secure random 16-byte salt তৈরি হয়। তারপর:

```text
password + salt
      ↓
Argon2id (timeCost=3, memoryCost=65536 KiB, parallelism=1)
      ↓
32-byte / 256-bit key
```

Argon2id `argon2` dependency থেকে আসে। Salt secret নয় এবং encrypted file-এ
থাকে; এটি একই password-এর জন্য আলাদা key তৈরি নিশ্চিত করে। Derived key কাজ
শেষে memory buffer থেকে `fill(0)` দিয়ে পরিষ্কার করার চেষ্টা করা হয়।

## 4. Encryption format ও AES-GCM

Key তৈরির পর Node-এর `node:crypto` দিয়ে AES-256-GCM চালানো হয়। প্রতিবার নতুন
12-byte random IV/nonce বানানো হয়। GCM ciphertext-এর সাথে authentication tag
তৈরি করে, তাই file বদলালে decrypt authentication fail করে।

Output text format:

```text
ENVHIDE:v1
kdf=argon2id
cipher=aes-256-gcm
salt=<base64>
iv=<base64>
tag=<base64>
data=<base64>
```

Base64 কেবল bytes-কে text file-এ রাখে; এটি encryption নয়। Parser duplicate,
unknown/missing required structure, wrong version/algorithm, invalid base64,
এবং wrong salt/IV/tag length reject করে।

## 5. `lock` flow

1. CLI দেখে `.env` এবং/অথবা `.env.local` readable আছে কি না। `init` কোনো
   placeholder secret file তৈরি করে না।
2. একবার password এবং confirmation নেয়; password empty হলে reject হয়।
3. প্রতিটি present source file memory-তে পড়ে এবং `encryptEnv` চালায়।
4. তৈরি encrypted content memory-তেই decrypt করে byte-for-byte original-এর
   সাথে verify করে।
5. সব verification pass হলে corresponding `.secret` file write হয়।
6. `.gitignore`-এ plaintext filename দুটি নিশ্চিত করা হয়।

Plaintext terminal-এ print করা হয় না।

## 6. `unlock` flow

1. CLI পায় এমন `.env.secret` এবং `.env.local.secret` খোঁজে।
2. Password নেয়।
3. প্রতিটি selected secret memory-তে decrypt করে।
4. সব decrypt সফল না হলে `DecryptionError` দেখায় এবং কোনো plaintext file write
   করে না। Wrong password এবং corrupt/tampered file একই message দেয়।
5. সব সফল হলে atomic write দিয়ে target plaintext files restore করে।

এই all-before-write design partial restore প্রতিরোধ করে।

## 7. Atomic file writing

`atomicWrite` target folder-এ unpredictable random temporary filename তৈরি করে
(`open` mode `wx`)। Data লেখা ও sync করার পরে temporary file-কে `rename` করে
final filename করা হয়। একই filesystem-এ rename atomic হওয়ায় final file half
written অবস্থায় থাকার ঝুঁকি কমে। Error হলে temporary file delete করার চেষ্টা
করা হয়। New secret/plaintext output permission `0600` দিয়ে তৈরি হয়।

## 8. CLI ও errors

`src/cli.ts` Node `readline` ব্যবহার করে hidden password input নেয়। User-এর
input console-এ star হিসেবে দেখা যায়; password value print হয় না।

`EnvHideError` controlled user message দেয় এবং `DecryptionError` sensitive
failure এক message-এ রাখে। Normal mode stack trace print করে না। Exit status:

```text
0  success
1  operation failure
2  invalid usage/input
```

## 9. npm install hook

`src/postinstall.ts` npm-এর `INIT_CWD` থেকে consuming project directory পায়।
Local install হলে সেখানকার `.gitignore` read করে missing `.env` এবং
`.env.local` line append করে। Global install এ এটি immediately return করে।
Permission/write error হলে install fail না করে silently return করে; user তখন
`npx env-hide init` চালাতে পারে।

## 10. Tests ও release validation

`src/index.test.ts` Node built-in test runner ব্যবহার করে। Tests exact
round-trip, empty/large/Unicode content, Unicode password, different random
output, empty/wrong password, malformed/version/truncated/tampered file check
করে।

Release-এর আগে চালান:

```bash
npm test
npm pack --dry-run
npm publish --dry-run
```

শেষ command npm registry-তে কিছু publish করে না, কিন্তু package build এবং
publish metadata validate করে।
