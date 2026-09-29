// Carte Blanche — démo statique : tout le parcours tourne dans le navigateur.
import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { CATALOG } from "./data.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;

const MM = 72 / 25.4;
const app = document.getElementById("app");
const products = Object.fromEntries(CATALOG.products.map((p) => [p.code, p]));
const euro = (c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(c / 100);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- stockage local
const DB_NAME = "carte-blanche-demo";
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putFile(id, blob) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function getFile(id) {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction("files").objectStore("files").get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(DB_NAME)) ?? { cart: [], orders: [], seq: 1000 }; } catch { return { cart: [], orders: [], seq: 1000 }; }
}
let state = loadState();
function save() {
  try { localStorage.setItem(DB_NAME, JSON.stringify(state)); } catch { /* stockage indisponible : la démo reste utilisable pour la session */ }
  document.getElementById("cart-count").textContent = state.cart.length;
}

// ---------------------------------------------------------------- produits
function defaults(p) {
  return Object.fromEntries(Object.entries(p.options).map(([k, s]) => [k, s.default]));
}
function trimOf(p, opts) {
  return p.formats ? p.formats[opts.format ?? Object.keys(p.formats)[0]] : p.trim;
}
function pageLabels(p, opts) {
  if (p.pageLabels) return p.pageLabels;
  const n = opts.cards;
  if (opts.backs === "individual") return Array.from({ length: n * 2 }, (_, i) => (i % 2 ? `Dos ${(i + 1) / 2}` : `Carte ${i / 2 + 1}`));
  return ["Dos (commun)", ...Array.from({ length: n }, (_, i) => `Carte ${i + 1}`)];
}
function unitsOf(p, opts) {
  if (p.units) return p.units;
  const n = opts.cards;
  return opts.backs === "individual"
    ? Array.from({ length: n }, (_, i) => [2 * i, 2 * i + 1])
    : Array.from({ length: n }, (_, i) => [i + 1, 0]);
}
function price(p, { media, cards, copies }) {
  const pr = p.shop.pricing;
  const base = pr.unit + (pr.per_card ?? 0) * (cards ?? 0) + (pr.media?.[media] ?? 0);
  let coef = 1;
  for (const [min, c] of [...pr.tiers].sort((a, b) => a[0] - b[0])) if (copies >= min) coef = c;
  const unit = Math.round(base * coef * 100);
  return { unit, total: unit * copies, discount: Math.round((1 - coef) * 100) };
}
function describe(p, item) {
  const parts = [];
  for (const [k, s] of Object.entries(p.options)) {
    const v = item.options[k];
    parts.push(s.kind === "choice" ? s.choices[v] : `${v} cartes`);
  }
  parts.push(p.media.find((m) => m.code === item.media)?.label ?? item.media);
  return parts;
}

// ---------------------------------------------------------------- contrôle PDF (simplifié, dans le navigateur)
const COPY = {
  unreadable: ["Ce fichier n'est pas un PDF lisible", "Exportez votre création en PDF depuis votre logiciel, puis déposez-la à nouveau."],
  encrypted: ["Le PDF est protégé par un mot de passe", "Exportez-le sans protection."],
  bleed: ["Il manque le fond perdu", "Prolongez votre fond de 3 mm au-delà du bord de chaque carte, comme indiqué en rose sur le gabarit."],
  orientation: ["Des pages sont à l'horizontale", "Les cartes doivent être en portrait (à la verticale)."],
  font: ["Une police n'est pas incorporée", "Exportez votre PDF en incorporant les polices, ou vectorisez le texte."],
  safe: ["Du texte est trop près du bord", "Il risque d'être coupé. Gardez vos textes à l'intérieur de la ligne pointillée du gabarit."],
};

