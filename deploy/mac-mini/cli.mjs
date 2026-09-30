#!/usr/bin/env node
import { execute } from "./commands.mjs";

process.umask(0o077);
const [action, configPath, ...args] = process.argv.slice(2);
if (!action || !configPath) {
  process.stderr.write(
    "Usage: node deploy/mac-mini/cli.mjs COMMAND /absolute/private/config.json [argument]\n",
  );
  process.exitCode = 1;
} else {
  try {
    process.stdout.write(`${await execute(action, configPath, args)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
