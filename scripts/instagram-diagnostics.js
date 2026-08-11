#!/usr/bin/env node

const {
  runInstagramDiagnostics,
  formatInstagramDiagnostics
} = require("../instagram-diagnostics");

function parseArgs(argv) {
  const args = { ids: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--ids") {
      args.ids = argv[index + 1] || "";
      index += 1;
    } else if (item.startsWith("--ids=")) {
      args.ids = item.slice("--ids=".length);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = await runInstagramDiagnostics({ ids: args.ids });
  console.log(formatInstagramDiagnostics(results));
}

main().catch((error) => {
  console.error(`Instagram diagnostics failed: ${String(error?.message || error).replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")}`);
  process.exitCode = 1;
});