async function checkPdf(file, product, opts) {
  const labels = pageLabels(product, opts);
  const [tw, th] = trimOf(product, opts);
  const bleed = product.bleed, safe = product.safe, tol = 0.6;
  const found = new Map();
  const add = (key, level, title, help, label) => {
    const k = `${key}:${level}`;
    const m = found.get(k) ?? { level, title, help, cards: [] };
    if (label && !m.cards.includes(label)) m.cards.push(label.replace(/^Face — /, ""));
    found.set(k, m);
  };
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (e) {
    const [t, h] = e?.name === "PasswordException" ? COPY.encrypted : COPY.unreadable;
    return { passed: false, pages: 0, messages: [{ level: "error", title: t, help: h, cards: [] }], previews: [] };
  }
  if (doc.numPages !== labels.length) {
    add("pages", "error", "Le nombre de pages ne correspond pas",
      `${doc.numPages} page(s) reçue(s), ${labels.length} attendue(s) : page 1 = dos, puis les cartes dans l'ordre du gabarit.`);
  }
  const close = (a, b) => Math.abs(a - b) <= tol;
  const count = Math.min(doc.numPages, labels.length);
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const label = labels[n - 1];
    let [x0, y0, x1, y1] = page.view;
    let w = (x1 - x0) / MM, h = (y1 - y0) / MM;
    if (page.rotate % 180) [w, h] = [h, w];
    let pageBleed = bleed;
    if (close(w, tw + 2 * bleed) && close(h, th + 2 * bleed)) { /* conforme */ }
    else if (close(w, tw) && close(h, th)) { add("bleed", "error", ...COPY.bleed, label); pageBleed = 0; }
    else if (close(w, th + 2 * bleed) && close(h, tw + 2 * bleed) || close(w, th) && close(h, tw)) { add("orientation", "error", ...COPY.orientation, label); continue; }
    else {
      add("size", "error", "Le format des pages n'est pas le bon",
        `Page de ${w.toFixed(1)} × ${h.toFixed(1)} mm, attendu ${(tw + 2 * bleed).toFixed(1)} × ${(th + 2 * bleed).toFixed(1)} mm (format fini + 3 mm de fond perdu). Partez de notre gabarit.`, label);
      continue;
    }
    // Images (résolution à la taille d'impression) et polices
    const ops = await page.getOperatorList();
    const O = pdfjsLib.OPS;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = (m, c) => [m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3], m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3], m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5]];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === O.save) stack.push(ctm);
      else if (fn === O.restore) ctm = stack.pop() ?? ctm;
      else if (fn === O.transform) ctm = mul(args, ctm);
      else if (fn === O.paintFormXObjectBegin && args?.[0]) { stack.push(ctm); ctm = mul(args[0], ctm); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
        const px = fn === O.paintImageXObject ? [args[1], args[2]] : [args[0].width, args[0].height];
        const wpt = Math.hypot(ctm[0], ctm[1]), hpt = Math.hypot(ctm[2], ctm[3]);
        if (wpt > 2 && hpt > 2) {
          const ppi = Math.min(px[0] / (wpt / 72), px[1] / (hpt / 72));
          if (ppi < 150) add("image", "error", "Une image est trop pixelisée", `Elle fait ${Math.round(ppi)} ppi à la taille d'impression : il faut au moins 150 ppi. Utilisez une image plus grande.`, label);
          else if (ppi < 250) add("image-low", "warning", "Une image est un peu légère", `${Math.round(ppi)} ppi : elle sera imprimée, mais moins nette (300 ppi idéalement).`, label);
        }
      } else if (fn === O.setFont && args?.[0]) {
        try {
          const font = page.commonObjs.has(args[0]) ? page.commonObjs.get(args[0]) : null;
          if (font && font.missingFile && !font.isType3Font) add("font", "error", ...COPY.font, label);
        } catch { /* police non résolue : ignorée dans la démo */ }
      }
    }
    // Texte hors zone de sécurité
    const text = await page.getTextContent();
    const s = (pageBleed + safe) * MM;
    for (const item of text.items) {
      if (!item.str?.trim()) continue;
      const x = item.transform[4] - x0, y = item.transform[5] - y0;
      if (x < s || y < s || x + item.width > (x1 - x0) - s || y + item.height > (y1 - y0) - s) { add("safe", "warning", ...COPY.safe, label); break; }
    }
    page.cleanup();
  }
  // Aperçus : dos + première carte
  const previews = [];
  for (const n of [1, 2].filter((n) => n <= doc.numPages)) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const scale = 260 / vp.width;
    const canvas = document.createElement("canvas");
    const v = page.getViewport({ scale });
    canvas.width = Math.round(v.width); canvas.height = Math.round(v.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: v }).promise;
    previews.push(canvas.toDataURL("image/jpeg", 0.85));
  }
  await doc.destroy();
  const messages = [...found.values()].sort((a, b) => (a.level === "error" ? -1 : 1) - (b.level === "error" ? -1 : 1));
  const passed = !messages.some((m) => m.level === "error");
  if (passed) messages.unshift({ level: "ok", title: "Votre fichier est prêt à imprimer", help: `${labels.length} pages contrôlées : nombre de pages, format, fond perdu, images, polices, marges.`, cards: [] });
  messages.push({ level: "info", title: "Couleurs", help: "À l'atelier, les couleurs RVB sont converties en CMJN (profil FOGRA51) avant impression.", cards: [] });
  return { passed, pages: doc.numPages, messages, previews };
}

