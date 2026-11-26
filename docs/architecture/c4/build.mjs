// Generates C4 diagrams (SVG inside one HTML page) and Structurizr DSL from model.mjs.
// Usage: node build.mjs   → out/index.html, out/workspace.dsl, out/<view>.svg
import ELK from "elkjs/lib/elk.bundled.js";
import fs from "node:fs";
import { meta, elements, relationships, deployment, views } from "./model.mjs";

const elk = new ELK();
const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
const rels = relationships.map(([from, to, desc, tech], i) => ({ i, from, to, desc, tech }));

// ── helpers ─────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function wrap(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
const ancestors = (id) => { const a = []; let e = byId[id]; while (e && e.parent) { a.push(e.parent); e = byId[e.parent]; } return a; };
function typeLabel(e) {
  const k = { person: "Person", system: "Software System", container: "Container", component: "Component" }[e.kind];
  const pre = e.ext && e.kind !== "component" && e.kind !== "container" ? (e.kind === "person" ? "External Person" : "External System") : k;
  return e.tech ? `[${pre}: ${e.tech}]` : `[${pre}]`;
}
const COLORS = {
  person: { fill: "#08427b", stroke: "#073b6f", text: "#ffffff" },
  personExt: { fill: "#686868", stroke: "#4d4d4d", text: "#ffffff" },
  system: { fill: "#1168bd", stroke: "#0b4884", text: "#ffffff" },
  systemExt: { fill: "#8a8a8a", stroke: "#6b6b6b", text: "#ffffff" },
  container: { fill: "#438dd5", stroke: "#3c7fc0", text: "#ffffff" },
  component: { fill: "#85bbf0", stroke: "#78a8d8", text: "#000000" },
};
const colorOf = (e) => e.kind === "person" ? (e.ext ? COLORS.personExt : COLORS.person)
  : e.kind === "system" ? (e.ext ? COLORS.systemExt : COLORS.system) : COLORS[e.kind];

// ── node geometry ───────────────────────────────────────
const NODE_W = 236;
function nodeBox(e) {
  const name = wrap(e.name, 24), type = wrap(typeLabel(e), 36), desc = wrap(e.desc, 36);
  const head = e.kind === "person" ? 38 : 0;
  const top = e.shape === "browser" ? 22 : e.shape === "db" ? 14 : e.shape === "folder" ? 12 : 0;
  const h = head + top + 16 + name.length * 18 + type.length * 14 + 8 + desc.length * 15 + 12;
  return { w: NODE_W, h, name, type, desc, head, top };
}
function labelBox(r) {
  const lines = wrap(r.desc, 26);
  const tech = r.tech ? wrap(`[${r.tech}]`, 30) : [];
  const chars = Math.max(...lines.map((l) => l.length), ...tech.map((l) => l.length * 0.92));
  return { lines, tech, w: Math.ceil(chars * 6.1 + 10), h: (lines.length + tech.length) * 13 + 6 };
}

// ── view → graph ────────────────────────────────────────
function viewGraph(view) {
  if (view.type === "Deployment") return deploymentGraph(view);
  const visible = new Set(view.include);
  const vis = (id) => (visible.has(id) ? id : ancestors(id).find((a) => visible.has(a)));
  const edges = new Map();
  for (const r of rels) {
    const a = vis(r.from), b = vis(r.to);
    if (!a || !b || a === b) continue;
    // a visible element must not connect to its own ancestor/boundary
    if (ancestors(a).includes(b) || ancestors(b).includes(a)) continue;
    const key = a + "→" + b;
    const explicit = a === r.from && b === r.to;
    const prev = edges.get(key);
    if (!prev || (explicit && !prev.explicit)) edges.set(key, { ...r, from: a, to: b, explicit });
  }
  const leaves = view.include.filter((id) => id !== view.boundary);
  const groups = view.boundary ? [{ id: view.boundary, el: byId[view.boundary], members: leaves.filter((id) => byId[id].parent === view.boundary) }] : [];
  return { leaves, groups, edges: [...edges.values()] };
}
function deploymentGraph() {
  const inst = {}; // element id -> instance id
  const walk = (n) => { (n.instances || []).forEach((eid) => (inst[eid] = `${n.id}__${eid}`)); (n.children || []).forEach(walk); };
  deployment.nodes.forEach(walk);
  const edges = [];
  const seen = new Set();
  for (const r of rels) {
    const a = inst[r.from], b = inst[r.to];
    if (!a || !b || (deployment.hideInstanceLinksFrom || []).includes(r.from)) continue;
    const k = a + b; if (seen.has(k)) continue; seen.add(k);
    edges.push({ ...r, from: a, to: b, explicit: true });
  }
  for (const [from, to, desc, tech] of deployment.links || []) edges.push({ from, to, desc, tech, explicit: true });
  return { deploy: true, inst, edges };
}

