// X (x.com, formerly Twitter) hiring-posts scan, pasted into the DevTools console on x.com.
//
// USE AT YOUR OWN DISCRETION. This automates what you would otherwise do by hand: search X for recent
// hiring posts, read them, and keep the ones that are real job openings. It runs in your own logged-in
// browser, reads only what X already shows you, and never likes, replies, reposts, follows or messages
// anyone. It is still automation on X, and X's Terms restrict automated access. Whether and how often you
// run it is your call and your account's risk. It stops as soon as X shows a login page, a rate limit or
// an error page.
//
// How to run it:
//   1. Copy it ready to paste, with the post filter inlined (web/src/lib/linkedin-post.mjs and pre-triage.mjs,
//      the same filter as the LinkedIn scan): the "Copy script" button on the dashboard's Today page, or
//      `node web/src/lib/x-script.mjs | pbcopy`. Pasted straight from this file it has no filter: it warns and stops.
//   2. Open https://x.com/home signed in, open DevTools (Cmd+Opt+J / Ctrl+Shift+J), paste, Enter.
//   3. It opens ONE separate window (same origin, so the script can read it), runs each search there sorted by
//      latest, with human-paced pauses, and downloads x-posts-<date>.json to hand to your agent.
//
// The searches come from portals.yml -> x_post_queries.queries (the copy step fills them in). X search
// operators work there: "exact phrase", (a OR b), -word, -filter:replies. The script adds since:<two days ago>.
// Keep each search broad (role words plus a hiring phrase): the post filter drops the noise, and narrow
// searches with several required words return almost nothing on X.
// Real hiring posts on X rarely use hashtags: phrases like "we're hiring" find more than #hiring.
(async () => {
  // x-script.mjs replaces this line with the queries from portals.yml; these are only the fallback.
  const QUERIES = ['("we\'re hiring" OR hiring) android remote -filter:replies']; // QUERIES
  // x-script.mjs fills this from the profile with only {usAuthorized}; nothing else from it reaches X.
  const PROFILE = {}; // PROFILE
  // Meant to run once a day. Two days, not one: the 2026-11-02 pilot found only 20 posts across five searches
  // with one day, and posts already read are skipped by the agent's dedup anyway.
  const SINCE_DAYS = 2;
  // With a one-day window the results run out quickly; the cap only stops a search that never ends.
  const MAX_SCROLLS = 30;

  // web/src/lib/x-script.mjs replaces this line with linkedin-post.mjs and pre-triage.mjs.
  const modules = null; // MODULES
  if (!modules) {
    console.warn('This is the raw script, without the post filter. Copy it with the dashboard\'s "Copy script" button or: node web/src/lib/x-script.mjs | pbcopy');
    return;
  }
  const { splitPost, judgePost, dedupKey, preTriage } = modules;
  const EMPTY_SCROLLS_TO_STOP = 3;
  const WAIT_FOR_MORE_MS = 4000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Variable pauses, like someone reading: never the same interval twice.
  const pause = (minMs, maxMs) => sleep(minMs + Math.random() * (maxMs - minMs));
  const since = new Date(Date.now() - SINCE_DAYS * 864e5).toLocaleDateString('en-CA');
  const searchUrl = (query) => 'https://x.com/search?q=' + encodeURIComponent(`${query} since:${since}`) + '&src=typed_query&f=live';

  function isBlockedPage(doc) {
    const text = (doc.body && doc.body.innerText) || '';
    return /rate limit exceeded|something went wrong\. try reloading|sign in to x|log in to x|verify you.re human/i.test(text.slice(0, 3000))
      || /\/i\/flow\/login|\/login|\/account\/access/.test(doc.location.pathname);
  }

  async function waitForResults(win) {
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      try {
        const doc = win.document;
        if (isBlockedPage(doc)) return false;
        if (doc.readyState === 'complete' && (doc.querySelector('article[data-testid="tweet"]') || /no results for/i.test(doc.body.innerText))) return true;
      } catch { /* the window is still loading */ }
    }
    return false;
  }

  // One post: author ("Name @handle"), its text as lines, and its own link (the status link that holds the
  // post's time). A quoted post sits inside the article too; its text has its own tweetText, so only the
  // first one, the post itself, is read.
  function readArticle(article) {
    const name = article.querySelector('[data-testid="User-Name"]');
    const author = name ? name.innerText.split('\n').filter((part) => part && part !== '·').slice(0, 2).join(' ') : '';
    const textNode = article.querySelector('[data-testid="tweetText"]');
    // X shows a link as "https://" and the rest on separate lines; its textContent is the whole link.
    let text = textNode ? textNode.innerText : '';
    if (textNode) for (const anchor of textNode.querySelectorAll('a')) if (anchor.innerText.includes('\n')) text = text.split(anchor.innerText).join(anchor.textContent);
    // A post is often one long line: split it into sentences too, so the filter finds the role as its own line.
    const lines = text.split(/\n|(?<=[.!?])\s+(?=[A-Z¿¡])/).map((line) => line.trim()).filter(Boolean);
    const time = article.querySelector('a[href*="/status/"] time');
    const href = time && time.closest('a') ? time.closest('a').getAttribute('href') : null;
    const url = href && /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(href) ? `https://x.com${href}` : null;
    // A post longer than X shows ends with "Show more"; the full text is one click away on its own page.
    const truncated = Boolean(article.querySelector('[data-testid="tweet-text-show-more-link"]'));
    return { author, lines, url, truncated };
  }

  // Fixed panel in the search window: every post read, with its number, author and verdict, to confirm by eye
  // that none is skipped.
  const COLORS = { candidate: '#22c55e', discarded: '#ef4444', repeated: '#60a5fa' };
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

  // How long a person stays on a post: what is not interesting gets about a second, a candidate a little more.
  const DWELL_SKIP = [600, 1100];
  const DWELL_CANDIDATE = [1500, 3000];

  // Reads and judges each post as soon as it appears, since X removes posts above the screen while scrolling.
  // seen: post links (or author+text) from earlier searches. byKey: candidates by dedupKey, so the same text
  // posted by someone else lands in the first one's alsoBy.
  async function scanQuery(win, query, seen, byKey) {
    const doc = win.document;
    const counts = { query, scrolls: 0, total: 0, repeated: 0, candidates: 0, duplicates: 0, noLink: 0, truncated: 0,
      seeker: 0, notHiring: 0, noRole: 0, offStack: 0, jobList: 0, blocked: 0, preTriage: 0 };
    if (!doc.querySelector('article[data-testid="tweet"]')) return { counts: { ...counts, noResults: true }, candidates: [], discarded: [] };
    const candidates = [];
    const discarded = [];
    const readHere = new Set();
    const logPost = (reason, author, title) => console.log(`   [${reason}] ${author.slice(0, 40)} | ${title.slice(0, 100)}`);
    const blocked = () => {
      if (!counts.stopped && isBlockedPage(doc)) counts.stopped = 'login, rate limit or error page';
      return Boolean(counts.stopped);
    };
    const panel = makePanel(doc);
    const updateHeader = () => panel.header(`${query.slice(0, 60)} | read: ${readHere.size} | candidates: ${counts.candidates + counts.duplicates}`
      + ` | discarded: ${discarded.length} | already seen: ${counts.repeated}`);
    updateHeader();
    const mark = (article, color, author, label) => {
      article.style.outline = `4px solid ${color}`;
      article.style.outlineOffset = '-4px';
      panel.add(`#${readHere.size} ${author.slice(0, 28)} | ${label}`, color);
      updateHeader();
    };

    // A long post shows a "Show more" button that expands its text in place: press it like a person would,
    // then read. When it is a link to the post's own page instead, it is left alone (following it would take
    // the search window away) and the post stays marked truncated.
    async function expand(article) {
      const more = article.querySelector('[data-testid="tweet-text-show-more-link"]');
      if (!more || more.getAttribute('href')) return;
      await pause(300, 700);
      more.click();
      for (let waited = 0; waited < 2500 && article.querySelector('[data-testid="tweet-text-show-more-link"]'); waited += 250) await sleep(250);
    }

    async function processPost(article) {
      const shown = readArticle(article);
      const id = shown.url || `${shown.author}|${shown.lines.join(' ').slice(0, 200)}`;
      if (readHere.has(id)) return;
      readHere.add(id);
      article.scrollIntoView({ block: 'center' });
      await pause(100, 250);
      if (shown.truncated && !seen.has(id)) await expand(article);
      const { author, lines, url, truncated } = readArticle(article);
      if (seen.has(id)) {
        counts.repeated++;
        mark(article, COLORS.repeated, author, 'already seen in another search');
        await pause(...DWELL_SKIP);
        return;
      }
      seen.add(id);
      counts.total++;
      // splitPost cleans the lines like the LinkedIn scan does, but it treats everything up to the age line
      // ("6h") as the author header. An X post has no such header, so give it one: without it, the post's
      // first line (usually the "we're hiring" line) was dropped as if it were the author (pilot, 2026-11-02).
      const { body } = splitPost([author || 'x', '0m', ...lines]);
      const verdict = judgePost({ author, body: body.length ? body : lines }, preTriage, PROFILE);
      const { title, location, kind, reason } = verdict;
      if (reason) {
        counts[kind]++;
        logPost(reason, author, title || lines[0] || '');
        discarded.push({ query, author, url, title, location, reason, lines });
        mark(article, COLORS.discarded, author, reason.slice(0, 50));
        await pause(...DWELL_SKIP);
        return;
      }
      await pause(...DWELL_CANDIDATE);
      if (!url) counts.noLink++;
      if (truncated) counts.truncated++;
      const key = dedupKey(title, lines);
      const first = byKey.get(key);
      if (first) {
        counts.duplicates++;
        logPost('REPEATED', author, title);
        first.alsoBy.push({ url, query, author, title, lines, truncated });
        mark(article, COLORS.candidate, author, `REPEATED from another author: ${title.slice(0, 30)}`);
      } else {
        counts.candidates++;
        logPost(url ? 'CANDIDATE' : 'CANDIDATE, no link', author, title);
        const candidate = { url, query, author, title, location, lines, truncated, alsoBy: [] };
        byKey.set(key, candidate);
        candidates.push(candidate);
        mark(article, COLORS.candidate, author, `CANDIDATE${truncated ? ' (truncated)' : ''}: ${title.slice(0, 35)}`);
      }
    }

    const unread = () => [...doc.querySelectorAll('article[data-testid="tweet"]')].filter((article) => {
      const { author, lines, url } = readArticle(article);
      return !readHere.has(url || `${author}|${lines.join(' ').slice(0, 200)}`);
    });
    async function readNew() {
      let processed = 0;
      for (let pending = unread(); pending.length && !blocked(); pending = unread()) {
        for (const article of pending) {
          if (blocked()) break;
          if (!article.isConnected) continue;
          await processPost(article);
          processed++;
        }
      }
      return processed;
    }
    const waitForMore = async () => {
      for (let waited = 0; waited < WAIT_FOR_MORE_MS; waited += 250) {
        await sleep(250);
        if (blocked() || unread().length) return;
      }
    };

    await readNew();
    let emptyScrolls = 0;
    while (!counts.stopped && counts.scrolls < MAX_SCROLLS && emptyScrolls < EMPTY_SCROLLS_TO_STOP) {
      win.scrollBy(0, win.innerHeight * 0.9);
      counts.scrolls++;
      await waitForMore();
      if (counts.stopped) break;
      const grew = (await readNew()) > 0;
      emptyScrolls = grew ? 0 : emptyScrolls + 1;
      await pause(300, 800);
    }
    return { counts, candidates, discarded };
  }

  // A separate window, not a tab: in a hidden tab the browser does not render the page and X stops loading
  // posts. Do not cover it while it runs.
  const win = window.open('about:blank', 'x-posts-scan', 'popup,width=1000,height=900');
  if (!win) { console.warn('The browser blocked the new window: allow pop-ups for x.com and paste the script again.'); return; }
  // Local date (not UTC): the dashboard looks for today's file by this name.
  const report = { date: new Date().toLocaleDateString('en-CA'), since, runs: [], candidates: [], discarded: [] };
  const seen = new Set();
  const byKey = new Map();
  for (const [index, query] of QUERIES.entries()) {
    console.log(`[${index + 1}/${QUERIES.length}] Searching: ${query} since:${since}`);
    win.location.href = searchUrl(query);
    if (!(await waitForResults(win))) { console.warn('The search did not load, or X asked to log in or hit a rate limit. Stopping here: sort it out and run again.'); break; }
    await pause(800, 1500);
    let emptyQuery = false;
    try {
      const { counts, candidates, discarded } = await scanQuery(win, query, seen, byKey);
      report.runs.push(counts);
      report.candidates.push(...candidates);
      report.discarded.push(...discarded);
      emptyQuery = Boolean(counts.noResults);
      console.log(`   ${counts.total} new posts (${counts.repeated} already seen in another search): ${counts.candidates} candidates, `
        + `${counts.duplicates} repeated from another author (${counts.noLink} with no link, ${counts.truncated} truncated), `
        + `${counts.seeker} looking for work or offering services, ${counts.notHiring} not hiring, ${counts.noRole} no role, `
        + `${counts.jobList} job lists, ${counts.blocked} blocked, ${counts.offStack} off stack, ${counts.preTriage} by pre-triage`);
      if (counts.stopped) { console.warn(`${counts.stopped} on the search: ${query}. Stopping here: sort it out and run again.`); break; }
    } catch (error) {
      console.warn(error.message, '. Stopping here.');
      break;
    }
    if (index < QUERIES.length - 1) await (emptyQuery ? pause(1500, 3000) : pause(2500, 5000));
  }
  console.log('The search window stays open: check that every post got a border (green, red or blue), then close it.');

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `x-posts-${report.date}.json`;
  link.click();
  console.table(report.candidates.map(({ author, query, title, url, alsoBy }) => ({ author, query: query.slice(0, 40), title: title.slice(0, 80), url, alsoBy: alsoBy.length })));
  console.log(`Done: ${report.candidates.length} candidates and ${report.discarded.length} discarded in ~/Downloads/x-posts-${report.date}.json`);
})();