// ---------------------------------------------------------------- vues
function home() {
  app.innerHTML = `
  <div class="container hero">
    <div>
      <h1>Votre jeu.<br><em>Vos règles.</em></h1>
      <p class="sub">Jeux de cartes, jeux de famille et oracles à votre image. Vous déposez votre fichier, on le contrôle en direct, vous voyez tout avant de payer.</p>
      <div class="actions"><a class="btn red" href="#/creer/jeu-poker-54">Créer mon jeu →</a><a class="link" href="#comment">Voir comment ça marche</a></div>
      <div class="promise"><span>Contrôle du fichier en direct</span><span>Carton 350 g</span><span>Fabriqué en France</span></div>
    </div>
    <figure><img src="img/scene-hero.jpg" alt="Éventail de cartes Carte Blanche sur un tapis vert, avec leur étui."></figure>
  </div>
  <section class="section container" id="jeux">
    <div class="head"><h2>Choisissez votre jeu</h2><p>Tout se personnalise ensuite : format, carton, dos, nombre de cartes.</p></div>
    <div class="products">${CATALOG.products.map((p) => {
      const cards = p.options.cards?.min;
      const from = price(p, { media: "", cards, copies: 1 }).unit;
      return `<a class="product" href="#/creer/${p.code}">${p.code === "jeu-poker-54-dos-individuels" ? '<span class="badge">Le plus offert</span>' : ""}
        <div class="ph"><img src="img/${p.shop.image}.jpg" alt=""></div>
        <div class="meta"><h3>${esc(p.shop.title)}</h3><span class="price"><small>dès </small>${euro(from)}</span></div>
        <p>${esc(p.shop.tagline)}</p></a>`;
    }).join("")}</div>
  </section>
  <section class="container"><div class="feature">
    <img src="img/scene-oracle.jpg" alt="Cartes oracle au format tarot : la Lune, le Soleil, l'Étoile.">
    <div class="txt"><h2>Votre oracle, de 22 à 100 cartes</h2><p>Format tarot ou poker, chaque carte unique, coins arrondis. Le prix s'ajuste en direct au nombre de cartes.</p>
    <div><a class="btn" href="#/creer/oracle">Créer mon oracle</a></div></div></div></section>
  <section class="section container" id="comment">
    <div class="head"><h2>Trois étapes, et vous voyez tout avant de payer</h2></div>
    <div class="products">
      <div class="product"><div class="ph"><img src="img/scene-etui.jpg" alt=""></div><h3>1. Choisissez</h3><p>Format, carton, nombre de cartes, quantité : le prix s'affiche en direct.</p></div>
      <div class="product"><div class="ph"><img src="img/scene-detail.jpg" alt=""></div><h3>2. Déposez votre fichier</h3><p>Partez de notre gabarit. On contrôle votre PDF et on vous dit quoi corriger, carte par carte.</p></div>
      <div class="product"><div class="ph"><img src="img/scene-famille.jpg" alt=""></div><h3>3. Vérifiez et commandez</h3><p>Aperçu de vos cartes, puis paiement. On imprime dans notre atelier.</p></div>
    </div>
    <p class="hint" style="margin-top:24px">Pour tester : <a class="link" href="exemples/jeu-54-carte-blanche.pdf">jeu de 54 cartes</a> · <a class="link" href="exemples/oracle-30-tarot.pdf">oracle de 30 cartes (tarot)</a> · <a class="link" href="exemples/jeu-54-a-corriger.pdf">fichier à corriger</a></p>
  </section>
  <section class="container"><div class="cta-band"><h2>Donnez-vous carte blanche.</h2><div><a class="btn light" href="#/creer/jeu-poker-54">Créer mon jeu →</a></div></div></section>`;
}

