#!/bin/bash
# Daily zero-token scan. The web server starts it (web/src/lib/daily-scan.ts) from 12:00 local time;
# its output goes to .career-ops-web/daily-scan.log. It only discovers: new postings land in Pending
# of data/pipeline.md (Discovered in the web). It never triages or evaluates.
# freehire and JSearch run only when portals.yml configures them (and JSearch needs its key in .env).
# A daily-scan.local.sh next to this file (gitignored) runs last, for personal sources.
# Usage: bash daily-scan.sh
set -u
source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")" || exit 1
for step in scan.mjs scan-hn-daily.mjs scan-yc.mjs scan-jsearch.mjs scan-freehire.mjs; do
  echo "== $(date '+%Y-%m-%d %H:%M') $step"
  node "$step"
done
if [[ -f daily-scan.local.sh ]]; then
  echo "== $(date '+%Y-%m-%d %H:%M') daily-scan.local.sh"
  bash daily-scan.local.sh
fi
echo "== done"
