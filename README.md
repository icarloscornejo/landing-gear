# landing-gear

**git hired.** A local-first AI job search agent for engineers.

landing-gear scans job boards, filters out the noise for free, evaluates the roles worth your time, and tracks every application through each hiring phase, all on your own machine with your own AI CLI (built and tuned on Claude Code). It is tuned for engineering roles: mobile, backend, full-stack and AI.

It started as a personal setup for a remote job search from Latin America and grew into a full tool. Your CV, tracker, reports and notes never leave your computer and are never committed.

## What it does

- **Scans job boards with zero tokens.** Greenhouse, Lever, Ashby, Workday and many more, plus Hacker News "Who is hiring", Y Combinator job posts and JSearch (Google for Jobs).
- **Pre-triage for free.** Before any model runs, it reads the JD when it can (ATS APIs, the page's structured data, public board APIs) and drops what is plainly out: residency requirements that exclude you, a stack outside your profile, pay under your floor, posts that are not job offers. In English and Spanish.
- **Location labels.** Every new posting says where you can work from: "Remote, LATAM ok", "LATAM country list", "Remote, limited to EMEA".
- **Triage and full evaluations** with your AI CLI: a quick pass/fail score, then a structured report with fit, gaps, legitimacy and an interview angle.
- **Every hiring phase, with rounds.** Applied, Replied, Screening, Assessment, Tech interview, Hiring manager, Final interview, Offer, and the way each process ended (rejected, withdrew, ghosted, posting closed).
- **Kanban board.** Drag a card to the next phase; the board writes the same validated update the buttons do.
- **Interview dates.** Set the date of each round; Today lists what is coming up.
- **Analytics.** A chained Sankey of your real funnel, phase by phase.
- **CVs and cover letters** tailored per role, with a fact check against your own CV.

## Quick start

Requirements: Node.js 22.13+, git, and an AI coding CLI (Claude Code recommended).

```bash
git clone https://github.com/icarloscornejo/landing-gear.git
cd landing-gear
npm install
npx playwright install chromium   # only needed for PDFs
```

Open the folder in Claude Code and run `/career-ops` to set up your CV, profile and the companies to scan. `node doctor.mjs` tells you what is still missing.

Web app:

```bash
cd web
npm install
npm run dev    # http://localhost:3000
```

## Your data stays yours

Everything personal lives in files that git ignores: `cv.md`, `config/profile.yml`, `portals.yml`, `data/`, `reports/`, `jds/`, `output/` and `modes/_profile.md` / `modes/_custom.md`. Nothing is sent anywhere except the job boards it reads and the AI CLI you choose. It never submits an application for you.

## Credits

Based on [career-ops](https://github.com/career-ops-hq/career-ops) by Santiago Fernández de Valderrama, MIT licensed. The core scripts, modes and slash commands keep their career-ops names, and upstream improvements are merged in regularly.

## License

MIT. See [LICENSE](LICENSE).
