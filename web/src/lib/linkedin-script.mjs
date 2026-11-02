// Builds the LinkedIn console script (web/src/lib/linkedin-posts-scan.js) with pre-triage.mjs and
// linkedin-post.mjs inside it. A script pasted on linkedin.com cannot import local files, so the module
// sources are inlined in place of the script's MODULES line; every improvement to them reaches the next
// copy of the script. The searches come from portals.yml -> linkedin_post_queries.
// Run directly to copy it when the dashboard button is gone: node web/src/lib/linkedin-script.mjs | pbcopy

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const MARKER = "const modules = null; // MODULES";
const QUERIES_LINE = /^ {2}const QUERIES = .*\/\/ QUERIES$/m;

/**
 * The script with its QUERIES line set to `queries`; without queries it keeps the script's fallback.
 * @param {string} script console script with the QUERIES line
 * @param {string[]} queries
 */
export function withQueries(script, queries) {
  if (!QUERIES_LINE.test(script)) throw new Error("linkedin script: QUERIES line not found");
  if (!queries.length) return script;
  return script.replace(QUERIES_LINE, () => `  const QUERIES = ${JSON.stringify(queries)}; // QUERIES`);
}

/** portals.yml -> linkedin_post_queries.queries, capped at max_queries_per_run; [] when absent. */
export function portalQueries(portalsText) {
  const config = (yaml.load(portalsText) ?? {}).linkedin_post_queries ?? {};
  const queries = (config.queries ?? []).filter((query) => typeof query === "string" && query.trim());
  return config.max_queries_per_run > 0 ? queries.slice(0, config.max_queries_per_run) : queries;
}
const IMPORT = /^import \{([^}]+)\} from "\.\/location-reach\.mjs";$/m;
const EXPORTS = { preTriage: ["preTriage"], linkedinPost: ["splitPost", "judgePost", "dedupKey"] };

const stripExports = (source) => source.replace(/^export /gm, "");
const namesOf = (list) => list.split(",").map((name) => name.trim()).filter(Boolean);

/**
 * @param {string} script console script with the MODULES line
 * @param {{preTriage: string, linkedinPost: string, locationReach: string}} sources module sources
 */
export function withModules(script, sources) {
  if (!script.includes(MARKER)) throw new Error("linkedin script: MODULES line not found");
  // Inlining only knows imports from location-reach.mjs; any other would leave a name undefined in the browser.
  if (/^import /m.test(sources.locationReach)) throw new Error("linkedin script: location-reach.mjs imports changed, update linkedin-script.mjs");
  const reachNames = new Set();
  const blocks = [];
  for (const [module, exported] of Object.entries(EXPORTS)) {
    const source = sources[module];
    const imported = IMPORT.exec(source);
    const body = source.replace(IMPORT, "");
    if (/^import /m.test(body)) throw new Error(`linkedin script: ${module} imports changed, update linkedin-script.mjs`);
    if (imported) for (const name of namesOf(imported[1])) reachNames.add(name);
    // One scope per module: they share top-level names (OPENING, NO_TRACKER...).
    blocks.push(`const { ${exported.join(", ")} } = (() => {\n${stripExports(body)}\nreturn { ${exported.join(", ")} };\n})();`);
  }
  const reach = [...reachNames].join(", ");
  const inlined = `const modules = (() => {
const { ${reach} } = (() => {
${stripExports(sources.locationReach)}
return { ${reach} };
})();
${blocks.join("\n")}
return { ${Object.values(EXPORTS).flat().join(", ")} };
})();`;
  return script.replace(MARKER, () => inlined);
}

/** The ready-to-paste script, read from the repo at `root`, minified so it pastes as one short block. */
export function buildLinkedinScript(root) {
  const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
  let queries = [];
  try {
    queries = portalQueries(read("portals.yml"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const script = withModules(withQueries(read("web", "src", "lib", "linkedin-posts-scan.js"), queries), {
    preTriage: read("web", "src", "lib", "pre-triage.mjs"),
    linkedinPost: read("web", "src", "lib", "linkedin-post.mjs"),
    locationReach: read("web", "src", "lib", "location-reach.mjs"),
  });
  // ponytail: Next's internal terser copy, no new dependency; if an upgrade moves it, the script ships unminified.
  let minifySync;
  try {
    ({ minify_sync: minifySync } = createRequire(import.meta.url)("next/dist/compiled/terser"));
  } catch (error) {
    console.warn("linkedin script: terser not found, copying it unminified", error);
    return script;
  }
  return minifySync(script).code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(buildLinkedinScript(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")));
}