// ── layout with ELK ─────────────────────────────────────
const ROOT_OPTS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "46",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "22",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.thoroughness": "40",
  "elk.padding": "[top=20,left=20,bottom=20,right=20]",
};
const GROUP_WRAP = 40;
const groupOpts = (type) => ({ "elk.padding": `[top=26,left=24,bottom=${40 + wrap(type, GROUP_WRAP).length * 13},right=24]` });

async function layout(view) {
  const g = viewGraph(view);
  const meta2 = {}; // id -> {kind:'el'|'group'|'dnode', el, box}
  const mkLeaf = (id, eid) => { const el = byId[eid]; const box = nodeBox(el); meta2[id] = { kind: "el", el, box }; return { id, width: box.w, height: box.h }; };
  let children;
  if (g.deploy) {
    const mkNode = (n) => {
      meta2[n.id] = { kind: "dnode", node: n };
      return { id: n.id, layoutOptions: groupOpts(`[Deployment Node: ${n.tech}]`), children: [
        ...(n.children || []).map(mkNode),
        ...(n.instances || []).map((eid) => mkLeaf(`${n.id}__${eid}`, eid)),
      ] };
    };
    children = deployment.nodes.map(mkNode);
  } else {
    const inGroup = new Set(g.groups.flatMap((x) => x.members));
    children = [
      ...g.leaves.filter((id) => !inGroup.has(id)).map((id) => mkLeaf(id, id)),
      ...g.groups.map((grp) => { meta2[grp.id] = { kind: "group", el: grp.el }; return { id: grp.id, layoutOptions: groupOpts(`[Container: ${grp.el.tech || ""}]`), children: grp.members.map((id) => mkLeaf(id, id)) }; }),
    ];
  }
  const edges = g.edges.map((r, k) => {
    const lb = labelBox(r);
    return { id: "e" + k, sources: [r.from], targets: [r.to], rel: r, lb,
      labels: [{ id: "l" + k, text: r.desc, width: lb.w, height: lb.h, layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }] };
  });
  const graph = { id: "root", layoutOptions: ROOT_OPTS, children, edges };
  const out = await elk.layout(graph);
  return { out, meta: meta2, edgesIn: edges };
}

