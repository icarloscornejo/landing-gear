/**
 * Interview dates on STAGE notes (house rule 25): "STAGE: Tech interview 2 @
 * 2026-10-29T10:00-06:00". The browser sends a datetime-local wall time; the
 * server turns it into this canonical ISO in the profile's time zone, so no
 * client text ever reaches the tracker. Idea from AienTech/dossier.
 */

import { localParts, localToEpochMs } from "./scheduled-cadence.mjs";

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;
const pad = (value) => String(value).padStart(2, "0");

/**
 * "2026-10-29T10:00" in `timezone` -> "2026-10-29T10:00-06:00", or null when
 * the text is not exactly a real wall time.
 * @param {unknown} wall
 * @param {string} timezone
 * @returns {string|null}
 */
export function wallToIso(wall, timezone) {
  const match = WALL_RE.exec(String(wall ?? ""));
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const check = new Date(wallMs);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  const epoch = localToEpochMs({ year, month, day, hour, minute, second: 0 }, timezone);
  const back = localParts(epoch, timezone);
  // A wall time skipped by a DST jump has no instant; refuse it rather than shift it.
  if (back.hour !== hour || back.minute !== minute) return null;
  const offset = Math.round((wallMs - epoch) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  return `${match[0]}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** Epoch ms of a canonical ISO, or NaN. @param {string|null|undefined} iso */
export function isoEpoch(iso) {
  return ISO_RE.test(String(iso ?? "")) ? Date.parse(String(iso)) : NaN;
}

/** The datetime-local value for a stored ISO (its own wall time). @param {string|null|undefined} iso */
export function isoToWall(iso) {
  return ISO_RE.test(String(iso ?? "")) ? String(iso).slice(0, 16) : "";
}

/**
 * "Thu Oct 29, 10:00", read from the ISO's own wall time, so the server and
 * the browser print the same thing whatever zone they run in.
 * @param {string|null|undefined} iso
 */
export function formatInterviewDate(iso) {
  const match = ISO_RE.exec(String(iso ?? ""));
  if (!match) return "";
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const monthName = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday} ${monthName} ${day}, ${match[4]}:${match[5]}`;
}
