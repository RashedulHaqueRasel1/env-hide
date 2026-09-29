#!/usr/bin/env node
import { stdout as output } from "node:process";
import { EnvHideError } from "./core/errors.js";
import { runCli } from "./cli/index.js";

void runCli().catch((error: unknown) => {
  const known = error instanceof EnvHideError;
  output.write(`✗ ${known ? error.message : "Operation failed."}\n`);
  if (!known && process.argv.includes("--debug")) console.error(error);
  process.exitCode = known ? error.exitCode : 1;
});