// ── SVG rendering ───────────────────────────────────────
function renderNode(n, m, ax, ay) {
  const { el, box } = m; const c = colorOf(el);
  const x = ax, y = ay, w = n.width, h = n.height;
  let s = `<g class="node" data-id="${el.id}"><title>${esc(el.name)} ${esc(typeLabel(el))}\n${esc(el.desc)}</title>`;
  let by = y + box.head;
  if (el.kind === "person") {
    s += `<rect x="${x}" y="${by}" width="${w}" height="${h - box.head}" rx="28" fill="${c.fill}" stroke="${c.stroke}"/>`;
    s += `<circle cx="${x + w / 2}" cy="${y + 26}" r="25" fill="${c.fill}" stroke="${c.stroke}"/>`;
  } else if (el.shape === "db") {
    const ry = 11;
    s += `<path d="M${x},${y + ry} L${x},${y + h - ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + h - ry} L${x + w},${y + ry} A${w / 2},${ry} 0 0 0 ${x},${y + ry} Z" fill="${c.fill}" stroke="${c.stroke}"/>`;
    s += `<path d="M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}" fill="none" stroke="${c.stroke}"/>`;
  } else if (el.shape === "browser") {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c.fill}" stroke="${c.stroke}"/>`;
    s += `<rect x="${x + 6}" y="${y + 22}" width="${w - 12}" height="${h - 28}" rx="3" fill="none" stroke="${c.text}" stroke-opacity=".35"/>`;
    [0, 1, 2].forEach((i) => (s += `<circle cx="${x + 13 + i * 11}" cy="${y + 11}" r="3.2" fill="${c.text}" fill-opacity=".6"/>`));
  } else if (el.shape === "folder") {
    s += `<path d="M${x},${y + 12} L${x},${y + h} L${x + w},${y + h} L${x + w},${y + 12} L${x + 92},${y + 12} L${x + 80},${y} L${x + 6},${y} Q${x},${y} ${x},${y + 6} Z" fill="${c.fill}" stroke="${c.stroke}"/>`;
  } else if (el.shape === "job") {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-dasharray="7 4" stroke-width="1.6"/>`;
  } else {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c.fill}" stroke="${c.stroke}"/>`;
  }
  let ty = by + box.top + 16 + 13;
  for (const l of box.name) { s += `<text x="${x + w / 2}" y="${ty}" class="n" fill="${c.text}">${esc(l)}</text>`; ty += 18; }
  ty -= 3;
  for (const l of box.type) { s += `<text x="${x + w / 2}" y="${ty}" class="t" fill="${c.text}">${esc(l)}</text>`; ty += 14; }
  ty += 9;
  for (const l of box.desc) { s += `<text x="${x + w / 2}" y="${ty}" class="d" fill="${c.text}">${esc(l)}</text>`; ty += 15; }
  return s + "</g>";
}
function renderGroup(n, m, x, y) {
  const w = n.width, h = n.height;
  let name, type;
  if (m.kind === "group") { name = m.el.name; type = `[${m.el.kind === "system" ? "Software System" : "Container: " + (m.el.tech || "")}]`; }
  else { name = m.node.name; type = `[Deployment Node: ${m.node.tech}]`; }
  const dashed = m.kind === "group" ? `stroke-dasharray="8 5"` : "";
  const fill = m.kind === "group" ? "none" : "#ffffff";
  const tl = wrap(type, GROUP_WRAP);
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${m.kind === "group" ? 4 : 8}" fill="${fill}" fill-opacity="${m.kind === "group" ? 0 : 0.55}" stroke="#555" stroke-width="1.3" ${dashed}/>`;
  s += `<text x="${x + 14}" y="${y + h - 34 - (tl.length - 1) * 13}" class="gn">${esc(name)}</text>`;
  tl.forEach((l, i) => (s += `<text x="${x + 14}" y="${y + h - 16 - (tl.length - 1 - i) * 13}" class="gt">${esc(l)}</text>`));
  return s;
}
function svgFor(lay, view) {
  const { out, meta: M } = lay;
  const abs = { root: [0, 0] };
  const groups = [], nodes = [];
  const walk = (n, ox, oy) => {
    for (const c of n.children || []) {
      const ax = ox + c.x, ay = oy + c.y; abs[c.id] = [ax, ay];
      const m = M[c.id];
      if (m.kind === "el") nodes.push(renderNode(c, m, ax, ay));
      else { groups.push(renderGroup(c, m, ax, ay)); walk(c, ax, ay); }
    }
  };
  walk(out, 0, 0);
  const paths = [], labels = [];
  const edgesById = Object.fromEntries(lay.edgesIn.map((e) => [e.id, e]));
  for (const e of out.edges) {
    const [ox, oy] = abs[e.container || "root"] || [0, 0];
    const src = edgesById[e.id];
    for (const sec of e.sections || []) {
      const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => [p.x + ox, p.y + oy]);
      paths.push(`<path d="${roundedPath(pts)}" class="rel" marker-end="url(#arr)"><title>${esc(src.rel.desc)}${src.rel.tech ? " [" + esc(src.rel.tech) + "]" : ""}</title></path>`);
    }
    for (const l of e.labels || []) {
      const lx = l.x + ox, ly = l.y + oy, lb = src.lb;
      let s = `<g class="lbl"><rect x="${lx - 2}" y="${ly}" width="${l.width + 4}" height="${l.height}" rx="3" class="lbg"/>`;
      let ty = ly + 13;
      for (const t of lb.lines) { s += `<text x="${lx + l.width / 2}" y="${ty}" class="ld">${esc(t)}</text>`; ty += 13; }
      for (const t of lb.tech) { s += `<text x="${lx + l.width / 2}" y="${ty}" class="lt">${esc(t)}</text>`; ty += 13; }
      labels.push(s + "</g>");
    }
  }
  const W = Math.ceil(out.width), H = Math.ceil(out.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="c4" role="img" aria-label="${esc(view.title)}">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#666"/></marker>
<style>.c4 text{font-family:Arial,Helvetica,sans-serif;text-anchor:middle}.c4 .n{font-size:15px;font-weight:700}.c4 .t{font-size:11.5px;opacity:.92}.c4 .d{font-size:12px}
.c4 .gn{font-size:14px;font-weight:700;text-anchor:start;fill:#222}.c4 .gt{font-size:11.5px;text-anchor:start;fill:#444}
.c4 .rel{fill:none;stroke:#707070;stroke-width:1.4;stroke-dasharray:6 4}.c4 .lbg{fill:#fff;fill-opacity:.88}
.c4 .ld{font-size:11.5px;fill:#333}.c4 .lt{font-size:10.5px;fill:#555;font-style:italic}
.c4 .node:hover{filter:brightness(1.08)}</style></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
${groups.join("\n")}
${paths.join("\n")}
${nodes.join("\n")}
${labels.join("\n")}
</svg>`;
}
function roundedPath(pts, r = 8) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const ax = x1 - ((x1 - x0) / d1) * rr, ay = y1 - ((y1 - y0) / d1) * rr;
    const bx = x1 + ((x2 - x1) / d2) * rr, by = y1 + ((y2 - y1) / d2) * rr;
    d += ` L${ax.toFixed(1)},${ay.toFixed(1)} Q${x1},${y1} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]},${l[1]}`;
}

// ── Structurizr DSL ─────────────────────────────────────
function dsl() {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '\\"')}"`;
  const tags = (e) => [e.ext && "External", e.shape === "db" && "Database", e.shape === "browser" && "Web Browser", e.shape === "folder" && "Folder", e.shape === "job" && "Job"].filter(Boolean).join(",");
  const kids = (pid) => elements.filter((e) => e.parent === pid);
  const lines = [];
  const emit = (e, ind) => {
    const pad = "    ".repeat(ind);
    const kw = { person: "person", system: "softwareSystem", container: "container", component: "component" }[e.kind];
    const args = e.kind === "person" || e.kind === "system" ? [q(e.name), q(e.desc), q(tags(e))] : [q(e.name), q(e.desc), q(e.tech), q(tags(e))];
    const ch = kids(e.id);
    lines.push(`${pad}${e.id} = ${kw} ${args.join(" ")}${ch.length ? " {" : ""}`);
    ch.forEach((c) => emit(c, ind + 1));
    if (ch.length) lines.push(`${pad}}`);
  };
  lines.push(`workspace ${q(meta.name)} ${q("C4 model of " + meta.repo + " (commit " + meta.commit + "). Generated from model.mjs - edit the model, not this file.")} {`);
  lines.push(`    !identifiers flat`, ``, `    model {`);
  elements.filter((e) => !e.parent).forEach((e) => emit(e, 2));
  lines.push("");
  for (const r of rels) lines.push(`        ${r.from} -> ${r.to} ${q(r.desc)}${r.tech ? " " + q(r.tech) : ""}`);
  lines.push("", `        deploymentEnvironment ${q(deployment.env)} {`);
  const dn = (n, ind) => {
    const pad = "    ".repeat(ind);
    lines.push(`${pad}${n.id} = deploymentNode ${q(n.name)} "" ${q(n.tech)} {`);
    (n.children || []).forEach((c) => dn(c, ind + 1));
    (n.instances || []).forEach((eid) => lines.push(`${pad}    ${byId[eid].kind === "system" ? "softwareSystemInstance" : "containerInstance"} ${eid}`));
    lines.push(`${pad}}`);
  };
  deployment.nodes.forEach((n) => dn(n, 3));
  for (const [a, b, d, t] of deployment.links || []) lines.push(`            ${a} -> ${b} ${q(d)} ${q(t)}`);
  lines.push(`        }`, `    }`, ``, `    views {`);
  for (const v of views) {
    const head = v.type === "SystemContext" ? `systemContext ${v.scope} ${q(v.key)}`
      : v.type === "Container" ? `container ${v.scope} ${q(v.key)}`
      : v.type === "Component" ? `component ${v.scope} ${q(v.key)}`
      : `deployment ${v.scope} ${q(v.env)} ${q(v.key)}`;
    lines.push(`        ${head} {`, `            title ${q(v.title)}`, `            description ${q(v.note)}`);
    if (v.include) lines.push(`            include ${v.include.filter((i) => i !== v.boundary).join(" ")}`);
    else lines.push(`            include *`);
    lines.push(`            autoLayout tb`, `        }`, ``);
  }
  lines.push(`        styles {
            element "Element" { color #ffffff }
            element "Person" { background #08427b; shape Person }
            element "Software System" { background #1168bd }
            element "Container" { background #438dd5 }
            element "Component" { background #85bbf0; color #000000 }
            element "External" { background #8a8a8a }
            element "Database" { shape Cylinder }
            element "Web Browser" { shape WebBrowser }
            element "Folder" { shape Folder }
            element "Job" { border dashed }
            relationship "Relationship" { dashed true; color #707070 }
        }
    }
}`);
  return lines.join("\n") + "\n";
}

// ── legend per view ─────────────────────────────────────
function legend(view) {
  const ids = view.type === "Deployment" ? Object.keys(viewGraph(view).inst) : view.include;
  const items = new Map();
  for (const id of ids) {
    const e = byId[id];
    const key = e.kind + (e.ext ? "Ext" : "") + (e.shape || "");
    if (items.has(key)) continue;
    const label = (e.ext ? "External " : "") + { person: "person", system: "software system", container: "container", component: "component" }[e.kind] + (e.shape === "db" ? " (database)" : e.shape === "browser" ? " (web browser / SPA)" : e.shape === "folder" ? " (file store)" : e.shape === "job" ? " (batch / scheduled job)" : "");
    const c = colorOf(e);
    const sw = e.kind === "person" ? `<svg width="22" height="22"><circle cx="11" cy="6" r="5" fill="${c.fill}"/><rect x="2" y="11" width="18" height="10" rx="5" fill="${c.fill}"/></svg>`
      : e.shape === "db" ? `<svg width="22" height="22"><path d="M2,5 L2,18 A9,3 0 0 0 20,18 L20,5 A9,3 0 0 0 2,5Z" fill="${c.fill}"/></svg>`
      : `<svg width="22" height="22"><rect x="1" y="3" width="20" height="16" rx="3" fill="${c.fill}" ${e.shape === "job" ? 'stroke="#1d4f80" stroke-dasharray="3 2"' : ""}/></svg>`;
    items.set(key, `<span class="key">${sw}${esc(label[0].toUpperCase() + label.slice(1))}</span>`);
  }
  let extra = `<span class="key"><svg width="34" height="22"><line x1="1" y1="11" x2="28" y2="11" stroke="#707070" stroke-width="1.4" stroke-dasharray="6 4"/><path d="M26,6 L33,11 L26,16z" fill="#666"/></svg>Relationship: label [technology], read in arrow direction</span>`;
  if (view.boundary) extra += `<span class="key"><svg width="22" height="22"><rect x="1" y="3" width="20" height="16" rx="2" fill="none" stroke="#555" stroke-dasharray="4 3"/></svg>Boundary of ${esc(byId[view.boundary].name)}</span>`;
  if (view.type === "Deployment") extra += `<span class="key"><svg width="22" height="22"><rect x="1" y="3" width="20" height="16" rx="3" fill="#fff" stroke="#555"/></svg>Deployment node</span>`;
  return [...items.values()].join("") + extra;
}

// ── page ────────────────────────────────────────────────
async function main() {
  fs.mkdirSync("out", { recursive: true });
  const svgs = {};
  for (const v of views) {
    const lay = await layout(v);
    svgs[v.key] = svgFor(lay, v);
    fs.writeFileSync(`out/${v.key}.svg`, svgs[v.key]);
  }
  const DSL = dsl();
  fs.writeFileSync("out/workspace.dsl", DSL);

  const tabNames = { context: "1 · System Context", containers: "2 · Containers", components: "3a · Components: API contexts", platform: "3b · Components: API platform", deployment: "4 · Deployment" };
  const rows = elements.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(typeLabel(e).slice(1, -1))}</td><td>${e.parent ? esc(byId[e.parent].name) : "—"}</td><td>${esc(e.desc)}</td></tr>`).join("");
  const page = fs.readFileSync("page.html", "utf8")
    .replaceAll("{{REPO}}", meta.repo).replaceAll("{{COMMIT}}", meta.commit).replaceAll("{{COMMITDATE}}", meta.commitDate).replaceAll("{{GENERATED}}", meta.generated)
    .replace("{{TABS}}", views.map((v) => `<a href="#${v.key}" data-k="${v.key}">${tabNames[v.key]}</a>`).join("") + `<a href="#catalogue" data-k="catalogue">Element catalogue</a><a href="#source" data-k="source">Model source & upkeep</a>`)
    .replace("{{VIEWS}}", views.map((v) => `<section id="v-${v.key}" class="view" hidden>
  <header class="vh"><h2>${esc(v.title)}</h2><p>${esc(v.note)}</p></header>
  <div class="tools"><button data-z="-1" aria-label="Zoom out">−</button><button data-z="0">Fit</button><button data-z="1" aria-label="Zoom in">+</button><span class="zv"></span></div>
  <div class="canvas">${svgs[v.key]}</div>
  <div class="legend"><b>Key</b>${legend(v)}</div>
</section>`).join("\n"))
    .replace("{{ROWS}}", rows)
    .replace("{{DSL}}", esc(DSL));
  fs.writeFileSync("out/index.html", page);
  console.log("ok", Object.fromEntries(Object.entries(svgs).map(([k, s]) => [k, s.match(/viewBox="([^"]+)"/)[1]])));
}
main().catch((e) => { console.error(e); process.exit(1); });
