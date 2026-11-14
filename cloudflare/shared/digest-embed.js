// The weekly-summary lists as Discord embeds (used by the /סיכום-שבועי command)
export const KINDS = [
  { value: 'pass', name: 'עברו מינימום', rx: /^עברו/ },
  { value: 'fail', name: 'לא עברו מינימום', rx: /לא עבר/ },
  { value: 'warn', name: 'אזהרת צוות', rx: /אזהר/ },
  { value: 'promo', name: 'זכאים לקידום', rx: /קידום/ },
];
function splitBy(text, lim) {
  const out = []; let cur = '';
  for (const line of String(text).split('\n')) {
    const l = line.length > lim ? line.slice(0, lim) : line;
    if (cur && cur.length + l.length + 1 > lim) { out.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
// snap = { at, items: [{ title, text }] } ; logo = public image URL
export function kindEmbeds(snap, kind, logo, sender) {
  const k = KINDS.find(x => x.value === kind); if (!k || !snap || !Array.isArray(snap.items)) return null;
  const item = snap.items.find(it => k.rx.test(String(it.title || ''))); if (!item) return null;
  const lines = String(item.text || '').split('\n');
  if (/^#\s+/.test(lines[0] || '')) lines.shift();
  const chunks = splitBy(lines.join('\n').trim() || 'אין אף אחד ברשימה', 3900).slice(0, 10);
  return chunks.map((d, i) => ({
    title: 'סיכום שבועי • ' + k.name + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''),
    description: d, color: 0x2ad0f5, thumbnail: { url: logo },
    footer: sender && sender.name ? { text: `נשלח על ידי ${sender.name} • עודכן לאחרונה`, ...(sender.icon ? { icon_url: sender.icon } : {}) } : { text: 'עודכן לאחרונה' }, timestamp: new Date(snap.at || Date.now()).toISOString(),
  }));
}
