# env-hide: ব্যবহার ও feature guide

## Project-এর কাজ কী

`env-hide` হলো Node.js/TypeScript npm package। এটি `.env` এবং `.env.local`-এর
ভেতরের secret Git-এ plaintext হিসেবে না রেখে encrypt করে রাখে। Plaintext file:

```text
.env             .env.local
```

এর encrypted, Git-commit-friendly counterpart:

```text
.env.secret      .env.local.secret
```

## Install

আপনার অন্য project-এর root folder-এ চালান:

```bash
npm install --save-dev env-hide
```

Install সফল হলে package-এর post-install step ওই project-এর `.gitignore`-এ এই
দুইটি line যোগ করে, যদি আগে না থাকে:

```gitignore
.env
.env.local
```

পুরোনো `.gitignore` entries overwrite হয় না এবং duplicate line-ও যোগ হয় না।
`.env.secret` ও `.env.local.secret` deliberately ignored হয় না; সেগুলিই commit
করার জন্য।

## প্রথমবার setup

```bash
npx env-hide init
```

এটি `.gitignore` configure করে এবং placeholder `.env.secret` ও
`.env.local.secret` তৈরি করে। এরপর আপনার প্রয়োজনমতো `.env`, `.env.local`, বা
দুটিই বানান।

## Encrypt / lock

```bash
npx env-hide lock
```

একই password দুইবার দিতে হবে। যেসব source file আছে, শুধু সেগুলো process হবে:

| Source | Generated encrypted file |
| --- | --- |
| `.env` | `.env.secret` |
| `.env.local` | `.env.local.secret` |

সফল হওয়ার আগে encrypted output আবার decrypt করে original content-এর সাথে
মিলিয়ে দেখা হয়। `.env` ও `.env.local` lock করার ফলে delete বা modify হয় না।

তারপর commit করুন:

```bash
git add .gitignore .env.secret .env.local.secret
git commit -m "Add encrypted environment configuration"
```

যে encrypted file আসলেই তৈরি হয়েছে শুধু সেটিই add করবেন।

## Decrypt / unlock

Repository clone করার পরে:

```bash
npx env-hide unlock
```

Password ঠিক হলে `.env.secret` থেকে `.env` এবং `.env.local.secret` থেকে
`.env.local` ফিরবে। কোনো encrypted file ভুল password বা modified data-এর কারণে
decrypt না হলে plaintext file লেখা হয় না।

## Status এবং CI check

```bash
npx env-hide status
npx env-hide check
```

`status` তথ্য দেখায়। `check` automation-এর জন্য: encrypted file invalid,
missing, বা `.env`/`.env.local` ignore না হলে এটি exit code `1` দেয়। সফল হলে
exit code `0`।

## প্রয়োজনীয় command

```bash
npx env-hide help
npx env-hide version
npx env-hide init
npx env-hide lock
npx env-hide unlock
npx env-hide status
npx env-hide check
```