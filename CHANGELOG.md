# Changelog

landing-gear is based on the upstream project at https://github.com/career-ops-hq/career-ops (MIT).

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
