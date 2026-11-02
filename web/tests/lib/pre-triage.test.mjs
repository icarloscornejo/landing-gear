// Zero-token pre-triage of Discovered rows (house rule 22).

import test from "node:test";
import assert from "node:assert/strict";
import { preTriage, residencyBlock, trackerKeys, urlKey } from "../../src/lib/pre-triage.mjs";

const tracker = trackerKeys([
  { company: "Upgrade", role: "AI Experience Engineer (Conversational AI)", url: "" },
  { company: "Acme", role: "Android Dev", url: "[ashby](https://jobs.ashbyhq.com/acme/123/?utm=x)" },
]);
const row = (role, location, extra = {}) => ({ url: "https://example.com/job/1", company: "Co", role, location, ...extra });
const PASS = { pass: true };
// A real posting body: hiring signals and the profile's stack.
const JD = "We are looking for a Senior Android Engineer to join our team. Responsibilities: build features in Kotlin and Jetpack Compose. Requirements: 5+ years of Android. ".repeat(2);
const reason = (role, location, jd) => preTriage(row(role, location), tracker, jd ? { text: jd } : null).reason ?? "pass";

test("passes target roles open to remote work from LATAM", () => {
  assert.deepEqual(preTriage(row("Android Engineer - Creative App", "Remote"), tracker), PASS);
  assert.deepEqual(preTriage(row("AI Developer", undefined), tracker), PASS);
  assert.deepEqual(preTriage(row("Senior AI Engineer", "Northern America, LATAM, Europe"), tracker), PASS);
  assert.deepEqual(preTriage(row("Senior Android Engineer", "Remote"), tracker, { text: JD }), PASS);
});

test("drops rows already in the tracker by URL or company and role", () => {
  assert.equal(preTriage(row("Android Dev", "Remote", { url: "https://jobs.ashbyhq.com/acme/123", company: "Other" }), tracker).reason, "already in tracker");
  assert.equal(preTriage(row("AI Experience Engineer (Conversational AI)", "Remote", { company: "upgrade" }), tracker).reason, "already in tracker");
});

