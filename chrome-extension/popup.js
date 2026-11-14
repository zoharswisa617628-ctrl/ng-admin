const timeAgo = iso => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 2 ? 'רגע' : m < 90 ? m + ' דקות' : Math.round(m / 60) + ' שעות';
};
const ERR_HE = { staff_login: 'לא מחובר לאתר הצוות בכרום הזה', app_login: 'לא מחובר ל-NG Admin בכרום הזה' };

function render(s) {
  const el = document.getElementById('status');
  if (!s) { el.textContent = 'עוד לא היה סנכרון מהכרום הזה.'; return; }
  if (s.ok) {
    el.innerHTML = s.skipped === 'fresh'
      ? `<span class="ok">✓ מישהו אחר כבר עדכן לאחרונה</span><br>נבדק לפני ${timeAgo(s.at)}`
      : `<span class="ok">✓ עודכן בהצלחה</span><br>${s.people || ''} אנשי צוות · לפני ${timeAgo(s.at)}`;
  } else {
    el.innerHTML = `<span class="bad">✗ ${ERR_HE[s.err] || s.err || 'שגיאה'}</span><br>לפני ${timeAgo(s.at)}`;
  }
}

chrome.storage.local.get('lastStatus', r => render(r.lastStatus));

document.getElementById('syncBtn').addEventListener('click', () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true; btn.textContent = 'מסנכרן…';
  chrome.runtime.sendMessage('sync-now', res => { render({ ...res, at: new Date().toISOString() }); btn.disabled = false; btn.textContent = 'סנכרן עכשיו'; });
});
