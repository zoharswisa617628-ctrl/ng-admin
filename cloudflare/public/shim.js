/* New Gamers Admin — connector for the Cloudflare version.
   The site was written for claude.ai, where saving goes through window.claude.use('db' | 'user').
   This file provides the same calls on top of our own server (/api/...), so the site's code stays as it is.
   It also shows the "log in with Discord" screen when you're not signed in. */
(() => {
  'use strict';
  const POLL_MS = 8000;
  const W = { 'content-type': 'application/json', 'x-ng': '1' };

  // ---- who am I (or: show the login screen) ----
  const meP = fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));
  meP.then(me => { if (me.owner) ownerButton(); }, status => gate(status));

  function gate(status) {
    const show = () => {
      const g = document.createElement('div');
      g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true');
      g.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0b0f17;color:#e8eef9;font:16px/1.6 system-ui,"Segoe UI",sans-serif;direction:rtl';
      const denied = status === 403;
      g.innerHTML = `<div style="max-width:26rem;margin:16px;padding:2rem;border-radius:20px;background:#121826;border:1px solid #1f2a3d;text-align:center">
        <div style="font-size:2.2rem;margin-bottom:.4rem">${denied ? '⛔' : '🔒'}</div>
        <h1 style="font-size:1.3rem;margin:0 0 .5rem">${denied ? 'אין לך גישה' : 'New Gamers Admin'}</h1>
        <p style="color:#9fb0c8;margin:0 0 1.4rem">${denied ? 'הגישה שלך לאתר נחסמה. אם זו טעות, פנה להנהלה.' : 'האתר פתוח להנהלת השרת. התחבר עם חשבון הדיסקורד שלך כדי להיכנס.'}</p>
        <a href="${denied ? '/auth/logout' : '/auth/login'}" style="display:inline-flex;gap:.5rem;align-items:center;padding:.75rem 1.5rem;border-radius:12px;background:#5865f2;color:#fff;text-decoration:none;font-weight:700">${denied ? 'התחברות עם חשבון אחר' : 'התחברות עם דיסקורד'}</a></div>`;
      document.body.appendChild(g);
      document.documentElement.style.overflow = 'hidden';
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
  // Small floating buttons, stacked in the bottom-left corner
  const PILL = 'padding:.45rem .8rem;border-radius:999px;background:rgba(18,24,38,.88);border:1px solid #2a3650;color:#cfe0f5;font:600 13px system-ui,sans-serif;text-decoration:none;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);white-space:nowrap';
  let dockEl = null;
  function dock() {
    if (!dockEl) {
      dockEl = document.createElement('div'); dockEl.id = 'ngDock';
      dockEl.style.cssText = 'position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom, 0px));z-index:2147483000;display:flex;flex-direction:column-reverse;align-items:flex-start;gap:8px';
      document.body.appendChild(dockEl);
    }
    return dockEl;
  }
  const whenBody = fn => { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); };
  function ownerButton() {
    whenBody(() => {
      const a = document.createElement('a');
      a.href = '/access.html'; a.textContent = '🔑 הרשאות'; a.title = 'מי נכנס לאתר: חריגים, חסימות ומי התחבר';
      a.style.cssText = PILL; a.style.order = '-1';
      dock().appendChild(a);
    });
  }

  // ---- phone / computer notifications ----
  const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let bellBtn = null;
  const b64ToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  async function swReg() { return navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
  async function enablePush() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!pushOK) { alert(ios ? 'באייפון התראות עובדות רק מהאפליקציה המותקנת: קודם "📲 התקנה כאפליקציה", ואז פותחים מהאייקון ולוחצים כאן שוב.' : 'הדפדפן הזה לא תומך בהתראות. נסה ב-Chrome או ב-Edge.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('ההתראות חסומות. אפשר להפעיל אותן בהגדרות של הדפדפן או הטלפון, תחת התראות של האתר.'); return; }
    const reg = await swReg(); await navigator.serviceWorker.ready;
    const { key } = await (await fetch('/api/push', { cache: 'no-store' })).json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const r = await fetch('/api/push', { method: 'POST', headers: W, body: JSON.stringify({ sub: sub.toJSON(), ua: navigator.userAgent.slice(0, 60) }) });
    if (!r.ok) { alert('לא הצלחתי להפעיל התראות. נסה שוב.'); return; }
    await fetch('/api/push?test=1', { method: 'POST', headers: W, body: '{}' });
    if (bellBtn) bellBtn.remove(); bellBtn = null;
  }
  async function bellButton() {
    if (!pushOK && !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
    if (pushOK) {
      try { const reg = await swReg(); const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === 'granted') {   // already on: keep the server's copy fresh
          fetch('/api/push', { method: 'POST', headers: W, body: JSON.stringify({ sub: sub.toJSON(), ua: navigator.userAgent.slice(0, 60) }) }).catch(() => {});
          return; } } catch {}
    }
    whenBody(() => {
      bellBtn = document.createElement('button'); bellBtn.type = 'button'; bellBtn.textContent = '🔔 הפעלת התראות';
      bellBtn.style.cssText = PILL; bellBtn.title = 'התראות על מכרזים, איפוסים ואזהרות, גם כשהאתר סגור';
      bellBtn.addEventListener('click', () => { enablePush().catch(() => alert('לא הצלחתי להפעיל התראות. נסה שוב.')); });
      dock().appendChild(bellBtn);
    });
  }
  meP.then(() => bellButton(), () => {});

  // Tapping a notification opens the right page: /#open=<channel>
  function openFromLink(href) {
    const m = String(href || '').match(/#open=([^&]+)/); if (!m) return;
    const ch = decodeURIComponent(m[1]);
    const go = () => { if (typeof window.openChannel === 'function') { window.openChannel(ch); window.history.replaceState(null, '', '/'); } else setTimeout(go, 200); };
    go();
  }
  whenBody(() => setTimeout(() => openFromLink(location.href), 400));
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.ngOpen) openFromLink(e.data.ngOpen); });

  // ---- "install as an app" button (Chrome / Edge offer it; on iPhone: Share → Add to Home Screen) ----
  // Shown to everyone (not only where the browser offers it): where it can't install by itself, it explains how.
  let installEvt = null, installBtn = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const hiddenUntil = () => { try { return +localStorage.getItem('ng_install_hide') || 0; } catch { return 0; } };
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  addEventListener('appinstalled', () => { installEvt = null; if (installBtn) installBtn.remove(); });

  // Which browser, on which device — and how to install from exactly there
  function detectBrowser() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua), mac = !ios && /Macintosh/.test(ua), win = /Windows/.test(ua);
    const os = ios ? (ipad ? 'אייפד' : 'אייפון') : android ? 'אנדרואיד' : mac ? 'מק' : win ? 'Windows' : 'מחשב';
    const inApp = [['Discord', /Discord/i], ['וואטסאפ', /WhatsApp/i], ['אינסטגרם', /Instagram/i], ['פייסבוק', /FBAN|FBAV|FB_IAB/], ['טלגרם', /Telegram/i],
      ['טיקטוק', /TikTok|musical_ly|BytedanceWebview/i], ['סנאפצ׳ט', /Snapchat/i], ['Line', /\bLine\//]].find(([, rx]) => rx.test(ua));
    let b;
    if (inApp) b = 'inapp';
    else if (ios) b = /CriOS/.test(ua) ? 'chrome' : /EdgiOS/.test(ua) ? 'edge' : /FxiOS/.test(ua) ? 'firefox' : /OPiOS|OPT\//.test(ua) ? 'opera' : /DuckDuckGo/.test(ua) ? 'ddg' : /GSA\//.test(ua) ? 'google' : 'safari';
    else if (/SamsungBrowser/.test(ua)) b = 'samsung';
    else if (/Edg(e|A)?\//.test(ua)) b = 'edge';
    else if (/OPR\/|Opera/.test(ua)) b = 'opera';
    else if (/YaBrowser/.test(ua)) b = 'yandex';
    else if (/Vivaldi/.test(ua)) b = 'vivaldi';
    else if (/Firefox\//.test(ua)) b = 'firefox';
    else if (navigator.brave) b = 'brave';
    else if (/; wv\)/.test(ua)) b = 'webview';
    else if (/Chrome\//.test(ua)) b = 'chrome';
    else if (/Safari\//.test(ua)) b = 'safari';
    else b = 'other';
    const NAME = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', opera: 'Opera', safari: 'Safari', samsung: 'Samsung Internet', brave: 'Brave',
      yandex: 'Yandex', vivaldi: 'Vivaldi', ddg: 'DuckDuckGo', google: 'אפליקציית Google', webview: 'דפדפן בתוך אפליקציה', other: 'הדפדפן שלך' };
    const name = inApp ? `הדפדפן של ${inApp[0]}` : NAME[b];
    const share = ipad ? 'כפתור השיתוף ⬆️ למעלה ליד הכתובת' : 'כפתור השיתוף ⬆️ בתחתית המסך';
    const OPEN_ELSEWHERE = target => [`הקישור נפתח בתוך ${inApp ? inApp[0] : 'אפליקציה אחרת'}, ומשם אי אפשר להתקין.`,
      ios ? 'לוחצים על ⋯ או על סמל המצפן 🧭 ובוחרים "פתח ב-Safari".' : 'לוחצים על ⋮ למעלה ובוחרים "פתח בדפדפן" / "Open in Chrome".',
      `ב-${target} לוחצים שוב על "📲 התקנה כאפליקציה" באתר, ותקבל הוראות משם.`];
    let steps;
    if (b === 'inapp' || b === 'webview' || b === 'google') steps = OPEN_ELSEWHERE(ios ? 'Safari' : 'Chrome');
    else if (ios) {
      steps = b === 'safari' ? [`לוחצים על ${share}.`, 'גוללים למטה ובוחרים "הוסף למסך הבית" (אם לא רואים, לוחצים "עוד" / "Edit Actions").', 'לוחצים "הוסף" למעלה. האייקון יופיע במסך הבית.',
          'לא מוצא את "הוסף למסך הבית"? כנראה זה חלון של אפליקציה אחרת: לוחצים על סמל המצפן 🧭 כדי לפתוח ב-Safari.']
        : b === 'chrome' ? ['לוחצים על כפתור השיתוף ⬆️ בשורת הכתובת למעלה.', 'בוחרים "הוסף למסך הבית" (אולי צריך לגלול או ללחוץ "עוד").', 'לוחצים "הוסף".', 'אם אין את האפשרות, עדכן את האייפון או פתח את האתר ב-Safari.']
        : b === 'edge' ? ['לוחצים על ⋯ בתחתית המסך.', 'בוחרים "שיתוף" ואז "הוסף למסך הבית".', 'לוחצים "הוסף".']
        : b === 'firefox' ? ['לוחצים על ☰ בתחתית המסך.', 'בוחרים "שיתוף" ואז "הוסף למסך הבית".', 'לוחצים "הוסף".']
        : ['מהדפדפן הזה אי אפשר להתקין באייפון.', 'מעתיקים את הכתובת YOUR-PROJECT.pages.dev ופותחים אותה ב-Safari.', `שם: ${share} ← "הוסף למסך הבית".`];
    } else if (android) {
      steps = b === 'samsung' ? ['לוחצים על ☰ בתחתית המסך.', 'בוחרים "הוסף דף ל…" ואז "מסך הבית" (או "התקנה" אם מופיע סמל ⬇️ בשורת הכתובת).', 'מאשרים "הוסף".']
        : b === 'edge' ? ['לוחצים על ⋯ בתחתית המסך.', 'בוחרים "הוספה לטלפון" / "התקנת אפליקציה".', 'מאשרים "התקנה".']
        : b === 'firefox' ? ['לוחצים על ⋮ (למעלה או למטה, לפי ההגדרה שלך).', 'בוחרים "התקנה" / "הוספה למסך הבית".', 'מאשרים "הוסף".']
        : b === 'opera' ? ['לוחצים על ⋮ למעלה.', 'בוחרים "הוסף ל…" ואז "מסך הבית".', 'מאשרים "הוסף".']
        : b === 'yandex' || b === 'vivaldi' || b === 'ddg' ? ['לוחצים על התפריט ⋮.', 'בוחרים "הוספה למסך הבית" / "התקנת אפליקציה".', 'אם אין את האפשרות, פתח את האתר ב-Chrome.']
        : ['לוחצים על ⋮ למעלה בצד ימין.', 'בוחרים "התקנת אפליקציה" (בגרסאות ישנות: "הוספה למסך הבית").', 'מאשרים "התקנה". האייקון יופיע במסך הבית.'];
    } else {
      steps = b === 'edge' ? ['בשורת הכתובת, בצד ימין, לוחצים על סמל "יש אפליקציה זמינה" (ריבועים עם +).', 'או: תפריט ⋯ ← "אפליקציות" ← "התקן את האתר הזה כאפליקציה".', 'מאשרים "התקן". אם אין את האפשרות, האפליקציה כנראה כבר מותקנת.']
        : b === 'firefox' ? ['Firefox לא מתקין אתרים כאפליקציה במחשב.', 'פותחים את YOUR-PROJECT.pages.dev ב-Chrome או ב-Edge, ושם לוחצים "📲 התקנה כאפליקציה".']
        : b === 'opera' ? ['Opera לא מתקין אתרים כאפליקציה במחשב.', 'פותחים את YOUR-PROJECT.pages.dev ב-Chrome או ב-Edge, ושם לוחצים "📲 התקנה כאפליקציה".']
        : b === 'safari' ? (mac ? ['בתפריט למעלה: "קובץ" ← "הוסף ל-Dock" (Safari 17 ומעלה).', 'משנים את השם אם רוצים ולוחצים "הוסף". האפליקציה תופיע ב-Dock.'] : ['פותחים את האתר ב-Chrome או ב-Edge כדי להתקין.'])
        : b === 'vivaldi' ? ['לוחצים קליק ימני על הלשונית של האתר.', 'בוחרים "התקן את New Gamers Admin…".', 'מאשרים "התקן".']
        : ['בשורת הכתובת, בצד ימין, לוחצים על סמל ההתקנה (מסך עם חץ ⬇️).', 'או: תפריט ⋮ ← "העברה, שמירה ושיתוף" ← "התקנת הדף כאפליקציה".', 'מאשרים "התקנה". אם אין את האפשרות, האפליקציה כנראה כבר מותקנת.'];
    }
    return { label: `${name} · ${os}`, steps };
  }
  function installHelp() {
    const { label, steps } = detectBrowser();
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:grid;place-items:end center;padding:16px;direction:rtl';
    back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="התקנה כאפליקציה" style="width:min(26rem,100%);margin-bottom:max(16px,env(safe-area-inset-bottom));background:#121826;border:1px solid #2a3650;border-radius:20px;padding:1.2rem 1.2rem 1rem;color:#e8eef9;font:15px/1.6 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.6rem"><img src="/icon-192.png?v=2" alt="" width="44" height="44" style="border-radius:12px"><span><b style="display:block;font-size:1.05rem">התקנה כאפליקציה</b><span style="font-size:.8rem;color:#9fb0c8">זיהינו: ${label}</span></span></div>
      <ol style="margin:0 0 1rem;padding-inline-start:1.2rem;color:#c5d3e8">${steps.map(s => `<li style="margin:.25rem 0">${s}</li>`).join('')}</ol>
      <div style="display:flex;gap:.5rem;justify-content:flex-start"><button type="button" data-x="ok" style="padding:.55rem 1.1rem;border-radius:10px;border:0;background:#2ad0f5;color:#04121f;font:700 14px system-ui,sans-serif;cursor:pointer">הבנתי</button>
      <button type="button" data-x="hide" style="padding:.55rem 1rem;border-radius:10px;border:1px solid #2a3650;background:none;color:#9fb0c8;font:600 14px system-ui,sans-serif;cursor:pointer">לא להציג את הכפתור</button></div></div>`;
    back.addEventListener('click', ev => {
      const x = ev.target.closest('[data-x]');
      if (x && x.dataset.x === 'hide') { try { localStorage.setItem('ng_install_hide', String(Date.now() + 30 * 864e5)); } catch {} if (installBtn) installBtn.remove(); }
      if (x || ev.target === back) back.remove();
    });
    document.body.appendChild(back);
  }
  function addInstallButton() {
    if (installBtn || standalone() || hiddenUntil() > Date.now()) return;
    installBtn = document.createElement('button');
    installBtn.type = 'button'; installBtn.textContent = '📲 התקנה כאפליקציה';
    installBtn.style.cssText = PILL;
    installBtn.addEventListener('click', async () => {
      if (installEvt) { installEvt.prompt(); try { const c = await installEvt.userChoice; if (c && c.outcome === 'accepted') installBtn.remove(); } catch {} installEvt = null; return; }
      installHelp();
    });
    dock().appendChild(installBtn);
  }
  meP.then(() => { if (document.body) addInstallButton(); else document.addEventListener('DOMContentLoaded', addInstallButton); }, () => {});

  // ---- live updates: one poll for everything ----
  let since = 0, started = false, initial = null, timer = 0;
  const teamL = [], docL = new Map(), known = new Map();     // known: path -> JSON we last delivered
  const docOf = (path, v) => ({ id: path.split('/').pop(), exists: v !== undefined, metadata: { hasPendingWrites: false }, data: () => v });

  async function pull() {
    const r = await fetch('/api/sync?since=' + since, { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) { lockOut(r.status); throw r.status; }
    if (!r.ok) throw r.status;
    const j = await r.json(); since = Math.max(0, j.now - 2000);   // a little overlap, duplicates are filtered below
    return j.docs;
  }
  function deliver(docs) {
    const changes = [];
    docs.forEach(d => {
      const s = JSON.stringify(d.v); if (known.get(d.path) === s) return; known.set(d.path, s);
      if (d.path.startsWith('team/')) changes.push({ type: 'modified', doc: docOf(d.path, d.v) });
      else { const cb = docL.get(d.path); if (cb) try { cb(docOf(d.path, d.v)); } catch (e) { console.error(e); } }
    });
    if (changes.length) {
      const snap = { metadata: { fromCache: false }, docs: changes.map(c => c.doc), docChanges: () => changes };
      teamL.forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
    }
  }
  function start() {
    if (started) return initial; started = true;
    initial = pull().then(docs => { docs.forEach(d => known.set(d.path, JSON.stringify(d.v))); return docs; });
    const tick = async () => { if (document.visibilityState === 'visible') { try { deliver(await pull()); } catch {} } timer = setTimeout(tick, POLL_MS); };
    initial.then(() => { timer = setTimeout(tick, POLL_MS); }, () => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); } });
    return initial;
  }

  // Logged out while the page was open (role removed, blocked, disconnected): cover the page with the login screen
  let locked = false;
  function lockOut(status) { if (locked) return; locked = true; clearTimeout(timer); gate(status); }
  const fail = r => {
    if (r.status === 401) lockOut(401);
    return { code: r.status === 403 ? 'permission_denied' : r.status === 413 ? 'quota_exceeded' : 'unavailable' };
  };
  const db = {
    doc(path) {
      const url = '/api/doc?path=' + encodeURIComponent(path);
      return {
        async get() {
          const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) throw fail(r);
          const j = await r.json(); if (j.exists) known.set(path, JSON.stringify(j.v));
          return docOf(path, j.exists ? j.v : undefined);
        },
        async set(body) {
          const text = JSON.stringify(body);
          const r = await fetch(url, { method: 'PUT', headers: W, body: text, credentials: 'same-origin' }); if (!r.ok) throw fail(r);
          known.set(path, text);                    // our own write: don't echo it back
        },
        onSnapshot(cb) { docL.set(path, cb); start(); return () => docL.delete(path); },
      };
    },
    collection(name) {
      return {
        onSnapshot(cb, onErr) {
          if (name !== 'team') return () => {};
          teamL.push(cb);
          start().then(docs => {
            const team = docs.filter(d => d.path.startsWith('team/')).map(d => docOf(d.path, d.v));
            cb({ metadata: { fromCache: false }, docs: team, docChanges: () => team.map(doc => ({ type: 'added', doc })) });
          }, e => onErr && onErr(e));
          return () => { const i = teamL.indexOf(cb); if (i >= 0) teamL.splice(i, 1); };
        },
      };
    },
  };
  const user = {
    id: async () => (await meP).id,
    me: async () => { const m = await meP; return { id: m.id, name: m.name, avatar: m.avatar || '', rank: m.rank || '', owner: !!m.owner }; },
    profiles: async list => {
      const r = await fetch('/api/profiles', { method: 'POST', headers: W, body: JSON.stringify({ ids: list }), credentials: 'same-origin' });
      return r.ok ? r.json() : {};
    },
    isOwner: () => false, canEdit: () => true, can: () => true,
  };
  // ---- what the settings panel needs from this device: notifications and installing ----
  async function pushState() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!pushOK) return ios && !standalone() ? 'needsInstall' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    try { const reg = await swReg(); const sub = await reg.pushManager.getSubscription(); return sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch { return 'off'; }
  }
  async function pushEndpoint() { try { const reg = await swReg(); const sub = await reg.pushManager.getSubscription(); return sub ? sub.endpoint : ''; } catch { return ''; } }
  async function disablePush() {
    const reg = await swReg(), sub = await reg.pushManager.getSubscription();
    if (sub) { const ep = sub.endpoint; try { await sub.unsubscribe(); } catch {} await fetch('/api/push', { method: 'DELETE', headers: W, body: JSON.stringify({ endpoint: ep }) }); }
    bellButton();
  }
  window.ngDevice = {
    push: {
      state: pushState, endpoint: pushEndpoint, disable: disablePush,
      enable: async () => { await enablePush(); return pushState(); },
      test: async () => { const r = await fetch('/api/push?test=1', { method: 'POST', headers: W, body: '{}' }); return r.ok ? r.json() : { sent: 0, devices: 0 }; },
    },
    install: {
      standalone: () => standalone(),
      run: async () => { if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; return; } installHelp(); },
    },
  };
  window.claude = { use: async name => { try { await meP; } catch { return null; } return name === 'db' ? db : name === 'user' ? user : null; } };
})();
