// Output: the interactive HTML page, a Markdown summary (for PR comments) and plain JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function toHtml(model) {
  const tpl = fs.readFileSync(path.join(here, 'report', 'template.html'), 'utf8');
  const client = fs.readFileSync(path.join(here, 'report', 'client.js'), 'utf8');
  const data = JSON.stringify(model).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => (ch === '\u2028' ? '\\u2028' : '\\u2029'));
  const title = `archdiff · ${model.project}`.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  const font = (file) => fs.readFileSync(path.join(here, 'report', 'fonts', file)).toString('base64');
  const fonts = `@font-face{font-family:"Geist";src:url(data:font/woff2;base64,${font('Geist-Variable.woff2')}) format("woff2");font-weight:100 900;font-display:swap}`
    + `@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${font('GeistMono-Variable.woff2')}) format("woff2");font-weight:100 900;font-display:swap}`;
  return tpl.split('__FONTS__').join(fonts).split('__TITLE__').join(title).split('__DATA__').join(data).split('__CLIENT__').join(client);
}

const mid = (s) => `m_${s.replace(/[^A-Za-z0-9_]/g, '_')}`;
const q = (s) => s.replace(/"/g, '#quot;');

/** A Markdown summary with a Mermaid graph of only the parts that changed (good for PR comments). */
export function toMarkdown(model) {
  const { summary: S, violations, edges, nodes } = model;
  const lines = [];
  lines.push(`### archdiff: ${model.curLabel} vs ${model.baseLabel || '(no base)'}`);
  lines.push('');
  const V = S.violations;
  const status = V.newErrors ? `❌ ${V.newErrors} new rule break${V.newErrors === 1 ? '' : 's'}` : '✅ no new rule breaks';
  lines.push(`${status} · modules +${S.modules.added}/−${S.modules.removed} · dependencies +${S.deps.added}/−${S.deps.removed}${V.fixed ? ` · ${V.fixed} fixed` : ''}`);
  lines.push('');

  const shown = violations.filter((v) => v.status !== 'existing');
  if (shown.length) {
    lines.push('| | Rule | Where |');
    lines.push('|---|---|---|');
    for (const v of shown) {
      const icon = v.status === 'fixed' ? '✅ fixed' : v.severity === 'error' ? '❌ new' : '⚠️ new';
      const where = v.kind === 'cycle' ? v.members.join(' ⇄ ') : `\`${v.from}\` → \`${v.to}\``;
      const ev = v.imports[0] ? ` (e.g. \`${v.imports[0].file}:${v.imports[0].line}\`)` : '';
      lines.push(`| ${icon} | ${v.rule} | ${where}${ev} |`);
    }
    lines.push('');
  }

  const sys = model.system;
  if (sys && model.hasBase) {
    const bullets = [];
    const mark = (st) => (st === 'added' ? '\u2795' : '\u2796');
    sys.apps.filter((a) => a.status !== 'same').forEach((a) => bullets.push(`${mark(a.status)} app **${a.name}** (${a.framework})`));
    for (const a of sys.apps) {
      for (const [g, label] of [['pages', 'page'], ['api', 'route'], ['endpoints', 'endpoint'], ['jobs', 'job']]) {
        (a.groups[g] || []).filter((x) => x.status !== 'same').forEach((x) => bullets.push(`${mark(x.status)} ${label} \`${x.methods && x.methods.length ? `${x.methods.join('/')} ` : ''}${x.label}\` in ${a.name}`));
      }
    }
    sys.stores.filter((x) => x.status !== 'same').forEach((x) => bullets.push(`${mark(x.status)} data store **${x.name}**`));
    sys.outside.filter((x) => x.status !== 'same').forEach((x) => bullets.push(`${mark(x.status)} outside service **${x.name}** (${x.kind})`));
    if (bullets.length) {
      lines.push('<details><summary>System changes (' + bullets.length + ')</summary>', '');
      lines.push(...bullets.slice(0, 40).map((b) => `- ${b}`));
      if (bullets.length > 40) lines.push(`- \u2026and ${bullets.length - 40} more`);
      lines.push('', '</details>', '');
    }
  }

  const violEdges = new Set(violations.filter((v) => v.status === 'new').flatMap((v) => v.edges));
  const changed = edges.filter((e) => e.status !== 'same' || e.countBase !== e.countCur || violEdges.has(e.id));
  if (changed.length) {
    const ids = new Set();
    changed.forEach((e) => { ids.add(e.from); ids.add(e.to); });
    lines.push('```mermaid');
    lines.push('graph TD');
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      const label = n.status === 'added' ? `${id} (new)` : n.status === 'removed' ? `${id} (removed)` : id;
      lines.push(`  ${mid(id)}["${q(label)}"]`);
    }
    const styles = [];
    changed.forEach((e, i) => {
      const lbl = e.status === 'added' ? `+${e.countCur}` : e.status === 'removed' ? `−${e.countBase}` : `${e.countBase}→${e.countCur}`;
      const arrow = e.status === 'removed' ? '-.->' : violEdges.has(e.id) ? '==>' : '-->';
      lines.push(`  ${mid(e.from)} ${arrow}|"${violEdges.has(e.id) ? '⚠ ' : ''}${lbl}"| ${mid(e.to)}`);
      const color = violEdges.has(e.id) ? '#c2410c' : e.status === 'added' ? '#1a7f37' : e.status === 'removed' ? '#cf222e' : '#8c959f';
      styles.push(`  linkStyle ${i} stroke:${color},stroke-width:${violEdges.has(e.id) ? 3 : 2}px`);
    });
    lines.push(...styles);
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      if (n.status === 'added') lines.push(`  style ${mid(id)} stroke:#1a7f37,stroke-width:2px`);
      if (n.status === 'removed') lines.push(`  style ${mid(id)} stroke:#cf222e,stroke-dasharray:4 3`);
    }
    lines.push('```');
  } else {
    lines.push('_No architectural changes._');
  }
  return lines.join('\n') + '\n';
}
