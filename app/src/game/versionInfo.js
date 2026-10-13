// Page side of the build version: ask the local server once, log it to the console and show the short sha in
// the title-screen footer. fetch, document and console are injected so this unit tests without a browser.
export async function loadVersion(fetchFn, doc, con = console) {
  try {
    const res = await fetchFn('/api/version');
    if (!res || res.ok === false) return null;
    const v = await res.json();
    if (!v || typeof v.short !== 'string') return null;
    con.log(`[deadfall] version ${v.sha ?? 'unknown'} ${v.date ?? ''}`.trimEnd());
    const el = doc && doc.getElementById ? doc.getElementById('version-tag') : null;
    if (el) el.textContent = v.short;
    return v;
  } catch {
    return null; // no server (e.g. a static build): the game never needs the version to run
  }
}
