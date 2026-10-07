import type { Outlier } from '@/analysis/outliers.js';
import { groupLabel } from '@/analysis/outliers.js';
import { REF_ATTR } from '@extractors/design-samples.js';

// Turns consistency findings into CSS overrides for a page snapshot, so the
// "fixed" page can be compared with the original. Pure string work: no browser.

export interface PageFix {
  anchor: string; // stable id shared with audit.html "Preview fix" links
  confidence: Outlier['confidence'];
  label: string; // "Primary buttons — border-radius: 6px → 8px"
  selector: string; // readable selector, for display
  target: string; // CSS selector actually used (data-da-i ref when available)
  declarations: Array<[string, string]>;
}

const PX = '\\d+(?:\\.\\d+)?px';
const VALIDATORS: Record<string, RegExp> = {
  'font-size': new RegExp(`^${PX}$`),
  'font-weight': /^(?:[1-9]00|normal|bold)$/,
  'font-family': /^[\w -]{1,60}$/,
  height: new RegExp(`^${PX}$`),
  'border-radius': new RegExp(`^(?:full|${PX}(?: ${PX}){0,3})$`),
  'border-width': new RegExp(`^${PX}(?: ${PX}){0,3}$`),
  padding: new RegExp(`^${PX}(?: ${PX}){0,3}$`),
  'box-shadow': /^(?:none|[\w\s(),.#%-]{1,300})$/,
  color: /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i,
};
const SIDE_PROPS = new Set([
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
]);
const COLOR_PROPS = new Set(['color', 'background-color', 'border-color']);

export function fixAnchor(outlierId: string): string {
  return (
    'da-' +
    outlierId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

function validValue(prop: string, value: string): string | null {
  const key = SIDE_PROPS.has(prop)
    ? 'font-size' // a single px length
    : COLOR_PROPS.has(prop)
      ? 'color'
      : prop;
  const re = VALIDATORS[key];
  if (!re || !re.test(value)) return null;
  if (prop === 'border-radius' && value === 'full') return '9999px';
  if (prop === 'font-family') return `"${value}"`;
  return value;
}

// readable selectors from the audited page are only used as a fallback and
// must not be able to break out of the rule
function safeSelector(selector: string): string | null {
  return selector && !/[{}<;]/.test(selector) ? selector : null;
}

function declarationsFor(
  o: Outlier,
  exampleProperty: string | undefined
): Array<[string, string]> {
  const target = o.dominant!.value;
  if (o.group) {
    if (o.property === 'font-size / font-weight') {
      const [size, weight] = target.split(' / ');
      return [
        ['font-size', size],
        ['font-weight', weight],
      ];
    }
    return [[o.property, target]];
  }
  if (o.category === 'colors') {
    return exampleProperty && COLOR_PROPS.has(exampleProperty)
      ? [[exampleProperty, target]]
      : [];
  }
  if (['margin', 'padding', 'gap'].includes(o.property)) {
    return exampleProperty && SIDE_PROPS.has(exampleProperty)
      ? [[exampleProperty, target]]
      : [];
  }
  return [[o.property, target]];
}

export function fixesForPage(pageUrl: string, outliers: Outlier[]): PageFix[] {
  const fixes: PageFix[] = [];
  for (const o of outliers) {
    if (o.confidence === 'info' || !o.dominant) continue;
    for (const ex of o.examples) {
      if (ex.url !== pageUrl) continue;
      const declarations = declarationsFor(o, ex.property)
        .map(([prop, value]) => [prop, validValue(prop, value)] as const)
        .filter((d): d is [string, string] => d[1] !== null);
      if (declarations.length === 0) continue;

      const target =
        ex.ref && /^\d+$/.test(ex.ref)
          ? `[${REF_ATTR}="${ex.ref}"]`
          : safeSelector(ex.selector);
      if (!target) continue;

      const what = o.group
        ? `${groupLabel(o.group)} — ${o.property}`
        : (ex.property ?? o.property);
      fixes.push({
        anchor: fixAnchor(o.id),
        confidence: o.confidence,
        label: `${what}: ${o.value} → ${o.dominant.value}`,
        selector: ex.selector,
        target,
        declarations,
      });
    }
  }
  return fixes;
}

export function fixesCss(fixes: PageFix[]): string {
  return fixes
    .map(
      (f) =>
        `${f.target}{${f.declarations.map(([p, v]) => `${p}:${v} !important`).join(';')}}`
    )
    .join('\n');
}

// Inject the overrides and a small toolbar (in a shadow root, so the page's
// own CSS can't restyle it) into a snapshot produced by captureSnapshot().
export function applyFixes(snapshotHtml: string, fixes: PageFix[]): string {
  const highlight = fixes.length
    ? `${[...new Set(fixes.map((f) => f.target))].map((t) => `html.da-highlight ${t}`).join(',\n')}{outline:2px solid #f43f5e !important;outline-offset:2px !important}`
    : '';
  const head = `<style id="da-fixes">\n${fixesCss(fixes)}\n</style>\n<style id="da-highlight">\n${highlight}\n.da-flash{outline:3px solid #f43f5e !important;outline-offset:3px !important;transition:outline-color 1.2s}\n</style>`;

  // JSON in a non-executable script tag; "<" escaped so it can't close the tag
  const data = JSON.stringify(
    fixes.map((f) => ({
      anchor: f.anchor,
      confidence: f.confidence,
      label: f.label,
      selector: f.selector,
      target: f.target,
    }))
  ).replace(/</g, '\\u003c');
  const body = `<script type="application/json" id="da-fix-data">${data}</script>\n<script>${TOOLBAR_JS}</script>`;

  let html = snapshotHtml;
  html = html.includes('</head>')
    ? html.replace('</head>', `${head}\n</head>`)
    : head + html;
  html = html.includes('</body>')
    ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${body}\n</body>`)
    : html + body;
  return html;
}

const TOOLBAR_JS = `
(function(){
  var fixes=JSON.parse(document.getElementById('da-fix-data').textContent||'[]');
  var sheet=document.getElementById('da-fixes');
  var host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
  document.body.appendChild(host);
  var root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>'+
    ':host{all:initial}.p{font:13px/1.4 system-ui,sans-serif;color:#111;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);width:320px;max-height:60vh;display:flex;flex-direction:column}'+
    '.h{display:flex;gap:6px;align-items:center;padding:10px;border-bottom:1px solid #eee;flex-wrap:wrap}'+
    '.t{font-weight:650;margin-right:auto}button{font:inherit;border:1px solid #ccc;background:#f6f6f6;border-radius:6px;padding:3px 8px;cursor:pointer}'+
    'button[aria-pressed=true]{background:#111;color:#fff;border-color:#111}'+
    'ul{list-style:none;margin:0;padding:4px 0;overflow:auto}li{padding:6px 10px;cursor:pointer;border-bottom:1px solid #f2f2f2}li:hover{background:#f7f7f7}'+
    '.b{font-size:10px;font-weight:700;text-transform:uppercase;color:#fff;border-radius:999px;padding:1px 6px;margin-right:6px}.high{background:#dc2626}.medium{background:#b45309}'+
    '.s{display:block;color:#666;font:11px ui-monospace,monospace;word-break:break-all;margin-top:2px}.e{padding:10px;color:#666}.min .l{display:none}'+
    '</style><div class="p"><div class="h"><span class="t"></span>'+
    '<button id="on" aria-pressed="true">Fixes on</button><button id="hl" aria-pressed="false">Highlight</button><button id="mn" title="Collapse">–</button></div>'+
    '<div class="l"></div></div>';
  root.querySelector('.t').textContent=fixes.length+' fix'+(fixes.length===1?'':'es')+' applied';
  var list=root.querySelector('.l');
  if(!fixes.length){var e=document.createElement('div');e.className='e';e.textContent='No high or medium findings with a clear target value on this page.';list.appendChild(e);}
  else{
    var ul=document.createElement('ul');
    fixes.forEach(function(f){
      var li=document.createElement('li');
      var b=document.createElement('span');b.className='b '+f.confidence;b.textContent=f.confidence;
      var l=document.createElement('span');l.textContent=f.label;
      var s=document.createElement('span');s.className='s';s.textContent=f.selector;
      li.append(b,l,s);li.onclick=function(){go(f);};ul.appendChild(li);
    });
    list.appendChild(ul);
  }
  function go(f){
    var el=null;try{el=document.querySelector(f.target);}catch(_){}
    if(!el)return;
    el.scrollIntoView({block:'center',behavior:'smooth'});
    el.classList.add('da-flash');setTimeout(function(){el.classList.remove('da-flash');},1600);
  }
  var on=root.getElementById('on'),hl=root.getElementById('hl'),mn=root.getElementById('mn');
  on.onclick=function(){var v=on.getAttribute('aria-pressed')!=='true';on.setAttribute('aria-pressed',v);on.textContent=v?'Fixes on':'Fixes off';sheet.disabled=!v;};
  hl.onclick=function(){var v=hl.getAttribute('aria-pressed')!=='true';hl.setAttribute('aria-pressed',v);document.documentElement.classList.toggle('da-highlight',v);};
  mn.onclick=function(){root.querySelector('.p').classList.toggle('min');};
  var hash=location.hash.slice(1);
  if(hash){var f=fixes.filter(function(x){return x.anchor===hash;})[0];if(f)setTimeout(function(){go(f);},300);}
})();
`;