function configurator(code) {
  const p = products[code];
  if (!p) return notFound();
  const gallery = [p.shop.image, ...(code === "oracle" ? ["scene-detail", "scene-etui", "scene-hero"] : ["scene-hero", "scene-famille", "scene-detail", "scene-etui"]).filter((i) => i !== p.shop.image)].slice(0, 4);
  const s = { opts: defaults(p), media: p.media[0].code, copies: 1, phase: "idle", result: null, error: "" };

  function render() {
    const locked = s.phase === "checking" || s.phase === "done";
    const cards = s.opts.cards;
    const pr = price(p, { media: s.media, cards, copies: s.copies });
    const next = [...p.shop.pricing.tiers].sort((a, b) => a[0] - b[0]).find(([min]) => min > s.copies);
    const fmt = s.opts.format && p.templates[s.opts.format] ? s.opts.format : "default";
    const pages = pageLabels(p, s.opts).length;
    app.innerHTML = `
    <div class="container config">
      <div class="gallery">
        <div class="main"><img id="main-img" src="img/${gallery[0]}.jpg" alt="${esc(p.shop.title)}"></div>
        <div class="thumbs">${gallery.map((g, i) => `<button data-img="${g}" aria-pressed="${i === 0}" aria-label="Voir cette photo"><img src="img/${g}.jpg" alt=""></button>`).join("")}</div>
      </div>
      <div>
        <div class="panel-title"><h1>${esc(p.shop.title)}</h1><p>${esc(p.shop.description)}</p></div>
        ${Object.entries(p.options).map(([k, spec]) => `
          <div class="block"><h2>${esc(spec.label)}${spec.kind === "number" ? `<small>${spec.min} à ${spec.max}</small>` : ""}</h2>
          ${spec.kind === "choice"
            ? `<div class="chips">${Object.entries(spec.choices).map(([v, l]) => `<button class="chip" data-opt="${k}" data-val="${v}" aria-pressed="${s.opts[k] === v}" ${locked ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>`
            : `<div class="range"><input type="range" id="opt-${k}" data-num="${k}" min="${spec.min}" max="${spec.max}" value="${s.opts[k]}" ${locked ? "disabled" : ""} aria-label="${esc(spec.label)}">
               <div class="stepper"><button data-step="${k}" data-d="-1" aria-label="Moins" ${locked ? "disabled" : ""}>−</button><input id="opt-${k}-n" data-num="${k}" inputmode="numeric" value="${s.opts[k]}" ${locked ? "disabled" : ""} aria-label="${esc(spec.label)}"><button data-step="${k}" data-d="1" aria-label="Plus" ${locked ? "disabled" : ""}>+</button></div></div>`}
          </div>`).join("")}
        <div class="block"><h2>Carton</h2><div class="media-list">${p.media.map((m) => `<button class="media-opt" data-media="${m.code}" aria-pressed="${s.media === m.code}" ${locked ? "disabled" : ""}><b>${esc(m.label)}</b><span>${esc(m.description)}</span></button>`).join("")}</div></div>
        <div class="block"><h2>Quantité<small>exemplaires du même jeu</small></h2>
          <div class="row-actions"><div class="stepper"><button data-copies="-1" aria-label="Moins" ${locked ? "disabled" : ""}>−</button><input id="copies" inputmode="numeric" value="${s.copies}" ${locked ? "disabled" : ""} aria-label="Quantité"><button data-copies="1" aria-label="Plus" ${locked ? "disabled" : ""}>+</button></div>
          ${next ? `<span class="hint">Dès ${next[0]} exemplaires : −${Math.round((1 - next[1]) * 100)} % sur chaque jeu</span>` : ""}</div>
          <div class="price-box"><div><div class="unit">${euro(pr.unit)} le jeu${pr.discount ? ` (−${pr.discount} %)` : ""}</div><div class="total">${euro(pr.total)}</div></div><span class="hint">TTC, hors livraison · prix fictifs</span></div>
        </div>
        <div class="block"><h2>Votre fichier<small>PDF de ${pages} pages</small></h2>
          <p class="hint">Partez de notre gabarit : fond perdu, zone de sécurité et ordre des pages. <a class="link" href="${p.templates[fmt]}" download>Télécharger le gabarit</a></p>
          ${s.phase === "idle" || s.phase === "error" ? `
            <label class="dropzone" id="drop" for="file"><b>Déposez votre PDF ici</b><span class="hint">ou cliquez pour le choisir</span>
              <input id="file" type="file" accept="application/pdf" hidden></label>
            ${s.error ? `<p class="error-text">${esc(s.error)}</p>` : ""}
            <p class="sample-files hint">Fichiers de test : <a href="exemples/jeu-54-carte-blanche.pdf" download>jeu de 54</a><a href="exemples/oracle-30-tarot.pdf" download>oracle 30 cartes</a><a href="exemples/jeu-54-a-corriger.pdf" download>à corriger</a></p>
            <div class="soon">Pas de logiciel de graphisme ? La création en ligne, sans fichier, arrive bientôt.</div>` : ""}
          ${s.phase === "checking" ? `<p aria-live="polite"><span class="spinner"></span>Contrôle de votre fichier : pages, format, fond perdu, images, polices…</p>` : ""}
          ${s.phase === "done" ? `<div class="check" aria-live="polite">
            ${s.result.messages.map((m) => `<div class="msg ${m.level === "info" ? "ok" : m.level}"><b>${esc(m.title)}</b><span>${esc(m.help)}</span>${m.cards.length ? `<span class="cards">${esc(m.cards.slice(0, 6).join(" · "))}${m.cards.length > 6 ? ` et ${m.cards.length - 6} autres` : ""}</span>` : ""}</div>`).join("")}
            ${s.result.previews.length ? `<div class="previews">${s.result.previews.map((src) => `<img src="${src}" alt="Aperçu d'une carte de votre fichier">`).join("")}</div>` : ""}
            <div class="row-actions">${s.result.passed
              ? `<a class="btn red" href="#/panier">Ajouté au panier · voir le panier</a><button class="link" id="again">Créer un autre jeu</button>`
              : `<button class="btn" id="again">Déposer un fichier corrigé</button>`}</div></div>` : ""}
        </div>
      </div>
    </div>`;
    bind();
  }

  function bind() {
    app.querySelectorAll("[data-img]").forEach((b) => b.onclick = () => {
      document.getElementById("main-img").src = `img/${b.dataset.img}.jpg`;
      app.querySelectorAll("[data-img]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });
    app.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => { s.opts[b.dataset.opt] = b.dataset.val; render(); });
    const clampOpt = (k, v) => { const spec = p.options[k]; return Math.min(spec.max, Math.max(spec.min, Math.round(Number(v) || spec.min))); };
    app.querySelectorAll("[data-num]").forEach((i) => i.onchange = () => { s.opts[i.dataset.num] = clampOpt(i.dataset.num, i.value); render(); });
    app.querySelectorAll("input[type=range][data-num]").forEach((i) => i.oninput = () => { s.opts[i.dataset.num] = clampOpt(i.dataset.num, i.value); render(); document.getElementById(i.id)?.focus(); });
    app.querySelectorAll("[data-step]").forEach((b) => b.onclick = () => { const k = b.dataset.step; s.opts[k] = clampOpt(k, s.opts[k] + Number(b.dataset.d)); render(); });
    app.querySelectorAll("[data-media]").forEach((b) => b.onclick = () => { s.media = b.dataset.media; render(); });
    app.querySelectorAll("[data-copies]").forEach((b) => b.onclick = () => { s.copies = Math.min(500, Math.max(1, s.copies + Number(b.dataset.copies))); render(); });
    const copies = document.getElementById("copies");
    if (copies) copies.onchange = () => { s.copies = Math.min(500, Math.max(1, Math.round(Number(copies.value) || 1))); render(); };
    const file = document.getElementById("file");
    if (file) file.onchange = () => file.files[0] && upload(file.files[0]);
    const drop = document.getElementById("drop");
    if (drop) {
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) upload(f); };
    }
    const again = document.getElementById("again");
    if (again) again.onclick = () => { s.phase = "idle"; s.result = null; render(); };
  }

  async function upload(f) {
    if (f.type && f.type !== "application/pdf") { s.phase = "error"; s.error = "Déposez un fichier PDF."; return render(); }
    s.phase = "checking"; s.error = ""; render();
    try {
      const result = await checkPdf(f, p, s.opts);
      s.result = result; s.phase = "done";
      if (result.passed) {
        const id = crypto.randomUUID();
        await putFile(id, f);
        const pr = price(p, { media: s.media, cards: s.opts.cards, copies: s.copies });
        state.cart.push({ id, product: p.code, title: p.shop.title, media: s.media, options: { ...s.opts }, copies: s.copies,
          fileName: f.name, preview: result.previews[1] ?? result.previews[0] ?? null, unit: pr.unit, total: pr.total });
        save();
      }
    } catch (e) {
      s.phase = "error"; s.error = `Le contrôle a échoué : ${e.message}`;
    }
    render();
  }
  render();
}

function cart() {
  const total = state.cart.reduce((t, i) => t + i.total, 0);
  if (!state.cart.length) {
    app.innerHTML = `<div class="container"><h1 class="page-title">Votre panier</h1><div style="padding-bottom:80px;display:grid;gap:20px;justify-items:start"><p class="muted">Votre panier est vide.</p><a class="btn red" href="#/">Choisir un jeu</a></div></div>`;
    return;
  }
  app.innerHTML = `
  <div class="container"><h1 class="page-title">Votre panier</h1>
  <div class="cart"><div>${state.cart.map((i) => `
    <div class="line">${i.preview ? `<img src="${i.preview}" alt="">` : '<div class="ph"></div>'}
      <div style="display:grid;gap:6px"><h3>${esc(i.title)}</h3><div class="details">${esc(describe(products[i.product], i).join(" · "))}</div>
        <div><span class="status approved">Fichier validé</span> <span class="details">${esc(i.fileName)}</span></div>
        <div class="row-actions"><div class="stepper"><button data-q="${i.id}" data-d="-1" aria-label="Moins">−</button><input value="${i.copies}" readonly aria-label="Quantité" id="q-${i.id}"><button data-q="${i.id}" data-d="1" aria-label="Plus">+</button></div>
        <button class="link" data-rm="${i.id}">Retirer</button></div></div>
      <div class="amount">${euro(i.total)}</div></div>`).join("")}</div>
  <form class="summary" id="checkout">
    <div class="row"><span>Sous-total</span><b>${euro(total)}</b></div>
    <div class="row"><span>Livraison</span><span class="muted">calculée à l'étape suivante</span></div>
    <div class="row grand"><span>Total</span><span>${euro(total)}</span></div>
    <label class="field">E-mail<input type="email" id="f-email" required autocomplete="email"></label>
    <label class="field">Nom complet<input id="f-name" required autocomplete="name"></label>
    <label class="field">Adresse<input id="f-line1" required autocomplete="address-line1"></label>
    <div class="grid2"><label class="field">Code postal<input id="f-postal" required autocomplete="postal-code"></label><label class="field">Ville<input id="f-city" required autocomplete="address-level2"></label></div>
    <button class="btn red full" type="submit">Payer ${euro(total)}</button>
  </form></div></div>`;
  app.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => {
    const i = state.cart.find((x) => x.id === b.dataset.q);
    i.copies = Math.min(500, Math.max(1, i.copies + Number(b.dataset.d)));
    const pr = price(products[i.product], { media: i.media, cards: i.options.cards, copies: i.copies });
    i.unit = pr.unit; i.total = pr.total; save(); cart();
  });
  app.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { state.cart = state.cart.filter((x) => x.id !== b.dataset.rm); save(); cart(); });
  document.getElementById("checkout").onsubmit = (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    const number = `FP-${++state.seq}`;
    state.orders.unshift({ number, email: v("f-email"), name: v("f-name"), address: `${v("f-line1")}, ${v("f-postal")} ${v("f-city")}`,
      items: state.cart, total, status: "awaiting_payment", created: new Date().toISOString() });
    state.cart = []; save();
    location.hash = `#/paiement/${number}`;
  };
}

