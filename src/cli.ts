#!/usr/bin/env node

import { loadCliConfig, usage } from "./config.js";
import { CliError } from "./errors.js";
import { renderResult, runLoop } from "./runner.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const config = await loadCliConfig(argv, process.cwd());
  const log = (message: string) => {
    console.error(message);
  };

  const result = await runLoop(config, log);

  if (config.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderResult(result));
  }

  if (result.status === "failed") {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`Error: ${error.message}`);
    process.exitCode = error.exitCode;
    return;
  }

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