test("not a job offer: candidates asking for work, in English and Spanish", () => {
  const selfPost = "I am iOS developer with 13 years of experience with iOS working on mostly streaming and e-commerce apps. I also build my own productivity app.";
  assert.match(reason(selfPost, ""), /^not a job posting \(candidate/);
  assert.match(reason("Busco trabajo como desarrollador Android", ""), /^not a job posting \(candidate/);
  assert.match(reason("Android Developer", "Remote", "Hola, soy desarrollador Android con 8 años de experiencia, disponible para proyectos freelance. Mi portafolio en el enlace."), /^not a job posting \(candidate/);
  assert.match(reason("Senior Android Engineer ".repeat(8), "Remote"), /^not a job posting/);
  assert.equal(reason("Flexibits / Android Software Engineer / Remote / Full-time", "Remote"), "pass");
});

test("not a job offer: people selling services, but a real posting that mentions services passes", () => {
  assert.equal(reason("Mobile App Developer", "Remote", "We offer mobile app development services for startups. Get a free quote today and launch in weeks."), "not a job posting (service offer)");
  assert.equal(reason("Desarrollador Android", "Remote", "Ofrecemos servicios de desarrollo de aplicaciones móviles. Cotiza tu proyecto con nosotros."), "not a job posting (service offer)");
  const agencyHiring = "Devsu provides software development services to clients in the US. We are looking for a Senior Android Engineer. Requirements: Kotlin, Compose. Our services team grows fast.";
  assert.equal(reason("Senior Android Engineer", "Remote", agencyHiring), "pass");
});

test("titles: AI gigs, non-dev roles, backend Java out; backend Kotlin, iOS and Flutter stay", () => {
  assert.equal(reason("AI Data Labeler", "Remote"), "not engineering (AI gig)");
  assert.equal(reason("Evaluador de IA", "Remote"), "not engineering (AI gig)");
  assert.equal(reason("Analista de Negocios Junior - Retail e IA (LLM)", "Remote"), "not a target role");
  assert.equal(reason("Principal Product Manager, Agentic AI", "Anywhere in the World"), "not a target role");
  assert.equal(reason("Office Coordinator", "Remote"), "not a target role");
  assert.equal(reason("Back-end Java Developer Semisenior", "Remote"), "backend Java");
  assert.equal(reason("Desarrollador Backend Java Semi Senior", "Chile"), "backend Java");
  assert.equal(reason("Backend Engineer (Kotlin)", "Remote"), "pass");
  assert.equal(reason("Senior iOS Engineer", "Remote"), "pass");
  assert.equal(reason("Senior Flutter/Dart Mobile Engineer", "Chile"), "pass");
});

test("house rule 10 on the location cell: a LATAM country list passes; limited elsewhere or on-site outside LATAM drops", () => {
  assert.equal(reason("Android Engineer, Luxury", "Mexico City, Mexico"), "pass");
  assert.equal(reason("Senior React Native Engineer", "Colombia"), "pass");
  assert.match(reason("Android Engineer", "Remote, US only"), /^location restricted/);
  assert.match(reason("Android Engineer", "Remote (EMEA)"), /^location restricted/);
  assert.match(reason("AI Engineer", "Mountain View, CA I Remote, Remote"), /^location restricted/);
  assert.match(reason("Android Engineer", "Sofia, Bulgaria"), /^location restricted/);
});

test("house rule 10 in the JD: only an explicit residency requirement that leaves El Salvador out drops", () => {
  assert.match(reason("Senior AI Engineer", "Remote", `${JD} Candidates must reside in Peru, Colombia or Bolivia.`), /^residency: "Candidates must reside in Peru, Colombia or Bolivia/);
  assert.equal(reason("Senior AI Engineer", "Remote", `${JD} You must reside in LATAM (El Salvador included).`), "pass");
  assert.equal(reason("Senior AI Engineer", "Remote", `${JD} Open to talent in Costa Rica or Colombia.`), "pass");
  assert.match(reason("Senior AI Engineer", "Remote", `${JD} Es requisito residir en Chile.`), /^residency/);
  assert.match(reason("Desarrollador Android", "Remote", `${JD} Debes residir en Colombia o México.`), /^residency/);
  assert.equal(reason("Desarrollador Android", "Remote", `${JD} Requisito: residir en Latinoamérica.`), "pass");
  assert.equal(residencyBlock("We hire anywhere. Our office is in Bogota."), null);
  assert.equal(residencyBlock("Our app serves residents of the United States and Canada."), null);
  assert.match(residencyBlock("This role is open to residents of the United States only.") ?? "", /United States only/);
});

test("house rule 10, '<places>-based ... only/required': the places before it decide; a preference or condition never drops", () => {
  assert.match(residencyBlock("Hi Folks, we're hiring. ***Argentina BASED RESOURCES ONLY***") ?? "", /Argentina BASED RESOURCES ONLY/);
  assert.match(residencyBlock("US-based candidates only.") ?? "", /US-based/);
  assert.match(residencyBlock("UK, Ireland or Germany based candidates only") ?? "", /Germany/);
  assert.match(residencyBlock("Brazil-based talent required.") ?? "", /Brazil/);
  assert.equal(residencyBlock("US-based candidates are preferred."), null);
  assert.equal(residencyBlock("US-based candidates must be able to overlap with PST."), null);
  assert.equal(residencyBlock("Our client is a US-based fintech."), null);
  assert.equal(residencyBlock("LATAM or US-based candidates only."), null);
  assert.equal(residencyBlock("Full-Stack Mobile Engineer | Contract | Fully Remote (SA-based)"), null);
});

test("titles: QA and plural AI gig titles drop, a remote Android Engineer passes", () => {
  assert.equal(reason("Senior Quality Engineering (QE) Engineer", "Remote"), "not a target role");
  assert.equal(reason("Salesforce QA Engineer - Health Cloud", "Remote"), "not a target role");
  assert.equal(reason("Quality Assurance Engineer, Mobile", "Remote"), "not a target role");
  assert.equal(reason("Personal Account Generalist Raters (Android Users)", "Remote"), "not engineering (AI gig)");
  assert.equal(reason("Senior Android Engineer", "Remote"), "pass");
});

test("stack in the JD: none of the profile's stack drops; a Spanish JD with it passes", () => {
  const backendOnly = "We are looking for a Senior Backend Engineer. Requirements: Java 17, Spring Boot, PostgreSQL, Kafka, microservices on AWS. Responsibilities: design REST APIs and data pipelines. ".repeat(2);
  assert.equal(reason("Senior Software Engineer", "Remote", backendOnly), "stack outside profile");
  const spanish = "Buscamos un desarrollador para el desarrollo de aplicaciones móviles. Requisitos: experiencia en equipos ágiles, pruebas y despliegue continuo. Responsabilidades: construir funcionalidades. ".repeat(2);
  assert.equal(reason("Desarrollador Senior", "Remote", spanish), "pass");
  const ai = "Buscamos ingeniero con experiencia en inteligencia artificial. Requisitos: Python, despliegue de modelos, evaluación y monitoreo. Responsabilidades: integrar soluciones en producción. ".repeat(2);
  assert.equal(reason("Ingeniero de Software", "Remote", ai), "pass");
});

test("pay: only a structured USD maximum below 4,000 a month drops", () => {
  const low = preTriage(row("Senior Android Engineer", "Remote"), tracker, { text: JD, salary: { max: 30000, currency: "USD", period: "year" } });
  assert.match(low.reason, /^pay below floor/);
  assert.deepEqual(preTriage(row("Senior Android Engineer", "Remote"), tracker, { text: JD, salary: { max: 90000, currency: "USD", period: "year" } }), PASS);
  assert.deepEqual(preTriage(row("Senior Android Engineer", "Remote"), tracker, { text: JD, salary: { max: 2000000, currency: "COP", period: "month" } }), PASS);
  assert.deepEqual(preTriage(row("Senior Android Engineer", "Remote"), tracker, { text: JD }), PASS);
});

test("urlKey reads markdown links and ignores query and trailing slash", () => {
  assert.equal(urlKey("[x](https://Jobs.Example.com/a/b/?q=1)"), "jobs.example.com/a/b");
  assert.equal(urlKey("local:jds/x.md"), "");
});
