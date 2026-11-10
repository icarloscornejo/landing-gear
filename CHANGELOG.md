# Changelog

landing-gear is based on the upstream project at https://github.com/career-ops-hq/career-ops (MIT).

## 1.1.2 (2026-11-09)

* Pre-triage drops can be undone: each dropped row in the inbox has a Restore button that brings the posting back to Discovered, and a restored row is not dropped again on the next pre-triage run.
* Pre-triage drops postings whose title names a non-LATAM region (APAC, EMEA, "Europe only", "UK only", "India only") unless the title also says LATAM, Americas, global, worldwide or anywhere.
* Getro boards that relist remote.com postings now show the real employer, taken from the remote.com URL, instead of "Remote".

## 1.1.1 (2026-11-06)

* "Applied with CV" now rewrites the approval note from "will apply (not applied yet)" to "APPROVED: applied", so applied rows stop reading as pending.
* Pipeline tables sort newest first by default: tracker tabs by date, inbox tabs (Discovered and the rest) by posting date, then by the order rows were added.
* `config/cv-facts.example.json` lists gap phrases ("new to me", "still learning", "limited experience" and similar) that the fact gate blocks in CVs and cover letters, plus "working knowledge" and "familiar with" as warnings.
* `.career-ops-web/` (the web state folder's pre-rename name) is gitignored again and no longer tracked.

## 1.1.0 (2026-11-02)

* Full rename from career-ops to landing-gear.
* Environment variables are now `LANDING_GEAR_*`.
* State directories are now `.landing-gear-web`, `.landing-gear-data` and `.landing-gear-locks`.
* Removed upstream identity and community files (trademark, manifesto, signatures, funding manifest, citation, npm scaffolder). The Hired Wall now points at this repository and starts empty.
* X posts scan: a console script for x.com (`web/src/lib/x-posts-scan.js`, built by `x-script.mjs` from `portals.yml` → `x_post_queries`) that expands truncated posts and judges each one like the LinkedIn posts scan, with its own reminder card on Today.
* Pre-triage gains profile-gated filters from the LinkedIn script (`config/profile.yml` → `pre_triage`: `skip_junior`, `onsite_only_in_authorized`, `blocked_places`) and US contract terms when the profile is not US-authorized.
* Stricter hybrid and on-site detection, shared by pre-triage and the LinkedIn posts scan, so "remote" postings that only mention an office are no longer dropped.
* "US hours" and "US time zones" read as a schedule, not as a US location.
* freehire: `exclude_hosts` drops postings from repost boards such as WhatJobs.

## 1.0.3

* The board shows pre-triage, triage and evaluation state and runs.
* Full-height board with per-column scroll.
* Configurable `followup_cadence.ghosted_after_days`.
* Fixed report URL headers that carried remarks.

## 1.0.2

* 0-10 scores in the web UI.
* JD links for local captures.
* 3-line location clamp.

## 1.0.1

* Posting guard and eligibility pre-triage.
* Look-alike ATS host detection.
* Stale sweep and company research cache.
* `daily-scan.sh` with YC, HN, JSearch and freehire sources.

## 1.0.0

* First landing-gear release, based on career-ops v1.38.0.
