// Post reading for the LinkedIn console scan (house rule 18), on the 2026-10-27 run.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupKey, judgePost, postLocation, postTitle, splitPost } from "../../src/lib/linkedin-post.mjs";
import { preTriage } from "../../src/lib/pre-triage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const judgeFixture = (name) => {
  const { posts } = JSON.parse(fs.readFileSync(path.join(here, "../fixtures", name), "utf8"));
  return new Map(posts.map(({ id, lines }) => {
    const post = splitPost(lines);
    return [id, { ...judgePost(post, preTriage), key: dedupKey(postTitle(post.body), post.body) }];
  }));
};
const judged = judgeFixture("linkedin-posts-2026-10-27.json");
const judged28 = judgeFixture("linkedin-posts-2026-10-28.json");
const reasonOf = (id) => judged.get(id).reason ?? "pass";
const reasonOf28 = (id) => judged28.get(id).reason ?? "pass";
const judgeText = (text) => judgePost(splitPost(["author", "6h •", ...text.split("\n")]), preTriage);
const textReason = (text) => judgeText(text).reason ?? "pass";

test("2026-10-27 run: the posts worth a look pass", () => {
  // The Berlin freelance post (unlabeled) and the SA-based contract stay for Claude to judge.
  for (const id of ["c01", "c04", "c12", "c18", "d14", "d15", "d16", "d21"]) assert.equal(reasonOf(id), "pass", id);
  assert.equal(judged.get("c12").title, "Senior Mobile Developer");
  assert.equal(judged.get("d21").title, "Mobile Tech Lead (LATAM)");
  // The fixture keeps the post's own dash (stored as a JSON escape).
  assert.match(judged.get("d14").title, /^Senior Flutter Developer \p{Pd} Project-Based$/u);
});

test("2026-10-27 run: noise drops, each with its reason", () => {
  const expected = {
    c02: /sin rol/, // product launch
    c03: /fuera de stack/, // App & Website Developer: the title names no mobile or AI stack
    // QA: the title names no stack, or pre-triage drops it as not a target role.
    c05: /not a target role|fuera de stack/, c07: /not a target role|fuera de stack/, c08: /not a target role|fuera de stack/,
    c10: /not a target role|fuera de stack/, c11: /not a target role|fuera de stack/, c16: /not a target role|fuera de stack/,
    c17: /not a target role|fuera de stack/, c20: /not a target role|fuera de stack/,
    c06: /residency: .*Argentina BASED RESOURCES ONLY/,
    c09: /lista de empleos/, c21: /lista de empleos/,
    c13: /on the bench/, c14: /ofrece servicios/,
    c15: /location restricted \(Remote . UK & Europe\)/, c23: /location restricted \(Poland\)/,
    c19: /sin rol/, c22: /sin rol/,
    d04: /bloqueado/, d07: /bloqueado/, d10: /CANDIDATES BASED IN USA/, d19: /not a target role/, d20: /bloqueado: India/,
  };
  for (const [id, reason] of Object.entries(expected)) assert.match(reasonOf(id), reason, id);
  // The rest of the old discards stay out.
  for (const id of ["d01", "d02", "d03", "d05", "d06", "d08", "d09", "d11", "d12", "d13", "d17", "d18", "d22", "d23"]) assert.notEqual(reasonOf(id), "pass", id);
});

test("2026-10-27 run: the same post by another author shares a key", () => {
  assert.equal(judged.get("c12").key, judged.get("c18").key);
  assert.equal(judged.get("d14").key, judged.get("d15").key);
  assert.equal(judged.get("d15").key, judged.get("d16").key);
  assert.notEqual(judged.get("c12").key, judged.get("d14").key);
  const intro = "We're hiring at Acme, a remote-first fintech building payments for LATAM merchants since 2015 with a distributed team.";
  assert.notEqual(dedupKey("Senior Android Engineer", [intro]), dedupKey("Senior QA Engineer", [intro]));
});