function payment(number) {
  const o = state.orders.find((x) => x.number === number);
  if (!o) return notFound();
  app.innerHTML = `<div class="container" style="padding-block:60px;max-width:560px;display:grid;gap:18px">
    <h1 style="font-size:40px">Paiement de test</h1>
    <p class="muted">Démo : aucune carte n'est débitée. Sur le vrai site, cette étape est la page de paiement Stripe ou Revolut.</p>
    <div class="summary" style="position:static"><div class="row"><span>Commande ${esc(o.number)}</span><b>${euro(o.total)}</b></div></div>
    <button class="btn red" id="pay">Simuler un paiement accepté</button></div>`;
  document.getElementById("pay").onclick = () => { o.status = "paid"; o.paid = new Date().toISOString(); save(); location.hash = `#/commande/${number}`; };
}

function order(number) {
  const o = state.orders.find((x) => x.number === number);
  if (!o) return notFound();
  const steps = [["Commande payée", ["paid", "in_production"]], ["Fichiers préparés pour l'impression", ["in_production"]], ["Imprimée à l'atelier", []], ["Expédiée", []]];
  app.innerHTML = `<div class="container" style="padding-bottom:80px"><h1 class="page-title">Commande ${esc(o.number)}</h1>
    <p class="muted">Merci ${esc(o.name)} ! Confirmation envoyée à ${esc(o.email)} (sur le vrai site).</p>
    <div class="timeline">${steps.map(([l, done]) => `<div class="${done.includes(o.status) ? "done" : ""}">${l}</div>`).join("")}</div>
    ${o.items.map((i) => `<div class="line">${i.preview ? `<img src="${i.preview}" alt="">` : '<div class="ph"></div>'}<div style="display:grid;gap:6px"><h3>${esc(i.title)}</h3><div class="details">${esc(describe(products[i.product], i).join(" · "))} · ${i.copies} ex.</div></div><div class="amount">${euro(i.total)}</div></div>`).join("")}
    <p style="margin-top:20px;font-weight:600">Total payé : ${euro(o.total)}</p>
    <p class="hint" style="margin-top:12px">Côté atelier : <a class="link" href="#/atelier">voir la préparation de la feuille SRA3</a></p></div>`;
}

