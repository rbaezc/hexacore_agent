/**
 * Runs inside the rendered page (page.evaluate) and reports what only a browser can see:
 * horizontal overflow, low text contrast and clipped text. Kept as source text because the
 * server is compiled without DOM types; it must stay plain ES2020 with no imports.
 */
export const RENDER_PROBE = String.raw`(() => {
  const out = [];
  const root = document.documentElement;
  const vw = root.clientWidth;
  const selector = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + e.id); break; }
      const cls = [...e.classList].slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const scrollsInside = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };

  if (root.scrollWidth > vw + 1) {
    const wide = [...document.body.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && !scrollsInside(el);
    });
    const outermost = wide.filter((el) => !wide.some((o) => o !== el && o.contains(el))).slice(0, 3);
    for (const el of outermost.length ? outermost : [document.body]) {
      out.push({ rule: 'ui/overflow', severity: 'error', selector: selector(el),
        message: 'Wider than the screen (' + Math.round(el.getBoundingClientRect().right) + 'px of ' + vw + 'px): the page scrolls sideways.' });
    }
  }

  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const darkCanvas = matchMedia('(prefers-color-scheme: dark)').matches && /dark/.test(getComputedStyle(root).colorScheme || '');
  const background = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = rgb(cs.backgroundColor);
      if (c && c.a >= 0.99) return c;
      if (c && c.a > 0) return null;
    }
    return darkCanvas ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  };
  const luminance = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const seen = new Set();
  let contrastIssues = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(), i = 0; n && i < 3000 && contrastIssues < 5; n = walker.nextNode(), i++) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const fg = rgb(cs.color);
    const bg = background(el);
    if (!fg || !bg || fg.a === 0) continue;
    const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const [hi, lo] = [luminance(mixed), luminance(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const needed = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio < needed) {
      contrastIssues++;
      out.push({ rule: 'ui/contrast', severity: 'error', selector: selector(el),
        message: 'Text contrast ' + ratio.toFixed(2) + ':1, needs ' + needed + ':1: "' + n.textContent.trim().slice(0, 40) + '"' });
    }
  }

  let clipped = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (clipped >= 3) break;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflowY !== 'hidden') continue;
    if (cs.textOverflow === 'ellipsis' || !el.textContent.trim() || el.children.length > 3) continue;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
      clipped++;
      out.push({ rule: 'ui/clipped-text', severity: 'warning', selector: selector(el), message: 'Text is cut off by overflow: hidden. Let it wrap, or show an ellipsis on purpose.' });
    }
  }
  return out;
})()`;

export const RENDER_RULES = ['ui/overflow', 'ui/contrast', 'ui/clipped-text', 'ui/console-error', 'ui/failed-request'] as const;