test("2026-10-28 run: the recruiter's 'What I'm looking for:' no longer drops a LATAM post; noise still drops", () => {
  // Senior Android (Kotlin), Senior Mobile (AI-Native), a Berlin freelance post, AI Agent Engineer.
  for (const id of ["c02", "c03", "c05", "c06"]) assert.equal(reasonOf28(id), "pass", id);
  assert.equal(reasonOf28("c01"), "fuera de stack"); // Systems Architect and Full-stack Engineer
  assert.equal(reasonOf28("d53"), "pass"); // LATAM talent agency, $6-8K React Native
  assert.match(judged28.get("d53").title, /^Senior React Native Engineer in Latin America/);
  assert.match(reasonOf28("c04"), /^bloqueado: (CTC|LPA|Crore|Freshers)$/i); // Indian engagement bait
  assert.match(reasonOf28("d31"), /^bloqueado: Hybrid/); // "Job title:" read, then Hybrid
  assert.equal(judged28.get("d31").title, "Senior Mobile Android Engineer");
  assert.equal(reasonOf28("d51"), "no es oferta (lista de empleos)"); // job board account, bare links
  assert.equal(reasonOf28("d30"), "no es oferta (lista de empleos)"); // startup jobs digest
  // Real job seekers still drop.
  for (const id of ["d11", "d22", "d32", "d39", "d47", "d48"]) assert.match(reasonOf28(id), /^busca trabajo/, id);
});

test("splitPost: the age line ends the author header, also mid-line; without it only the author line goes", () => {
  assert.deepEqual(splitPost(["Ana", "• 3rd+", "Founder | Engineer", "with Bo • 6h • Edited", "Hello"]).body, ["Hello"]);
  assert.deepEqual(splitPost(["Ana", "Hello", "Follow", "Join", "World"]), { author: "Ana", body: ["Hello", "World"] });
  // Decorative Unicode letters read as plain text.
  assert.deepEqual(splitPost(["Ana", "6h •", "𝐒𝐞𝐧𝐢𝐨𝐫 𝐀𝐧𝐝𝐫𝐨𝐢𝐝 𝐄𝐧𝐠𝐢𝐧𝐞𝐞𝐫"]).body, ["Senior Android Engineer"]);
});

test("postTitle: Role: lines first, then hiring lines that name a role, then a role noun; never a signature link", () => {
  assert.equal(postTitle(["Acme is hiring in LATAM! 🌎", "💼 Role: Senior Android Engineer"]), "Senior Android Engineer");
  assert.equal(postTitle(["Hiring: Senior Android (Kotlin) - Remote LATAM"]), "Senior Android (Kotlin) - Remote LATAM");
  assert.equal(postTitle(["Hiring: Android Programmer"]), "Android Programmer");
  assert.equal(postTitle(["Buscamos desarrolladores Android"]), "desarrolladores Android");
  assert.equal(postTitle(["We're hiring Android Engineers"]), "Android Engineers");
  assert.equal(postTitle(["Join us!", "Android app: https://example.com/link"]), "");
  // A labeled role at the bottom of the post is still the title; hashtag lines never are.
  assert.equal(postTitle(["Great team, great pay.", "Fully remote.", "1", "2", "3", "4", "5", "6", "Role: Senior Android Engineer"]), "Senior Android Engineer");
  assert.equal(postTitle(["A friend needs help with a project.", "#Hiring #AIAgents #AgenticAI"]), "");
});

test("postLocation: only labeled values, never prose", () => {
  assert.equal(postLocation(["📍 Location: Remote – UK & Europe", "Work Mode: Remote"]), "Remote – UK & Europe | Remote");
  assert.equal(postLocation(["Senior Android Engineer | Join us", "We work with US clients"]), "");
});

