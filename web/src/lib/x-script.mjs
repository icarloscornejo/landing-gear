// Builds the X console script (web/src/lib/x-posts-scan.js) the same way as the LinkedIn one
// (linkedin-script.mjs): the post filter inlined, the searches from portals.yml -> x_post_queries.
// Run directly to copy it: node web/src/lib/x-script.mjs | pbcopy

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConsoleScript } from "./linkedin-script.mjs";

/**
 * @param {string} root
 * @param {boolean | undefined} [usAuthorized] from usAuthorizedFrom(profile authorized_in)
 */
export function buildXScript(root, usAuthorized) {
  return buildConsoleScript(root, usAuthorized, { file: "x-posts-scan.js", queriesKey: "x_post_queries" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(buildXScript(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")));
}