// ---------------------------------------------------------------- atelier : imposition SRA3 dans le navigateur
function computeLayout(trimW, trimH, bleed) {
  const { w: SW, h: SH, margin } = CATALOG.sheet;
  const aw = SW - 2 * margin, ah = SH - 2 * margin;
  let best = null;
  for (const rot of [0, 90]) {
    const [w, h] = rot ? [trimH, trimW] : [trimW, trimH];
    const sw = w + 2 * bleed, sh = h + 2 * bleed;
    const cols = Math.floor(aw / sw), rows = Math.floor(ah / sh);
    if (!best || cols * rows > best.cols * best.rows) best = { rot, cols, rows, sw, sh };
  }
  const gw = best.cols * best.sw, gh = best.rows * best.sh;
  const x0 = (SW - gw) / 2, yTop = (SH + gh) / 2;
  const slots = [];
  for (let r = 0; r < best.rows; r++) for (let c = 0; c < best.cols; c++) {
    slots.push({ x: (x0 + c * best.sw) * MM, y: (yTop - (r + 1) * best.sh) * MM, w: best.sw * MM, h: best.sh * MM, rot: best.rot });
  }
  return { ...best, slots, bleed };
}

function groupsOfPaidOrders() {
  const groups = new Map();
  for (const o of state.orders.filter((x) => x.status === "paid")) {
    for (const item of o.items) {
      const p = products[item.product];
      const trim = trimOf(p, item.options);
      const units = unitsOf(p, item.options);
      const duplex = units.some((u) => u[1] !== null && u[1] !== undefined);
      const key = `${item.media}|${trim.join("x")}|${duplex ? "RV" : "R"}`;
      if (!groups.has(key)) groups.set(key, { key, media: item.media, trim, duplex, entries: [] });
      groups.get(key).entries.push({ order: o, item, units });
    }
  }
  return [...groups.values()];
}