test("judgePost: synthetic cases around house rule 10 and recruiter wording", () => {
  const hiring = "We're hiring a Senior Android Engineer, fully remote. Requirements: Kotlin, Jetpack Compose. Apply now.";
  assert.equal(textReason(`Acme is hiring in LATAM!\nRole: Senior Android Engineer\n${hiring}`), "pass");
  assert.equal(textReason(`${hiring}\nRequirements:\n1. Kotlin\n2. Compose\n3. 5+ years`), "pass");
  assert.equal(textReason(`Hiring: Remote Senior Android Engineer for a US-based client\n${hiring}`), "pass");
  assert.equal(textReason(`${hiring}\nI help companies hire top engineers.`), "pass");
  assert.equal(textReason(`${hiring}\nJoining: Immediate Joiner`), "pass");
  assert.equal(textReason(`We're hiring. I'm looking for a Senior Android Engineer with Kotlin.\n${hiring}`), "pass");
  assert.match(textReason(`I'm looking for remote opportunities in mobile.\n${hiring}`), /^busca trabajo/);
  assert.equal(textReason(`${hiring}\nOpen to LATAM. Pay: 50 LPA equivalent in USD.`), "pass");
  const socials = ["https://example.com/a", "https://example.com/b", "https://example.com/c"].join("\n");
  assert.equal(textReason(`${hiring}\nApply: https://example.com/apply\n${socials}`), "pass");
  assert.equal(textReason(`${hiring}\nSolo para residentes en Latinoamérica.`), "pass");
  assert.equal(textReason(`${hiring}\n(Remoto en México)`), "pass");
  assert.equal(textReason(`${hiring}\nOur client is based in the US.`), "pass");
  assert.equal(textReason(`${hiring} We build native and hybrid apps.`), "pass");
  assert.equal(textReason(`${hiring} Team lead in Indiana.`), "pass");
  assert.equal(textReason(`Hiring Android devs, remote from LATAM or the Philippines.\n${hiring}`), "pass");
  assert.equal(textReason(`${hiring}\nDM Jordan for details.`), "pass");
  assert.equal(textReason(`${hiring}\nAndroid Engineer (Australia, LATAM, APAC)\nBackend Engineer (India)`), "pass");
  assert.match(textReason(`${hiring}\nWork Model: Hybrid`), /^bloqueado: Hybrid/);
  assert.match(textReason(`${hiring}\nLocation: Austin (Onsite)`), /^bloqueado: Onsite/);
  assert.match(textReason(`${hiring}\nLocation: India Shift (IST)`), /^bloqueado: India/);
});

test("judgePost: 2026-10-29 run, presencial, junior and event posts drop", () => {
  const hiring = "We're hiring a Senior Android Engineer, fully remote. Requirements: Kotlin, Jetpack Compose. Apply now.";
  assert.match(textReason(`Tenemos una vacante para Desarrollador Android (Kotlin)\nPresencial en Mérida, Yucatán`), /^bloqueado: Presencial/);
  assert.equal(textReason(`We're hiring: Junior Android Developer\n${hiring}`), "junior");
  assert.equal(textReason(`Had a great time at Android Dev Summit!\nAI is opening up new possibilities for Android apps.`), "sin frase de contratacion");
  assert.equal(textReason(`New opening: Senior Android Engineer\nFully remote, Kotlin and Compose.`), "pass");
});

test("judgePost: 2026-11-01 run, Spanish and Portuguese hiring wording, North America only, Indian cities", () => {
  const hiring = "We're hiring a Senior Android Engineer, fully remote. Requirements: Kotlin, Jetpack Compose. Apply now.";
  assert.equal(textReason(`Se busca: Desarrollador Mobile\nRemoto desde México, Perú, Argentina\nReact Native, Kotlin, Swift`), "pass");
  assert.equal(textReason(`A Truelogic busca Forward Deployed Engineer, AI & Business Transformation\nModelo: 100% remoto\nRegião: LATAM`), "pass");
  assert.equal(textReason(`¿Buscas trabajo? Todos los domingos reviso ofertas de Android.`), "sin frase de contratacion");
  assert.match(textReason(`${hiring}\nNORTH AMERICA ONLY`), /^bloqueado: NORTH AMERICA ONLY/);
  assert.match(textReason(`${hiring}\nCurrently based in the United States or Canada.`), /^bloqueado: based in the United States or Canada/);
  assert.match(textReason(`${hiring}\nLocation: Coimbatore`), /^bloqueado: Coimbatore/);
});
