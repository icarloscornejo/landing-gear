// LinkedIn hiring-posts scan, pasted into the DevTools console on linkedin.com.
//
// USE AT YOUR OWN DISCRETION. This automates what you would otherwise do by hand: search LinkedIn posts from
// the last 24 hours, read them, and keep the ones that are real job openings. It runs in your own logged-in
// browser, reads only what LinkedIn already shows you, and never likes, comments, connects or messages anyone.
// It is still automation on LinkedIn, and LinkedIn's User Agreement restricts automated access. Whether and how
// often you run it is your call and your account's risk. It stops as soon as LinkedIn shows a CAPTCHA, a
// verification or a login page.
//
// How to run it:
//   1. Copy it ready to paste, with the post filter inlined (web/src/lib/linkedin-post.mjs and pre-triage.mjs):
//      the "Copy script" button on the dashboard's Today page, or `node web/src/lib/linkedin-script.mjs | pbcopy`.
//      Pasted straight from this file it has no filter: it warns and stops.
//   2. Open https://www.linkedin.com/feed/ signed in, open DevTools (Cmd+Opt+J / Ctrl+Shift+J), paste, Enter.
//   3. It opens ONE separate window (same origin, so the script can read it), runs each search there with
//      human-paced pauses, and downloads linkedin-posts-<date>.json to hand to your agent.
//
// The searches come from portals.yml -> linkedin_post_queries.queries (the copy step fills them in). Keep them
// short: LinkedIn's post search wants every word to appear in the post. Never add NOT terms: they made LinkedIn
// return 0 posts for every search when tried.
(async () => {
  // linkedin-script.mjs replaces this line with the queries from portals.yml; these are only the fallback.
  const QUERIES = ['android remote', 'mobile engineer remote', 'AI engineer remote']; // QUERIES
  // linkedin-script.mjs fills this from the profile with only {usAuthorized}; nothing else from it reaches LinkedIn.
  const PROFILE = {}; // PROFILE
  // Always the last 24 hours: the scan is meant to run once a day.
  const DATE_POSTED = 'past-24h';
  // With 24 hours the results run out quickly; the cap only stops a search that never ends. With "Load more"
  // each round brings 5 to 10 posts and broad searches pass 100.
  const MAX_SCROLLS = 25;

  // web/src/lib/linkedin-script.mjs replaces this line with linkedin-post.mjs and pre-triage.mjs.
  const modules = null; // MODULES
  if (!modules) {
    console.warn('This is the raw script, without the post filter. Copy it with the dashboard\'s "Copy script" button or: node web/src/lib/linkedin-script.mjs | pbcopy');
    return;
  }
  const { splitPost, judgePost, dedupKey, preTriage } = modules;
  // Stop after this many scrolls in a row with no new posts. LinkedIn loads unevenly: the same search read
  // 47 posts in one run and 12 in another with 2 scrolls of 2.5 s.
  const EMPTY_SCROLLS_TO_STOP = 3;
  const WAIT_FOR_MORE_MS = 4000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Variable pauses, like someone reading: never the same interval twice.
  const pause = (minMs, maxMs) => sleep(minMs + Math.random() * (maxMs - minMs));
  const searchUrl = (query) => 'https://www.linkedin.com/search/results/content/?keywords=' + encodeURIComponent(query)
    + '&datePosted=%22' + DATE_POSTED + '%22&sortBy=%22date_posted%22';

  // "Copy link to post" copies a short link (https://lnkd.in/p/...).
  const LINK = /https:\/\/(www\.linkedin\.com|lnkd\.in)\/[^\s"']+/;

  function isBlockedPage(doc) {
    const text = (doc.body && doc.body.innerText) || '';
    return /captcha|security verification|let.s do a quick security check|sign in to linkedin|join linkedin/i.test(text.slice(0, 3000))
      || /checkpoint|authwall|login/.test(doc.location.pathname);
  }

  async function waitForResults(win) {
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      try {
        if (win.document.readyState === 'complete' && win.document.querySelector('main#workspace')) return true;
        if (isBlockedPage(win.document)) return false;
      } catch { /* the window is still loading */ }
    }
    return false;
  }

  // LinkedIn no longer leaves the post id in the HTML. Each post is found by its hidden "Feed post" label,
  // walking up to the largest container that holds only that post.
  function postContainers(main) {
    const labels = [...main.querySelectorAll('*')].filter((element) => element.childElementCount === 0 && element.textContent.trim() === 'Feed post');
    return labels.map((label) => {
      let node = label;
      while (node.parentElement && node.parentElement !== main && node.parentElement.innerText.length < 8000
        && !/Feed post[\s\S]*Feed post/.test(node.parentElement.innerText)) node = node.parentElement;
      return node;
    });
  }

  // "Copy link to post" from the 3-dot menu. LinkedIn copies with clipboard.writeText or execCommand('copy');
  // both are caught in this window, so the link never reaches your clipboard and no clipboard permission is needed.
  function watchCopies(win) {
    const copied = { text: null };
    if (win.navigator.clipboard) win.navigator.clipboard.writeText = async (text) => { copied.text = String(text); };
    win.document.addEventListener('copy', () => {
      const active = win.document.activeElement;
      copied.text = copied.text || (active && active.value) || win.getSelection().toString() || null;
    }, true);
    return copied;
  }

  let menuWarned = false;
  // Always through the menu: a /feed/update/ link inside the container can belong to a post shared inside it.
  async function copyPostLink(win, container, copied) {
    const doc = win.document;
    const buttons = [...container.querySelectorAll('button')];
    const menuButton = buttons.find((button) => /control menu|more actions|options for|open options|men[uú] de control|m[aá]s acciones/i.test(button.getAttribute('aria-label') || ''));
    if (!menuButton) {
      // Once: the labels the buttons do have, to adjust the regex above.
      if (!menuWarned) { menuWarned = true; console.warn('   3-dot menu button not found. aria-labels of the post buttons:', buttons.map((button) => button.getAttribute('aria-label')).filter(Boolean)); }
      return null;
    }
    // A person's mouse timing: move to the button, then to the menu item.
    container.scrollIntoView({ block: 'center' });
    await pause(700, 1200);
    copied.text = null;
    menuButton.click();
    let item = null;
    for (let waited = 0; waited < 2000 && !item; waited += 200) {
      await sleep(200);
      item = [...doc.querySelectorAll('[role="menuitem"], [role="menu"] *, li, button')].find((element) => /^(copy link to post|copiar (el )?enlace (a la|de la) publicaci[oó]n)$/i.test((element.innerText || '').trim()));
    }
    if (!item) {
      if (!menuWarned) { menuWarned = true; console.warn('   Opened the 3-dot menu but "Copy link to post" was not there.'); }
      doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return null;
    }
    await pause(300, 700);
    item.click();
    for (let waited = 0; waited < 1500 && !copied.text; waited += 150) await sleep(150);
    const match = copied.text && copied.text.match(LINK);
    return match ? match[0].split('?')[0] : null;
  }

  // Fixed panel in the search window: every post read, with its number, author and verdict, to confirm by eye
  // that none is skipped. It lives in body, outside main#workspace, so it never counts as a post.
  const COLORS = { candidate: '#22c55e', discarded: '#ef4444', repeated: '#60a5fa' };
  // The post container is display: contents (no box, so a border there is invisible): paint the first child
  // that has a box, the post card.
  const boxOf = (element) => {
    let node = element;
    while (node && node.ownerDocument.defaultView.getComputedStyle(node).display === 'contents') node = node.firstElementChild;
    return node || element;
  };
  function makePanel(doc) {
    const panel = doc.createElement('div');
    panel.style.cssText = 'position:fixed;top:70px;right:12px;width:400px;max-height:70vh;overflow:auto;z-index:2147483647;'
      + 'background:#111;color:#eee;font:12px/1.4 monospace;padding:8px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    const header = doc.createElement('div');
    header.style.cssText = 'font-weight:bold;margin-bottom:6px;position:sticky;top:0;background:#111';
    const list = doc.createElement('div');
    panel.append(header, list);
    doc.body.append(panel);
    return {
      header: (text) => { header.textContent = text; },
      add: (text, color) => {
        const row = doc.createElement('div');
        row.textContent = text;
        row.style.color = color;
        list.append(row);
        panel.scrollTop = panel.scrollHeight;
      },
    };
  }

  // A post's identity: author plus all its alphanumeric text. Same post if one text starts the other, in case
  // LinkedIn mounts a post again with less text.
  const MIN_PREFIX = 40;
  // How long a person stays on a post: what is not interesting gets 0 to 3 s; a candidate is skimmed before
  // copying its link.
  const DWELL_SKIP = [800, 1300];
  const DWELL_CANDIDATE = [2000, 4000];
  const identityOf = (author, body) => ({ author, text: body.join(' ').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '') });
  const sameAs = (list, identity) => list.some((known) => known.author === identity.author && (known.text === identity.text
    || (Math.min(known.text.length, identity.text.length) >= MIN_PREFIX && (known.text.startsWith(identity.text) || identity.text.startsWith(known.text)))));

  // Reads and judges each post as soon as it appears, so posts LinkedIn removes from the HTML above are already
  // read. seen: identities from earlier searches. byKey: candidates by dedupKey, so the same text posted by
  // someone else lands in the first one's alsoBy.
  async function scanQuery(win, query, seen, byKey) {
    const doc = win.document;
    const main = doc.querySelector('main#workspace');
    const countPosts = () => (main.innerText.match(/Feed post/g) || []).length;
    const counts = { query, scrolls: 0, loadMore: 0, total: 0, repeated: 0, candidates: 0, duplicates: 0, noLink: 0,
      seeker: 0, notHiring: 0, noRole: 0, offStack: 0, jobList: 0, blocked: 0, preTriage: 0, maxOnScreen: 0, containers: 0 };
    // Wait for posts or the "No results found" notice (about 8 s at most); with no results, move on to the next
    // search right away instead of scrolling an empty page.
    for (let attempt = 0; attempt < 16 && countPosts() === 0; attempt++) {
      if (/No results found/i.test(main.innerText)) return { counts: { ...counts, noResults: true }, candidates: [], discarded: [] };
      await sleep(500);
    }
    // No "...more" clicks: the full text is already in the page, the button only reveals it.
    const copied = watchCopies(win);
    const candidates = [];
    const discarded = [];
    const readHere = [];
    // One line per post with its reason, to compare with what is on screen.
    const logPost = (reason, author, title) => console.log(`   [${reason}] ${author.slice(0, 40)} | ${title.slice(0, 100)}`);
    const containersNow = () => {
      const list = postContainers(main);
      counts.maxOnScreen = Math.max(counts.maxOnScreen, list.length);
      return list;
    };
    const blocked = () => {
      if (!counts.stopped && isBlockedPage(doc)) counts.stopped = 'CAPTCHA or verification';
      return Boolean(counts.stopped);
    };
    const readPost = (container) => {
      const { author, body } = splitPost(container.innerText.split('\n'));
      return { author, body, identity: identityOf(author, body) };
    };
    const panel = makePanel(doc);
    const updateHeader = () => panel.header(`${query} | read: ${counts.containers} | candidates: ${counts.candidates + counts.duplicates}`
      + ` | discarded: ${discarded.length} | already seen: ${counts.repeated}`);
    updateHeader();
    // Border on the post (green candidate, red discarded, blue already seen) and a line in the panel.
    const mark = (container, color, author, label) => {
      const card = boxOf(container);
      card.style.outline = `4px solid ${color}`;
      card.style.outlineOffset = '-4px';
      panel.add(`#${counts.containers} ${author.slice(0, 28)} | ${label}`, color);
      updateHeader();
    };

    // Scroll to the post so it is on screen before staying on it.
    const showPost = async (container) => {
      container.scrollIntoView({ block: 'center' });
      await pause(100, 250);
    };

    // Returns true when it opened the post's menu (and so the page moved).
    async function processPost(container, { author, body, identity }) {
      readHere.push(identity);
      counts.containers = readHere.length;
      // People looking for work: skipped quickly, without scrolling to them.
      const verdict = sameAs(seen, identity) ? null : judgePost({ author, body }, preTriage, PROFILE);
      if (verdict && verdict.kind === 'seeker') {
        seen.push(identity);
        counts.total++;
        counts.seeker++;
        logPost(verdict.reason, author, verdict.title);
        discarded.push({ query, author, title: verdict.title, location: verdict.location, reason: verdict.reason, lines: body });
        mark(container, COLORS.discarded, author, verdict.reason.slice(0, 50));
        await pause(400, 600);
        return false;
      }
      await showPost(container);
      if (!verdict) {
        counts.repeated++;
        mark(container, COLORS.repeated, author, 'already seen in another search');
        await pause(...DWELL_SKIP);
        return false;
      }
      seen.push(identity);
      counts.total++;
      const { title, location, kind, reason } = verdict;
      if (reason) {
        counts[kind]++;
        logPost(reason, author, title);
        // Full text, to check later whether the filter dropped something good and why.
        discarded.push({ query, author, title, location, reason, lines: body });
        mark(container, COLORS.discarded, author, reason.slice(0, 50));
        await pause(...DWELL_SKIP);
        return false;
      }
      await pause(...DWELL_CANDIDATE);
      const url = await copyPostLink(win, container, copied);
      if (!url) counts.noLink++;
      // The same text by another author brings its own link, and sometimes another apply link.
      const key = dedupKey(title, body);
      const first = byKey.get(key);
      if (first) {
        counts.duplicates++;
        logPost(url ? 'REPEATED' : 'REPEATED, no link', author, title);
        first.alsoBy.push({ url, query, author, title, lines: body });
        mark(container, COLORS.candidate, author, `REPEATED from another author${url ? '' : ' (no link)'}: ${title.slice(0, 30)}`);
      } else {
        counts.candidates++;
        logPost(url ? 'CANDIDATE' : 'CANDIDATE, no link', author, title);
        const candidate = { url, query, author, title, location, lines: body, alsoBy: [] };
        byKey.set(key, candidate);
        candidates.push(candidate);
        mark(container, COLORS.candidate, author, `CANDIDATE${url ? '' : ' (no link)'}: ${title.slice(0, 35)}`);
      }
      // After saving it, so the post that hit the verification is not lost.
      blocked();
      return true;
    }

    // Processes every unread post on screen, one at a time. The list is collected again after opening a menu
    // (copyPostLink moves the page).
    async function readNew() {
      let processed = 0;
      while (!blocked()) {
        const pending = containersNow().filter((container) => !sameAs(readHere, readPost(container).identity));
        if (!pending.length) break;
        let progressed = false;
        for (const container of pending) {
          if (blocked()) break;
          if (!container.isConnected) continue;
          // processPost decides whether to scroll to the post and how long to stay, from the verdict.
          const post = readPost(container);
          if (sameAs(readHere, post.identity)) continue;
          const moved = await processPost(container, post);
          processed++;
          progressed = true;
          if (moved) break;
        }
        if (!progressed) break;
      }
      return processed;
    }

    // After each scroll, go on as soon as an unread post appears (no fixed pause); if none appears within
    // WAIT_FOR_MORE_MS, it counts as an empty scroll. The number of posts on screen is not used: when LinkedIn
    // removes posts above while adding below, that number does not grow.
    const waitForMore = async () => {
      for (let waited = 0; waited < WAIT_FOR_MORE_MS; waited += 250) {
        await sleep(250);
        if (blocked()) return;
        if (containersNow().some((container) => !sameAs(readHere, readPost(container).identity))) return;
      }
    };

    const loadMoreButton = () => [...main.querySelectorAll('button, [role="button"]')].find((button) => button.offsetParent
      && /^(load more|show more results|see more results|more results|cargar m[aá]s|ver m[aá]s resultados|mostrar m[aá]s resultados)$/i.test((button.innerText || '').trim()));

    await readNew();
    let emptyScrolls = 0;
    while (!counts.stopped && counts.scrolls < MAX_SCROLLS && emptyScrolls < EMPTY_SCROLLS_TO_STOP) {
      main.scrollTo(0, main.scrollHeight);
      counts.scrolls++;
      await waitForMore();
      if (counts.stopped) break;
      let grew = (await readNew()) > 0;
      if (counts.stopped) break;
      // In a narrow window (just the posts column) LinkedIn does not load on scroll: it puts "Load more" at
      // the end. In a wide window it loads by itself. It gets clicked like a person would.
      const loadMore = grew ? null : loadMoreButton();
      if (loadMore) {
        loadMore.scrollIntoView({ block: 'center' });
        await pause(700, 1200);
        loadMore.click();
        counts.loadMore++;
        await waitForMore();
        if (counts.stopped) break;
        grew = (await readNew()) > 0;
        if (counts.stopped) break;
      }
      emptyScrolls = grew ? 0 : emptyScrolls + 1;
      if (!grew) {
        // Without moving, the next scrollTo lands on the same position and no event triggers the load.
        main.scrollBy(0, -main.clientHeight);
        await pause(300, 700);
        continue;
      }
      await pause(300, 800);
    }
    if (!counts.stopped) await readNew();
    // In the JSON too, to review a search that brings few posts without relying on the console.
    // containers > maxOnScreen: LinkedIn removed posts from the HTML while scrolling and they were still read.
    counts.onScreen = countPosts();
    console.log(`   On screen at the end: ${counts.onScreen} "Feed post"; most at once: ${counts.maxOnScreen}; read: ${counts.containers}`);
    return { counts, candidates, discarded };
  }

  // A separate window, not a tab: in a hidden tab Chrome does not render the page and LinkedIn stops loading
  // posts (3 posts in a background tab, 40 in a visible window). Do not cover it while it runs.
  const win = window.open('about:blank', 'linkedin-posts-scan', 'popup,width=1100,height=900');
  if (!win) { console.warn('Chrome blocked the new window: allow pop-ups for linkedin.com and paste the script again.'); return; }
  // Local date (not UTC): the dashboard looks for today's file by this name.
  const report = { date: new Date().toLocaleDateString('en-CA'), runs: [], candidates: [], discarded: [] };
  const seen = [];
  const byKey = new Map();
  for (const [index, query] of QUERIES.entries()) {
    console.log(`[${index + 1}/${QUERIES.length}] Searching: ${query}`);
    win.location.href = searchUrl(query);
    if (!(await waitForResults(win))) { console.warn('The search did not load or asked for verification. Stopping here: sort it out and run again.'); break; }
    // scanQuery already waits for the posts, a short pause is enough here.
    await pause(800, 1500);
    let emptyQuery = false;
    try {
      const { counts, candidates, discarded } = await scanQuery(win, query, seen, byKey);
      report.runs.push(counts);
      report.candidates.push(...candidates);
      report.discarded.push(...discarded);
      emptyQuery = Boolean(counts.noResults);
      // candidates + repeated + every discard reason = total.
      console.log(`   ${counts.total} new posts (${counts.repeated} already seen in another search): ${counts.candidates} candidates, `
        + `${counts.duplicates} repeated from another author (${counts.noLink} with no link in total), ${counts.seeker} looking for work or offering services, `
        + `${counts.notHiring} not hiring, ${counts.noRole} no role, ${counts.jobList} job lists, ${counts.blocked} blocked, `
        + `${counts.offStack} off stack, ${counts.preTriage} by pre-triage`);
      // What was collected is already in the report; after a CAPTCHA no more searches run.
      if (counts.stopped) { console.warn(`${counts.stopped} on the search: ${query}. Stopping here: sort it out and run again.`); break; }
    } catch (error) {
      console.warn(error.message, '. Stopping here.');
      break;
    }
    // A page with no results is not "read": the next search starts almost at once.
    if (index < QUERIES.length - 1) await (emptyQuery ? pause(1500, 3000) : pause(2000, 4000));
  }
  console.log('The search window stays open: check that every post got a border (green, red or blue), then close it.');

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `linkedin-posts-${report.date}.json`;
  link.click();
  console.table(report.candidates.map(({ author, query, title, url, alsoBy }) => ({ author, query, title: title.slice(0, 80), url, alsoBy: alsoBy.length })));
  console.log(`Done: ${report.candidates.length} candidates and ${report.discarded.length} discarded in ~/Downloads/linkedin-posts-${report.date}.json`);
})();