function workshop() {
  const paid = state.orders.filter((o) => o.status === "paid" || o.status === "in_production");
  const groups = groupsOfPaidOrders();
  app.innerHTML = `<div class="container admin" style="padding-bottom:80px"><h1 class="page-title">Atelier</h1>
    <div class="kpis"><div><span class="muted">Commandes payées</span><b>${paid.length}</b></div>
      <div><span class="muted">Groupes à imposer</span><b>${groups.length}</b></div>
      <div><span class="muted">Feuille</span><b>${CATALOG.sheet.code}</b></div>
      <div><span class="muted">Encaissé (fictif)</span><b>${euro(paid.reduce((t, o) => t + o.total, 0))}</b></div></div>
    <h2>Feuilles SRA3 à générer</h2>
    <p class="hint" style="margin-bottom:14px">Les commandes compatibles (même carton, même format, recto/verso) sont regroupées sur les mêmes feuilles, en ordre « coupe et empile », avec un séparateur par exemplaire. Sur le vrai site, ce travail est fait automatiquement par le moteur d'impression, avec conversion CMJN FOGRA51 et sortie PDF/X-4.</p>
    ${groups.length ? groups.map((g, i) => {
      const l = computeLayout(g.trim[0], g.trim[1], 3);
      const n = g.entries.reduce((t, e) => t + e.item.copies * (e.units.length + 1), 0);
      return `<div class="group"><h3>${esc(g.media)} · ${g.trim.join(" × ")} mm · ${g.duplex ? "recto/verso" : "recto"}</h3>
        <p class="hint">${g.entries.map((e) => `${e.order.number} : ${e.item.copies} × ${esc(e.item.title)}`).join(" · ")}</p>
        <p>${l.slots.length} poses par feuille (${l.cols} × ${l.rows}${l.rot ? ", pivotées" : ""}) · ${n} pièces · ${Math.ceil(n / l.slots.length)} feuille(s)</p>
        <div class="row-actions"><button class="btn red" data-group="${i}">Générer la feuille SRA3</button><span id="dl-${i}"></span></div>
        <div class="sheet-preview" id="pv-${i}"></div></div>`;
    }).join("") : `<p class="muted">Aucune commande payée pour l'instant. Passez une commande puis revenez ici.</p>`}
    <h2>Commandes</h2>
    <div class="scroll"><table><thead><tr><th>N°</th><th>Client</th><th>Jeux</th><th>Total</th><th>État</th></tr></thead><tbody>
    ${state.orders.map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.email)}</td><td>${o.items.map((i) => `${i.copies} × ${esc(i.title)}`).join("<br>")}</td><td>${euro(o.total)}</td><td><span class="status ${o.status}">${o.status === "paid" ? "payée" : o.status === "in_production" ? "en production" : "paiement en attente"}</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Aucune commande.</td></tr>`}
    </tbody></table></div></div>`;
  app.querySelectorAll("[data-group]").forEach((b) => b.onclick = async () => {
    const i = Number(b.dataset.group);
    b.disabled = true; b.textContent = "Génération…";
    try {
      const bytes = await generateSheets(groups[i]);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      document.getElementById(`dl-${i}`).innerHTML = `<a class="link" href="${url}" download="lot-sra3-${groups[i].media}.pdf">Télécharger le PDF SRA3</a>`;
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const pv = document.getElementById(`pv-${i}`);
      pv.innerHTML = "";
      for (const n of [1, 2].filter((n) => n <= doc.numPages)) {
        const page = await doc.getPage(n);
        const v = page.getViewport({ scale: 520 / page.getViewport({ scale: 1 }).width });
        const c = document.createElement("canvas");
        c.width = Math.round(v.width); c.height = Math.round(v.height);
        await page.render({ canvasContext: c.getContext("2d"), viewport: v }).promise;
        pv.appendChild(c);
      }
      b.textContent = "Feuilles générées";
    } catch (e) {
      b.disabled = false; b.textContent = "Générer la feuille SRA3";
      document.getElementById(`dl-${i}`).innerHTML = `<span class="error-text">Échec : ${esc(e.message)}</span>`;
    }
  });
}

