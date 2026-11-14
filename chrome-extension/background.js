// Runs in the background whenever this Chrome is open. Every EVERY_MIN it checks whether someone (in any
// management member's browser that has this installed) already synced recently; if not, and this browser
// is logged in to both staff.example.com and YOUR-PROJECT.pages.dev, it does the sync itself.
// Read-only on the staff site. On our own site it only writes the shared doc team/ng_feed / team/ng_feed_st.
const SITE = 'https://staff.example.com';
const APP = 'https://YOUR-PROJECT.pages.dev';
const EXT_TOKEN = 'YOUR_RANDOM_TOKEN';   // must match EXT_TOKEN in cloudflare/wrangler.toml
const EVERY_MIN = 30;                 // how often this browser checks in
const FRESH_MS = EVERY_MIN * 60e3 * 0.8;   // skip if someone already synced more recently than this
const PERSON_EVERY_MS = 6 * 3600e3;   // each person's own page (warnings/notes/history): about every 6h
const PERSON_MAX = 30;                // people refreshed per run (stays well under the free-plan request limit)

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('sync', { periodInMinutes: EVERY_MIN }); run(); });
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('sync', { periodInMinutes: EVERY_MIN }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sync') run(); });
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg === 'sync-now') { run(true).then(r => sendResponse(r)); return true; }
});

async function getDoc(path) {
  const r = await fetch(`${APP}/api/doc?path=${encodeURIComponent(path)}`, { credentials: 'include' });
  if (r.status === 401 || r.status === 403) { const e = new Error('app_login'); e.where = 'app'; throw e; }
  if (!r.ok) throw new Error('app ' + r.status);
  return r.json();
}
async function putDoc(path, body) {
  const r = await fetch(`${APP}/api/doc?path=${encodeURIComponent(path)}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-ng-ext': EXT_TOKEN },
    body: JSON.stringify(body),
  });
  if (r.status === 401 || r.status === 403) { const e = new Error('app_login'); e.where = 'app'; throw e; }
  if (!r.ok) throw new Error('app put ' + r.status);
  return r.json();
}
async function getStaff(path) {
  const r = await fetch(SITE + path, { credentials: 'include', headers: { accept: 'application/json' } });
  if (r.status === 401 || r.status === 403) { const e = new Error('staff_login'); e.where = 'staff'; throw e; }
  if (!r.ok) throw new Error('staff ' + r.status);
  return r.json();
}
async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: { ...status, at: new Date().toISOString() } });
}

async function run(manual) {
  try {
    if (!manual) {
      const st = await getDoc('team/ng_feed_st').catch(e => (e.where === 'app' ? Promise.reject(e) : null));
      const lastAt = st && st.v && st.v.at;
      if (lastAt && Date.now() - Date.parse(lastAt) < FRESH_MS) { await setStatus({ ok: true, skipped: 'fresh' }); return { ok: true, skipped: 'fresh' }; }
    }
    const [s, a] = await Promise.all([getStaff('/api/admin/staff'), getStaff('/api/admin/activity')]);
    if (!Array.isArray(s) || !s.length) throw new Error('empty staff list');

    const prevFeed = await getDoc('team/ng_feed').catch(() => null);
    const prev = (prevFeed && prevFeed.v) || {};
    if (prev.staff && s.length < prev.staff.length * 0.8) throw new Error('staff list looks incomplete');
    const hist = prev.hist || {}, info = prev.info || {}, pt = prev.pt || {};
    const live = new Set(s.map(x => x.discordId));
    for (const id of Object.keys(pt)) if (!live.has(id)) { delete pt[id]; delete hist[id]; delete info[id]; }

    const now = Date.now();
    const due = s.map(x => x.discordId).filter(id => !pt[id] || now - pt[id] > PERSON_EVERY_MS)
      .sort((x, y) => (pt[x] || 0) - (pt[y] || 0)).slice(0, PERSON_MAX);
    for (const id of due) {
      const p = await getStaff('/api/admin/staff/' + id);
      hist[id] = (p.activityWeeks || []).map(w => [w.weekStart, w.tickets, w.reports, w.onLeave ? 1 : 0]);
      info[id] = { w: (p.warnings || []).map(w => ({ n: w.number, r: w.reason || '', d: w.detail || '', t: w.typeLabel || '', at: w.issuedAt, ex: w.expiresAt })),
        no: (p.notes || []).map(x => ({ x: x.text || '', at: x.createdAt })) };
      pt[id] = now;
    }
    const feed = { ng: 1, bv: 3, at: new Date(now).toISOString(), hist, info, pt,
      staff: s.map(x => ({ id: x.discordId, n: x.niceName, rk: x.rankKey, ac: x.activity, ns: !!x.notSlot, nr: x.notSlotReason || '', ab: !!x.onLeave, hd: !!x.held, j: x.joinedAt, rs: x.rankSince })),
      act: { rAt: a.reportsAt || null, tAt: a.ticketsAt || null, rows: (a.results || []).map(x => [x.discordId, x.tickets, x.reports]) } };
    await putDoc('team/ng_feed', feed);
    await putDoc('team/ng_feed_st', { ok: true, at: new Date(now).toISOString() });
    await setStatus({ ok: true, people: s.length, pages: due.length });
    return { ok: true, people: s.length, pages: due.length };
  } catch (e) {
    const where = e.where || '';
    const err = where === 'staff' ? 'staff_login' : where === 'app' ? 'app_login' : String(e.message || e);
    try { await putDoc('team/ng_feed_st', { ok: false, err, at: new Date().toISOString() }); } catch {}   // no-op if the app login itself is the problem
    await setStatus({ ok: false, err });
    return { ok: false, err };
  }
}
