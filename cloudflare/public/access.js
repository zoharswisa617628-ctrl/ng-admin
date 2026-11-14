'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const W = { 'content-type': 'application/json', 'x-ng': '1' };
let data = { entries: [], users: [], owners: [], me: '' };

async function load() {
  const r = await fetch('/api/access', { cache: 'no-store' });
  if (r.status === 401) { location.href = '/auth/login'; return; }
  if (!r.ok) { document.querySelector('main').innerHTML = '<h1>אין לך הרשאה לדף הזה</h1><p class="sub">רק מי שמנהל את האתר יכול לשנות הרשאות.</p><a href="/">חזרה לאתר</a>'; return; }
  data = await r.json(); render();
}
function renderVisits() {
  const v = data.visits || { days: [], people: [] }, byDay = Object.fromEntries(v.days.map(d => [d.day, d]));
  const il = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const list = []; for (let k = 29; k >= 0; k--) { const day = il(Date.now() - k * 864e5), d = byDay[day]; list.push({ day, people: d ? d.people : 0, opens: d ? d.opens : 0 }); }
  const today = list[list.length - 1], week = list.slice(-7), max = Math.max(1, ...list.map(d => d.people));
  const sum = (a, k) => a.reduce((s, d) => s + d[k], 0);
  $('#vsum').innerHTML = [[today.people, 'אנשים היום'], [today.opens, 'פתיחות היום'], [sum(week, 'opens'), 'פתיחות ב־7 ימים'], [v.people.length, 'אנשים ב־30 ימים']]
    .map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
  $('#vbars').innerHTML = list.map(d => `<i class="${d.people ? '' : 'z'}" style="height:${Math.max(3, Math.round(d.people / max * 100))}%" title="${d.day}: ${d.people} אנשים, ${d.opens} פתיחות"></i>`).join('');
  $('#vppl').innerHTML = v.people.length ? v.people.map(p => `<div class="row"><div class="who"><b>${esc(p.name || p.id)}</b></div>
      <span class="tag out">${p.days} ימים · ${p.opens} פתיחות</span><span class="tag in">${esc(when(p.last))}</span></div>`).join('')
    : '<p class="empty">עוד אין נתונים. הספירה מתחילה מהכניסה הבאה לאתר.</p>';
}
function render() {
  renderVisits();
  const owner = id => data.owners.includes(id);
  $('#ex').innerHTML = data.entries.length ? data.entries.map(e => `<div class="row">
      <div class="who"><b>${esc(e.name || 'לא התחבר עדיין')}</b><span>${esc(e.id)}</span>${e.note ? ` · <span style="direction:rtl">${esc(e.note)}</span>` : ''}</div>
      <span class="tag ${e.mode === 'allow' ? 'allow' : 'deny'}">${e.mode === 'allow' ? 'גישה בלי רול' : 'חסום'}</span>
      <button class="sm" data-del="${esc(e.id)}">הסרה</button></div>`).join('')
    : '<p class="empty">אין חריגים. כולם נכנסים לפי הרול בדיסקורד.</p>';
  const exMode = Object.fromEntries(data.entries.map(e => [e.id, e.mode]));
  $('#us').innerHTML = data.users.length ? data.users.map(u => `<div class="row">
      <div class="who"><b>${esc(u.name)}</b><span>${esc(u.id)}</span></div>
      <span class="tag ${owner(u.id) ? 'own' : u.ok ? 'in' : 'out'}">${owner(u.id) ? 'בעלים' : u.ok ? 'נכנס' : 'לא קיבל גישה'} · ${esc(when(u.last))}</span>
      ${owner(u.id) ? '' : `<button class="sm" data-set="kick" data-id="${esc(u.id)}" title="מוציא אותו מכל המכשירים עכשיו">ניתוק</button>`}
      ${owner(u.id) || exMode[u.id] === 'deny' ? '' : `<button class="sm bad" data-set="deny" data-id="${esc(u.id)}">לחסום</button>`}
      ${!u.ok && !owner(u.id) && exMode[u.id] !== 'allow' ? `<button class="sm ok" data-set="allow" data-id="${esc(u.id)}">לתת גישה</button>` : ''}</div>`).join('')
    : '<p class="empty">עוד אף אחד לא התחבר.</p>';
}
async function put(body) {
  const r = await fetch('/api/access', { method: 'PUT', headers: W, body: JSON.stringify(body) });
  if (!r.ok) { $('#msg').textContent = (await r.json().catch(() => ({}))).error === 'owner' ? 'אי אפשר לחסום או לנתק בעלים.' : 'לא הצלחתי לשמור. בדוק את ה־ID ונסה שוב.'; return false; }
  await load(); return true;
}
async function loadHist() {
  const key = $('#hkey').value; $('#hist').innerHTML = '<p class="empty">טוען…</p>';
  const r = await fetch('/api/history?key=' + encodeURIComponent(key), { cache: 'no-store' });
  if (!r.ok) { $('#hist').innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
  const { versions } = await r.json();
  $('#hist').innerHTML = versions.length ? versions.map(v => `<div class="row">
      <div class="who"><b>${esc(when(new Date(v.at).toISOString()))}</b><span>${esc(v.name || v.by || '')}</span></div>
      <span class="tag out">${Math.max(1, Math.round(v.size / 1024))} KB</span>
      <button class="sm" data-restore="${Number(v.hid)}">להחזיר לגרסה הזו</button></div>`).join('')
    : '<p class="empty">אין גרסאות קודמות לנתונים האלה עדיין.</p>';
}
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'hload') return loadHist();
  if (t.dataset.restore) {
    if (!confirm('להחזיר את הנתונים לגרסה הזו? הגרסה הנוכחית תישמר בגיבוי, כך שאפשר לחזור גם ממנה.')) return;
    const r = await fetch('/api/history', { method: 'POST', headers: W, body: JSON.stringify({ key: $('#hkey').value, hid: +t.dataset.restore }) });
    $('#hmsg').textContent = r.ok ? 'הוחזר. כל מי שפתוח עליו האתר יקבל את הגרסה הזו תוך כמה שניות.' : 'לא הצלחתי להחזיר.';
    if (r.ok) loadHist(); return;
  }
  if (t.dataset.add) {
    const id = ($('#nid').value.match(/\d{17,20}/) || [''])[0];
    if (!id) { $('#msg').textContent = 'צריך Discord ID (מספר של 17 עד 20 ספרות).'; return; }
    if (await put({ id, mode: t.dataset.add, note: $('#nnote').value })) { $('#nid').value = ''; $('#nnote').value = ''; $('#msg').textContent = t.dataset.add === 'allow' ? 'נוסף. הוא יוכל להיכנס בהתחברות הבאה שלו.' : 'נחסם ונותק. זה פועל מיד.'; }
  }
  if (t.dataset.del) { if (await put({ id: t.dataset.del, mode: null })) $('#msg').textContent = 'החריג הוסר. עכשיו הוא נכנס רק לפי הרול.'; }
  if (t.dataset.set) { if (await put({ id: t.dataset.id, mode: t.dataset.set })) $('#msg').textContent = t.dataset.set === 'kick' ? 'נותק מכל המכשירים.' : 'נשמר.'; }
});
load();