async function generateSheets(group) {
  const layout = computeLayout(group.trim[0], group.trim[1], 3);
  const SW = CATALOG.sheet.w * MM, SH = CATALOG.sheet.h * MM;
  const pieces = [];
  for (const { order: o, item, units } of group.entries) {
    for (let c = 0; c < item.copies; c++) {
      pieces.push({ sep: true, order: o.number, copy: c + 1, copies: item.copies, count: units.length });
      for (const [recto, verso] of units) pieces.push({ file: item.id, recto, verso });
    }
  }
  const per = layout.slots.length, sheets = Math.ceil(pieces.length / per);
  const grid = Array.from({ length: sheets }, () => Array(per).fill(null));
  pieces.forEach((piece, pos) => { grid[pos % sheets][Math.floor(pos / sheets)] = piece; }); // coupe et empile

  const out = await PDFDocument.create();
  out.setTitle(`Lot SRA3 ${group.media}`);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const sources = new Map(), embedded = new Map();
  async function pageOf(fileId, index) {
    const key = `${fileId}:${index}`;
    if (!embedded.has(key)) {
      if (!sources.has(fileId)) {
        const blob = await getFile(fileId);
        if (!blob) throw new Error("fichier introuvable dans ce navigateur");
        sources.set(fileId, await PDFDocument.load(await blob.arrayBuffer()));
      }
      embedded.set(key, await out.embedPage(sources.get(fileId).getPage(index)));
    }
    return embedded.get(key);
  }
  const place = (page, emb, slot) => {
    const r = slot.rot;
    const at = r === 0 ? [slot.x, slot.y] : r === 90 ? [slot.x + slot.w, slot.y] : r === 180 ? [slot.x + slot.w, slot.y + slot.h] : [slot.x, slot.y + slot.h];
    page.drawPage(emb, { x: at[0], y: at[1], width: emb.width, height: emb.height, rotate: degrees(r) });
  };
  const flip = (slot) => CATALOG.press.flip === "short_edge"
    ? { ...slot, y: SH - slot.y - slot.h, rot: (180 - slot.rot + 360) % 360 }
    : { ...slot, x: SW - slot.x - slot.w, rot: (360 - slot.rot) % 360 };
  const batch = `L${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const black = rgb(0, 0, 0);
  const b = layout.bleed * MM, off = 1.5 * MM, len = 4 * MM;
  const xs = [...new Set(layout.slots.flatMap((sl) => [sl.x + b, sl.x + sl.w - b]).map((v) => v.toFixed(2)))].map(Number);
  const ys = [...new Set(layout.slots.flatMap((sl) => [sl.y + b, sl.y + sl.h - b]).map((v) => v.toFixed(2)))].map(Number);
  const gx0 = Math.min(...layout.slots.map((sl) => sl.x)), gx1 = Math.max(...layout.slots.map((sl) => sl.x + sl.w));
  const gy0 = Math.min(...layout.slots.map((sl) => sl.y)), gy1 = Math.max(...layout.slots.map((sl) => sl.y + sl.h));

  for (let s = 0; s < sheets; s++) {
    for (const side of group.duplex ? ["RECTO", "VERSO"] : ["RECTO"]) {
      const page = out.addPage([SW, SH]);
      for (let k = 0; k < per; k++) {
        const piece = grid[s][k];
        if (!piece) continue;
        const slot = side === "RECTO" ? layout.slots[k] : flip(layout.slots[k]);
        if (piece.sep) {
          page.drawRectangle({ x: slot.x, y: slot.y, width: slot.w, height: slot.h, color: rgb(0.86, 0.86, 0.87) });
          const cx = slot.x + 14, cy = slot.y + slot.h / 2;
          page.drawText("SEPARATEUR", { x: cx, y: cy + 18, size: 9, font: bold });
          page.drawText(`${piece.order} - ex. ${piece.copy}/${piece.copies}`, { x: cx, y: cy + 4, size: 8, font });
          page.drawText(`${piece.count} cartes - ${side}`, { x: cx, y: cy - 10, size: 7, font });
        } else {
          const index = side === "RECTO" ? piece.recto : piece.verso;
          if (index === null || index === undefined) continue;
          place(page, await pageOf(piece.file, index), slot);
        }
      }
      if (side === "RECTO") {
        for (const x of xs) {
          page.drawLine({ start: { x, y: gy1 + off }, end: { x, y: Math.min(gy1 + off + len, SH) }, thickness: 0.25, color: black });
          page.drawLine({ start: { x, y: gy0 - off }, end: { x, y: Math.max(gy0 - off - len, 0) }, thickness: 0.25, color: black });
        }
        for (const y of ys) {
          page.drawLine({ start: { x: gx0 - off, y }, end: { x: Math.max(gx0 - off - len, 0), y }, thickness: 0.25, color: black });
          page.drawLine({ start: { x: gx1 + off, y }, end: { x: Math.min(gx1 + off + len, SW), y }, thickness: 0.25, color: black });
        }
      }
      page.drawText(`Lot ${batch} - feuille ${s + 1}/${sheets} - ${side} - ${group.media} - ${per} poses sur ${CATALOG.sheet.code} - ${CATALOG.press.name} (demo)`, { x: 10 * MM, y: 3.5 * MM, size: 6, font });
    }
  }
  for (const { order: o } of group.entries) o.status = "in_production";
  save();
  return out.save();
}

function notFound() {
  app.innerHTML = `<div class="container" style="padding-block:60px"><h1 class="page-title">Page introuvable</h1><a class="btn" href="#/">Retour à l'accueil</a></div>`;
}

// ---------------------------------------------------------------- navigation
function route() {
  const [, view, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  if (!view) home();
  else if (view === "creer") configurator(arg);
  else if (view === "panier") cart();
  else if (view === "paiement") payment(arg);
  else if (view === "commande") order(arg);
  else if (view === "atelier") workshop();
  else if (location.hash.startsWith("#/")) notFound();
  else return; // ancre interne (#comment…) : laisser le navigateur défiler
  window.scrollTo(0, 0);
  save();
}
window.addEventListener("hashchange", route);
document.getElementById("reset-demo").onclick = () => {
  state = { cart: [], orders: [], seq: 1000 };
  save();
  indexedDB.deleteDatabase(DB_NAME);
  location.hash = "#/";
};
route();
