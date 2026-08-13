(function () {
  "use strict";

  let DATA = null;
  const state = {
    alpha: new Set(),
    beta: new Set(),
    gamma: new Set(),
    params: new Set(), // active parameter ids shown as columns
  };

  const els = {
    alphaRow: document.querySelector('[data-facet="alpha"]'),
    betaRow: document.querySelector('[data-facet="beta"]'),
    gammaRow: document.querySelector('[data-facet="gamma"]'),
    paramToggle: document.getElementById("param-toggle"),
    matrixHead: document.getElementById("matrix-head"),
    matrixBody: document.getElementById("matrix-body"),
    emptyState: document.getElementById("empty-state"),
    legendItems: document.getElementById("legend-items"),
    resetBtn: document.getElementById("reset-facets"),
    detailPanel: document.getElementById("detail-panel"),
    detailContent: document.getElementById("detail-content"),
    detailClose: document.getElementById("detail-close"),
    detailOverlay: document.getElementById("detail-overlay"),
    bannerCount: document.getElementById("banner-count"),
    viewSearch: document.getElementById("view-search"),
    viewProblem: document.getElementById("view-problem"),
    viewMaps: document.getElementById("view-maps"),
    viewMap: document.getElementById("view-map"),
    viewGlossary: document.getElementById("view-glossary"),
    viewReferences: document.getElementById("view-references"),
    navLinks: document.querySelectorAll(".site-nav a"),
  };

  const EMPTY_BETA_TOKEN = "∅";
  const VIEWS = {
    "/": els.viewSearch,
    "/maps": els.viewMaps,
    "/glossary": els.viewGlossary,
    "/references": els.viewReferences,
  };

  fetch("data/problems.json")
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      DATA.parameters.forEach((p) => state.params.add(p.id));
      buildFacets();
      buildParamToggle();
      buildLegend();
      updateBannerCount();
      renderMatrix();
      window.addEventListener("hashchange", route);
      route();
    })
    .catch((err) => {
      els.matrixBody.innerHTML =
        '<tr><td style="padding:1rem;color:#c92a2a">Failed to load data/problems.json: ' +
        String(err) + "</td></tr>";
    });

  // ---------- routing ----------

  function currentPath() {
    const h = location.hash.replace(/^#/, "");
    return h || "/";
  }

  function route() {
    const path = currentPath();
    Object.values(VIEWS).forEach((v) => (v.hidden = true));
    els.viewProblem.hidden = true;
    els.viewMap.hidden = true;

    let matched = null;
    const problemMatch = /^\/problem\/(.+)$/.exec(path);
    const mapMatch = /^\/map\/(.+)$/.exec(path);

    if (problemMatch) {
      renderProblemPage(decodeURIComponent(problemMatch[1]));
      els.viewProblem.hidden = false;
      matched = null; // no top-level nav item highlighted
    } else if (mapMatch) {
      renderMap(decodeURIComponent(mapMatch[1]));
      els.viewMap.hidden = false;
      matched = "/maps";
    } else if (VIEWS[path]) {
      VIEWS[path].hidden = false;
      if (path === "/glossary") renderGlossary();
      if (path === "/references") renderReferences();
      if (path === "/maps") renderMapsIndex();
      matched = path;
    } else {
      els.viewSearch.hidden = false;
      matched = "/";
    }

    els.navLinks.forEach((a) => {
      a.classList.toggle("active", a.dataset.route === matched);
    });

    closeDetail();
    window.scrollTo(0, 0);
  }

  function classById(id) {
    return DATA.complexityClasses.find((c) => c.id === id);
  }
  function paramById(id) {
    return DATA.parameters.find((p) => p.id === id);
  }
  // Inline style for a complexityClasses pill/badge, respecting its fill
  // flag: FPT/XP/para-NP-hard are solid; W[1]/W[2]-hard/open are outline
  // only, so "hard but not fully resolved" reads differently at a glance
  // from "resolved, one way or the other."
  // The site has no manual theme toggle, only prefers-color-scheme, so this
  // is safe to detect once. Kept in sync by hand with --panel-bg in style.css.
  const PANEL_BG_HEX = { light: "#f8f9fa", dark: "#1d1e22" };
  function currentPanelBgHex() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? PANEL_BG_HEX.dark
      : PANEL_BG_HEX.light;
  }
  function hexToRgbTuple(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
  }
  // A "fake" translucency: blend the class color with the actual panel
  // background into one opaque RGB, rather than using real alpha, which
  // would let SVG lines behind the node show through it.
  function mixWithPanelBg(hex, alpha) {
    const [r1, g1, b1] = hexToRgbTuple(hex);
    const [r2, g2, b2] = hexToRgbTuple(currentPanelBgHex());
    const mix = (a, b) => Math.round(a * alpha + b * (1 - alpha));
    return "rgb(" + mix(r1, r2) + "," + mix(g1, g2) + "," + mix(b1, b2) + ")";
  }
  function classPillStyle(cls) {
    if (!cls) return "background:#868e96;color:#fff;border:2px solid #868e96";
    const border = "2px " + (cls.border || "solid") + " " + cls.color;
    // opacity (e.g. XP) fades only the fill, not the border/text -- signals
    // "positive result that doesn't rule out hardness," not "unfilled/open".
    if (cls.opacity) return "background:" + mixWithPanelBg(cls.color, cls.opacity) + ";color:#111;border:" + border;
    return cls.fill
      ? "background:" + cls.color + ";color:#111;border:" + border
      : "background:transparent;color:" + cls.color + ";border:" + border;
  }
  function problemById(id) {
    return DATA.problems.find((p) => p.id === id);
  }
  function classicalClassById(id) {
    return DATA.classicalClasses.find((c) => c.id === id);
  }
  function mapById(id) {
    return DATA.maps.find((m) => m.id === id);
  }
  function refText(key) {
    const r = DATA.references[key];
    return r ? r.text : key;
  }
  function citeLinks(keys) {
    if (!keys || !keys.length) return "";
    return keys
      .map((k) => '<a class="cite-link" href="#/references">[' + k + "]</a>")
      .join(" ");
  }

  const CONFIDENCE_LABELS = {
    verified: "Verified — cites a known published result.",
    inferred: "Inferred — a careful reading of the source's construction/proof, not an explicitly stated theorem there. Treat as a plausible but unverified claim.",
    illustrative: "Illustrative — placeholder standing in for a real result; verify before relying on it.",
  };
  function confidenceLabel(confidence) {
    return CONFIDENCE_LABELS[confidence] || confidence;
  }

  // ---------- search / matrix view ----------

  function buildFacets() {
    const alphas = uniq(DATA.problems.map((p) => p.alpha));
    const gammas = uniq(DATA.problems.map((p) => p.gamma));
    const betas = uniq(
      DATA.problems.flatMap((p) => (p.beta.length ? p.beta : [EMPTY_BETA_TOKEN]))
    );

    renderChipRow(els.alphaRow, alphas, state.alpha, renderMatrix);
    renderChipRow(els.betaRow, betas, state.beta, renderMatrix);
    renderChipRow(els.gammaRow, gammas, state.gamma, renderMatrix);
  }

  function uniq(arr) {
    return Array.from(new Set(arr)).sort();
  }

  function renderChipRow(container, values, activeSet, onChange) {
    container.innerHTML = "";
    values.forEach((v) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = v;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (activeSet.has(v)) {
          activeSet.delete(v);
          chip.classList.remove("active");
          chip.setAttribute("aria-pressed", "false");
        } else {
          activeSet.add(v);
          chip.classList.add("active");
          chip.setAttribute("aria-pressed", "true");
        }
        onChange();
      });
      container.appendChild(chip);
    });
  }

  function buildParamToggle() {
    els.paramToggle.innerHTML = "";
    DATA.parameters.forEach((p) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip active";
      chip.textContent = p.symbol;
      chip.title = p.name;
      chip.setAttribute("aria-pressed", "true");
      chip.addEventListener("click", () => {
        if (state.params.has(p.id)) {
          state.params.delete(p.id);
          chip.classList.remove("active");
          chip.setAttribute("aria-pressed", "false");
        } else {
          state.params.add(p.id);
          chip.classList.add("active");
          chip.setAttribute("aria-pressed", "true");
        }
        renderMatrix();
      });
      els.paramToggle.appendChild(chip);
    });
  }

  function buildLegend() {
    els.legendItems.innerHTML = "";
    DATA.complexityClasses
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((c) => {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML =
          '<span class="legend-swatch" style="background:' + c.color + '"></span>' +
          "<span>" + c.label + "</span>";
        item.title = c.description;
        els.legendItems.appendChild(item);
      });
  }

  function updateBannerCount() {
    let notVerified = 0, total = 0;
    DATA.problems.forEach((p) =>
      p.results.forEach((r) => {
        total++;
        if (r.confidence !== "verified") notVerified++;
      })
    );
    els.bannerCount.textContent = notVerified + " of " + total + " result cells";
  }

  els.resetBtn.addEventListener("click", () => {
    state.alpha.clear();
    state.beta.clear();
    state.gamma.clear();
    document.querySelectorAll(".chip-row .chip.active").forEach((c) => {
      if (c.parentElement !== els.paramToggle) {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      }
    });
    renderMatrix();
  });

  function filteredProblems() {
    return DATA.problems.filter((p) => {
      if (state.alpha.size && !state.alpha.has(p.alpha)) return false;
      if (state.gamma.size && !state.gamma.has(p.gamma)) return false;
      if (state.beta.size) {
        const tokens = p.beta.length ? p.beta : [EMPTY_BETA_TOKEN];
        const hit = tokens.some((t) => state.beta.has(t));
        if (!hit) return false;
      }
      return true;
    });
  }

  function activeParamsForProblems(problems) {
    const used = new Set();
    problems.forEach((p) => p.results.forEach((r) => used.add(r.parameter)));
    return DATA.parameters.filter((p) => state.params.has(p.id) && used.has(p.id));
  }

  function renderMatrix() {
    const problems = filteredProblems();
    const params = activeParamsForProblems(problems);

    els.emptyState.hidden = problems.length > 0;
    els.matrixHead.innerHTML = "";
    els.matrixBody.innerHTML = "";

    if (!problems.length) return;

    const thProblem = document.createElement("th");
    thProblem.className = "problem-col";
    thProblem.textContent = "Problem (α|β|γ)";
    els.matrixHead.appendChild(thProblem);

    params.forEach((p) => {
      const th = document.createElement("th");
      th.textContent = p.symbol;
      th.title = p.name;
      els.matrixHead.appendChild(th);
    });

    if (!params.length) {
      const th = document.createElement("th");
      th.textContent = "(no parameters selected)";
      els.matrixHead.appendChild(th);
    }

    problems.forEach((p) => {
      const tr = document.createElement("tr");

      const tdProblem = document.createElement("td");
      tdProblem.className = "problem-cell";
      tdProblem.innerHTML =
        '<a class="notation" href="#/problem/' + encodeURIComponent(p.id) + '">' + p.notation + "</a>" +
        '<div class="pname">' + p.name + "</div>" +
        '<div class="pname" style="margin-top:.3rem">' + p.classicalStatus + "</div>";
      tr.appendChild(tdProblem);

      params.forEach((param) => {
        const td = document.createElement("td");
        td.className = "result-cell";
        const result = p.results.find((r) => r.parameter === param.id);
        if (!result) {
          const span = document.createElement("div");
          span.className = "badge na";
          span.textContent = "—";
          td.appendChild(span);
        } else {
          const cls = classById(result.class);
          const btn = document.createElement("button");
          btn.className = "badge";
          btn.style.cssText = classPillStyle(cls);
          btn.innerHTML =
            (cls ? cls.label : result.class) +
            (result.confidence && result.confidence !== "verified"
              ? '<span class="conf-flag" title="' + escapeHtml(confidenceLabel(result.confidence)) + '">•</span>'
              : "");
          btn.addEventListener("click", () => openDetail(p, param, result, cls));
          td.appendChild(btn);
        }
        tr.appendChild(td);
      });

      if (!params.length) {
        const td = document.createElement("td");
        td.textContent = "";
        tr.appendChild(td);
      }

      els.matrixBody.appendChild(tr);
    });
  }

  function openDetail(problem, param, result, cls) {
    els.detailContent.innerHTML =
      '<h3>' + problem.notation + " — parameterized by " + param.symbol + "</h3>" +
      '<div class="detail-class-badge" style="' + classPillStyle(cls) + '">' +
      (cls ? cls.label : result.class) + "</div>" +
      detailField("Problem", problem.name) +
      detailField("Parameter", param.name) +
      detailField("Classical (unparameterized) status", problem.classicalStatus) +
      detailField("Result", cls ? cls.description : "") +
      detailField("Note", result.note || "") +
      detailFieldHtml("Reference", citeLinks(result.referenceKeys) || "—") +
      detailField("Confidence", confidenceLabel(result.confidence)) +
      '<p style="margin-top:1rem"><a class="wiki-back" href="#/problem/' + encodeURIComponent(problem.id) + '">View full problem page →</a></p>';
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    setPanelMinWidth(0);
  }

  function detailField(label, value) {
    if (!value) return "";
    return '<div class="detail-field"><h4>' + label + "</h4><p>" + escapeHtml(value) + "</p></div>";
  }
  function detailFieldHtml(label, html) {
    return '<div class="detail-field"><h4>' + label + "</h4><p>" + html + "</p></div>";
  }

  // Shared between the problem wiki page and the map's side panel.
  function buildResultsListHtml(effectiveResults) {
    if (!effectiveResults.length) {
      return '<p style="color:var(--muted)">No parameterized results recorded for this problem yet.</p>';
    }
    return (
      '<ul class="result-list">' +
      effectiveResults
        .map((r) => {
          const param = paramById(r.parameter);
          const cls = classById(r.class);
          return (
            '<li class="result-row">' +
            '<div class="param-name">' + (param ? param.symbol : r.parameter) +
            '<span class="sym">' + (param ? param.name : "") + "</span></div>" +
            '<div class="result-body"><p>' + (r.note || "") + "</p>" +
            "<p>" + citeLinks(r.referenceKeys) +
            (r.confidence ? ' <span class="conf-dot ' + escapeHtml(r.confidence) + '" title="' +
              escapeHtml(confidenceLabel(r.confidence)) + '"></span> <em style="color:var(--muted);font-size:0.8em">' +
              escapeHtml(r.confidence) + "</em>" : "") +
            "</p></div>" +
            '<span class="class-pill" style="' + classPillStyle(cls) + '">' +
            (cls ? cls.label : r.class) + "</span>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function buildClassicalBadgeHtml(problem) {
    const cc = classicalClassById(effectiveClassForProblem(problem.id));
    if (!cc) return "";
    return (
      '<span class="class-pill" style="background:' +
      (cc.fill ? cc.color : "var(--panel-bg)") +
      ";border:2px " + (cc.border || "solid") + " " + cc.color + ";color:" + (cc.fill ? "#111" : "var(--fg)") +
      '">' + cc.label + "</span> "
    );
  }

  // Opens the shared side panel for a problem (used by the problem maps so
  // clicking a node reviews its parameterized results without leaving the
  // map). Distinct from openDetail(), which is scoped to a single
  // parameter's result from the search matrix.
  function openProblemPanel(problemId) {
    const p = problemById(problemId);
    if (!p) return;
    const tree = buildParameterTreeHtml(p.id);
    els.detailContent.innerHTML =
      "<h3>" + p.notation + "</h3>" +
      '<p class="wiki-alphabetagamma" style="margin-top:-0.5rem">' + escapeHtml(p.name) + "</p>" +
      '<div class="wiki-status" style="margin-bottom:1.25rem"><b>Classical (unparameterized) status</b>' +
      buildClassicalBadgeHtml(p) + escapeHtml(p.classicalStatus) + "</div>" +
      (p.overview ? detailField("Overview", p.overview) : "") +
      '<div class="detail-field"><h4>Parameter hierarchy</h4>' + tree.html + "</div>" +
      '<div class="detail-field"><h4>Parameterized results</h4>' + buildResultsListHtml(effectiveResultsForProblem(p.id)) + "</div>" +
      '<p style="margin-top:1rem"><a class="wiki-back" href="#/problem/' + encodeURIComponent(p.id) + '">View full problem page →</a></p>';
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    setPanelMinWidth(tree.width);
    enableParamTreeDragging(els.detailContent.querySelector(".param-tree-wrap"));
  }

  // Widens the shared side panel (via the --content-min-width custom
  // property, see style.css) just enough that a wide diagram inside it
  // never needs its own horizontal scrollbar; resets to the default
  // 420px-ish width for panels with no such content (e.g. openDetail()'s
  // single-result view from the search matrix).
  function setPanelMinWidth(contentWidth) {
    // .detail-panel padding (1.5rem*2=48px) + .param-tree-wrap's own padding
    // (0.5rem*2=16px) + its 1px border on each side, so the SVG never
    // needs its own horizontal scrollbar inside the widened panel.
    const PANEL_PADDING = 48 + 16 + 4;
    els.detailPanel.style.setProperty("--content-min-width", contentWidth ? contentWidth + PANEL_PADDING + "px" : "0px");
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function closeDetail() {
    els.detailPanel.hidden = true;
    els.detailOverlay.hidden = true;
  }
  els.detailClose.addEventListener("click", closeDetail);
  els.detailOverlay.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });

  // ---------- problem wiki page ----------

  function renderProblemPage(id) {
    const p = problemById(id);
    if (!p) {
      els.viewProblem.innerHTML =
        '<div class="wiki-page"><a class="wiki-back" href="#/">&larr; Back to search</a><p>Unknown problem: ' +
        escapeHtml(id) + "</p></div>";
      return;
    }

    const resultsHtml = buildResultsListHtml(effectiveResultsForProblem(p.id));

    const relatedHtml = (p.related || []).length
      ? '<div class="related-links">' +
        p.related
          .map((rid) => {
            const rp = problemById(rid);
            return rp
              ? '<a href="#/problem/' + encodeURIComponent(rp.id) + '">' + rp.notation + "</a>"
              : "";
          })
          .join("") +
        "</div>"
      : '<p style="color:var(--muted)">No related problems recorded.</p>';

    const ccBadge = buildClassicalBadgeHtml(p);

    els.viewProblem.innerHTML =
      '<div class="wiki-page">' +
      '<a class="wiki-back" href="#/">&larr; Back to search</a>' +
      "<h2>" + p.notation + "</h2>" +
      '<p class="wiki-alphabetagamma">' + p.name + "</p>" +
      '<div class="wiki-status"><b>Classical (unparameterized) status</b>' + ccBadge + escapeHtml(p.classicalStatus) + "</div>" +
      '<div class="wiki-section wiki-overview"><h3>Overview</h3><p>' + escapeHtml(p.overview || "") + "</p></div>" +
      '<div class="wiki-section"><h3>Parameterized results</h3>' + resultsHtml + "</div>" +
      '<div class="wiki-section"><h3>Related problems</h3>' + relatedHtml + "</div>" +
      "</div>";
  }

  // ---------- glossary ----------

  function renderGlossary() {
    els.viewGlossary.innerHTML =
      '<h2 class="page-title">Glossary</h2><div class="glossary-list">' +
      '<div class="glossary-item"><h3>Complexity classes</h3></div>' +
      DATA.complexityClasses
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(
          (c) =>
            '<div class="glossary-item"><h3>' + c.label + "</h3><p>" + escapeHtml(c.description) + "</p></div>"
        )
        .join("") +
      '<div class="glossary-item"><h3>Parameters</h3></div>' +
      DATA.parameters
        .map(
          (p) =>
            '<div class="glossary-item"><h3>' + p.name + ' <span class="sym">(' + p.symbol + ")</span></h3><p>" +
            escapeHtml(p.gloss || "") +
            "</p></div>"
        )
        .join("") +
      "</div>";
  }

  // ---------- problem maps (generalization poset diagrams) ----------

  function renderMapsIndex() {
    els.viewMaps.innerHTML =
      '<h2 class="page-title">Problem maps</h2><div class="map-list">' +
      DATA.maps
        .map(
          (m) =>
            '<a class="map-card" href="#/map/' + encodeURIComponent(m.id) + '">' +
            "<h3>" + escapeHtml(m.title) + "</h3><p>" + escapeHtml(m.description || "") + "</p></a>"
        )
        .join("") +
      "</div>";
  }

  const MAP_COL_W = 210, MAP_ROW_H = 130, MAP_MARGIN = 50;
  const MAP_NODE_W_DEFAULT = 140, MAP_NODE_H_DEFAULT = 40, MAP_COL_STAGGER_DEFAULT = 60;
  const MAP_EDGE_COLOR = "#868e96";

  function axisById(id) {
    return (DATA.axes || []).find((a) => a.id === id);
  }

  // A map edge means "from generalizes to" (to is a special case of from).
  // A problem with no direct classicalClass citation ("unclaimed") inherits
  // the strongest hardness known among the special cases it generalizes:
  // strongly-NP-hard carries up as-is; weakly-NP-hard or NP-hard-unresolved
  // carry up as NP-hard-unresolved (we can't assume the general problem also
  // has a pseudo-polynomial algorithm just because a special case does).
  // Polynomial-time results do NOT carry upward — a tractable special case
  // says nothing about the general problem.
  function inheritedContribution(effectiveId) {
    if (effectiveId === "strongly-NP-hard") return "strongly-NP-hard";
    if (effectiveId === "NP-hard-unresolved" || effectiveId === "weakly-NP-hard") return "NP-hard-unresolved";
    return null;
  }
  function strongerOf(a, b) {
    const rank = { "strongly-NP-hard": 2, "NP-hard-unresolved": 1 };
    if (!a) return b;
    if (!b) return a;
    return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
  }

  // ---------- restriction engine (computed generalization) ----------
  // A problem opts into this system by having a `restrictions` object
  // (possibly {} for the mega problem itself, which restricts nothing).
  // Maps whose nodes don't have it (the JIT flow-shop map, still on the
  // older hand-authored-edges model) fall through to map.edges unchanged.
  const RESTRICTION_DIMENSIONS = ["machines", "releaseTimes", "processingTimes", "dueDates", "weights", "window", "slack"];

  function mapUsesRestrictions(map) {
    return map.nodes.every((n) => {
      const p = problemById(n.problemId);
      return p && p.restrictions !== undefined;
    });
  }

  function restrictionOf(problemId, dim) {
    const p = problemById(problemId);
    return (p && p.restrictions && p.restrictions[dim]) || { family: "free" };
  }

  // -1: ra stricter than rb, 0: equal, 1: ra more general than rb, null: incomparable.
  function compareRestriction(ra, rb) {
    if (ra.family === "free") return rb.family === "free" ? 0 : 1;
    if (rb.family === "free") return -1;
    if (ra.family !== rb.family) return null;
    if (ra.family === "value") return ra.equals === rb.equals ? 0 : null;
    const ca = ra.k !== undefined ? ra.k : ra.c;
    const cb = rb.k !== undefined ? rb.k : rb.c;
    if (ca === "param" && cb === "param") return 0;
    if (ca === "param") return 1;
    if (cb === "param") return -1;
    return ca === cb ? 0 : ca > cb ? 1 : -1;
  }

  // Does problem A generalize problem B? (A's restrictions are >= B's on
  // every dimension, strictly greater on at least one.) This REPLACES
  // hand-authored map.edges for any map where every node declares
  // `restrictions` — no {from,to} pair to get backwards, ever.
  function generalizesRestrictions(idA, idB) {
    if (idA === idB) return false;
    let strict = false;
    for (const dim of RESTRICTION_DIMENSIONS) {
      const cmp = compareRestriction(restrictionOf(idA, dim), restrictionOf(idB, dim));
      if (cmp === null || cmp < 0) return false;
      if (cmp > 0) strict = true;
    }
    return strict;
  }

  // Full pairwise generalizes() relation, reduced to its Hasse diagram
  // (drop any edge implied by a longer path through a third node in the
  // same map) so the rendered graph shows only direct/covering relations.
  const _mapEdgesCache = new Map();
  function computedMapEdges(map) {
    if (_mapEdgesCache.has(map.id)) return _mapEdgesCache.get(map.id);
    const ids = map.nodes.map((n) => n.problemId);
    const full = [];
    ids.forEach((a) => ids.forEach((b) => { if (generalizesRestrictions(a, b)) full.push([a, b]); }));
    const redundant = (a, b) => ids.some((c) => c !== a && c !== b && generalizesRestrictions(a, c) && generalizesRestrictions(c, b));
    const hasse = full.filter(([a, b]) => !redundant(a, b)).map(([from, to]) => ({ from, to, axis: differingDimension(from, to) }));
    _mapEdgesCache.set(map.id, hasse);
    return hasse;
  }

  function differingDimension(idA, idB) {
    const diffs = RESTRICTION_DIMENSIONS.filter((dim) => compareRestriction(restrictionOf(idA, dim), restrictionOf(idB, dim)) !== 0);
    return diffs.join("+") || null;
  }

  function mapEdges(map) {
    return mapUsesRestrictions(map) ? computedMapEdges(map) : map.edges;
  }

  // A parameter is only meaningful for a problem if every dimension it
  // measures is NOT already pinned by that problem's restrictions:
  // "cardinality"-kind measures (e.g. #p) are trivial once that dimension
  // is fixed to a single value OR a fixed cardinality (uniform); "magnitude"
  // -kind measures (e.g. p_max) are trivial only once the dimension is
  // pinned to one exact value (a fixed cardinality like "uniform" still
  // leaves the shared value free to vary, so p_max stays meaningful there).
  function isParamRelevantForProblem(param, problemId) {
    const p = problemById(problemId);
    if (!p || p.restrictions === undefined) return true; // no restriction data -> can't rule it out
    const dims = param.dimensions || [];
    // A parameter with no declared dimension isn't part of THIS problem's
    // dimension model at all (e.g. tw(prec)/vc(prec)/#speeds belong to
    // other problem families entirely) -- exclude rather than guess.
    if (!dims.length) return false;
    return dims.every(({ dimension, measureKind }) => {
      const r = restrictionOf(problemId, dimension);
      if (r.family === "value") return false;
      if (measureKind === "cardinality" && r.family === "cardinality" && r.k !== "param") return false;
      // boundedValue/ratioBound (e.g. slack<=sigma, window<=lambda*p): unlike
      // cardinality vs magnitude on processingTimes, there's only one thing
      // to measure here, so a fixed constant excludes the parameter outright
      // regardless of measureKind -- fixing sigma=2 leaves nothing left to
      // parameterize by.
      if ((r.family === "boundedValue" || r.family === "ratioBound") && r.c !== "param") return false;
      return true;
    });
  }

  function relevantParametersForProblem(problemId) {
    return DATA.parameters.filter((param) => isParamRelevantForProblem(param, problemId));
  }

  function computeEffectiveClasses(map) {
    const edges = mapEdges(map);
    const effective = {};
    const visiting = new Set();
    function resolve(problemId) {
      if (effective[problemId] !== undefined) return effective[problemId];
      const p = problemById(problemId);
      let result = p ? p.classicalClass : null;
      if ((!result || result === "unclaimed") && !visiting.has(problemId)) {
        visiting.add(problemId);
        let best = null;
        edges.forEach((e) => {
          if (e.from === problemId) {
            best = strongerOf(best, inheritedContribution(resolve(e.to)));
          }
        });
        visiting.delete(problemId);
        if (best) result = best;
      }
      effective[problemId] = result;
      return result;
    }
    map.nodes.forEach((n) => resolve(n.problemId));
    return effective;
  }

  function findMapForProblem(problemId) {
    return (DATA.maps || []).find((m) => m.nodes.some((n) => n.problemId === problemId));
  }

  // Used by both the map view and the problem wiki page, so a problem's
  // displayed status is consistent everywhere: if it has no direct citation
  // but strictly generalizes a known-hard problem, it shows that inherited
  // hardness rather than a flat "no direct claim".
  function effectiveClassForProblem(problemId) {
    const map = findMapForProblem(problemId);
    if (!map) {
      const p = problemById(problemId);
      return p ? p.classicalClass : null;
    }
    return computeEffectiveClasses(map)[problemId];
  }

  // Same generalization principle as computeEffectiveClasses, applied to
  // parameterized results[] instead of classicalClass: a W[1]/W[2]/para-NP-hard
  // result for a given parameter on a specific problem is automatically also
  // evidence for every problem that generalizes it, for that same parameter
  // (the specific problem's hard instances are valid instances of the general
  // one too). FPT/XP/P results do not transfer upward — a tractable special
  // case says nothing about the general problem. A direct citation on the
  // problem itself always takes priority over an inherited one.
  function resultHardnessRank(classId) {
    return { W1: 1, W2: 2, paraNP: 3 }[classId] || 0;
  }

  function computeEffectiveResults(map) {
    const edges = mapEdges(map);
    const effective = {};
    const visiting = new Set();
    function resolve(problemId) {
      if (effective[problemId]) return effective[problemId];
      const p = problemById(problemId);
      const merged = {};
      (p ? p.results : []).forEach((r) => {
        merged[r.parameter] = Object.assign({ inherited: false }, r);
      });
      if (!visiting.has(problemId)) {
        visiting.add(problemId);
        edges.forEach((e) => {
          if (e.from !== problemId) return;
          const childResults = resolve(e.to);
          Object.keys(childResults).forEach((paramId) => {
            if (merged[paramId]) return; // a direct citation always wins
            const child = childResults[paramId];
            if (resultHardnessRank(child.class) === 0) return; // FPT/XP/P don't transfer upward
            const existing = merged[paramId];
            if (existing && resultHardnessRank(existing.class) >= resultHardnessRank(child.class)) return;
            const childProblem = problemById(e.to);
            const cls = classById(child.class);
            const note = child.inherited
              ? "Inherited (via " + (childProblem ? childProblem.notation : e.to) + "): " + (child.note || "")
              : "Inherited: generalizes " + (childProblem ? childProblem.notation : e.to) +
                ", which is " + (cls ? cls.label : child.class) + " for this parameter." +
                (child.note ? " (" + child.note + ")" : "");
            merged[paramId] = {
              parameter: paramId,
              class: child.class,
              confidence: child.confidence,
              referenceKeys: child.referenceKeys,
              inherited: true,
              note: note,
            };
          });
        });
        visiting.delete(problemId);
      }
      effective[problemId] = merged;
      return merged;
    }
    map.nodes.forEach((n) => resolve(n.problemId));
    return effective;
  }

  function effectiveResultsForProblem(problemId) {
    const map = findMapForProblem(problemId);
    if (!map) {
      const p = problemById(problemId);
      return p ? p.results : [];
    }
    const merged = computeEffectiveResults(map)[problemId] || {};
    return Object.keys(merged).map((k) => merged[k]);
  }

  // ---------- parameter hierarchy ----------
  // Same "hardness flows from specific to general, FPT/XP don't" principle
  // as the problem maps, applied to parameters instead of problems. An edge
  // {from: A, to: B} means A ≤ f(B) — A is the weaker/more general
  // parameter, B is the stronger/more restrictive one (e.g. m ≤ m+p, so
  // m is general, m+p is specific). A problem's own direct/problem-
  // inherited result for a parameter always wins; only missing parameters
  // pull in hardness inherited from a more specific parameter's result on
  // that same problem.
  function paramHierarchyEdges() {
    return (DATA.parameterHierarchy && DATA.parameterHierarchy.edges) || [];
  }

  function effectiveParamResultsForProblem(problemId) {
    const direct = {};
    effectiveResultsForProblem(problemId).forEach((r) => { direct[r.parameter] = r; });
    const edges = paramHierarchyEdges();
    const resolved = {};
    const visiting = new Set();
    function resolve(paramId) {
      if (resolved[paramId] !== undefined) return resolved[paramId];
      let result = direct[paramId] || null;
      if (!visiting.has(paramId)) {
        visiting.add(paramId);
        let best = null;
        edges.forEach((e) => {
          if (e.from !== paramId) return;
          const childResult = resolve(e.to);
          if (!childResult || resultHardnessRank(childResult.class) === 0) return;
          if (!best || resultHardnessRank(childResult.class) > resultHardnessRank(best.class)) best = childResult;
        });
        visiting.delete(paramId);
        if (best && (!result || resultHardnessRank(best.class) > resultHardnessRank(result.class))) {
          result = Object.assign({}, best, { parameter: paramId, inherited: true });
        }
      }
      resolved[paramId] = result;
      return result;
    }
    const allIds = new Set(Object.keys(direct));
    edges.forEach((e) => { allIds.add(e.from); allIds.add(e.to); });
    allIds.forEach(resolve);
    return resolved;
  }

  // All parameters used by any problem in the same map as `problemId` —
  // gives a stable tree per map, recolored per clicked problem.
  function mapRelevantParameters(problemId) {
    const map = findMapForProblem(problemId);
    const ids = new Set();
    if (map) {
      map.nodes.forEach((n) => {
        const p = problemById(n.problemId);
        (p ? p.results : []).forEach((r) => ids.add(r.parameter));
      });
    } else {
      const p = problemById(problemId);
      (p ? p.results : []).forEach((r) => ids.add(r.parameter));
    }
    return ids;
  }

  // Layout is deliberately compact (small col/row units) so the mega
  // problem's 7 relevant parameters fit inside the side panel's content
  // width (~356px after padding) without horizontal scrolling. All
  // columns are >=1 — a column below 1 goes negative and renders off
  //-canvas, the same mistake made once already on the main map.
  // Rows follow the same convention as the problem maps: above = smaller/
  // more general parameter, below = larger/more restrictive one, matching
  // parameterHierarchy's edges exactly (row(from) < row(to) for every
  // edge -- e.g. numP (row0) is strictly above pmax (row1), since
  // numP <= pmax always, and m_plus_p (row2) sits below BOTH of its
  // parents m (row0) and pmax (row1).
  const PARAM_TREE_LAYOUT = {
    m:             { col: 1,   row: 0 },
    numDD:         { col: 2,   row: 0 },
    numR:          { col: 3,   row: 0 },
    numW:          { col: 4,   row: 0 },
    numP:          { col: 5,   row: 0 },
    numSpeed:      { col: 6,   row: 0 },
    tw:            { col: 7,   row: 0 },
    vc:            { col: 8,   row: 0 },
    sigma_plus_m:  { col: 1,   row: 1 },
    numDD_numW:    { col: 2.7, row: 1 },
    numDD_numP:    { col: 3.8, row: 1 },
    numP_numW:     { col: 4.9, row: 1 },
    pmax:          { col: 6.2, row: 1 },
    m_plus_p:      { col: 3.5, row: 2 },
  };
  const PARAM_TREE_NODE_W = 68, PARAM_TREE_NODE_H = 30, PARAM_TREE_COL_W = 76, PARAM_TREE_ROW_H = 54, PARAM_TREE_MARGIN = 8;

  // Prefers the computed per-problem relevance (which dimensions this exact
  // problem leaves free) over the older map-wide union, whenever the
  // problem's map has opted into the restrictions system. This is the
  // fix for parameters like #r or m showing up on a problem that fixes
  // machines=1 and has no release times at all — they're not "unstudied
  // here," they're structurally undefined here.
  function relevantParamIdsForTree(problemId) {
    const map = findMapForProblem(problemId);
    if (map && mapUsesRestrictions(map)) {
      return new Set(relevantParametersForProblem(problemId).map((p) => p.id));
    }
    return mapRelevantParameters(problemId);
  }

  function buildParameterTreeHtml(problemId) {
    const relevant = relevantParamIdsForTree(problemId);
    const edges = paramHierarchyEdges().filter((e) => relevant.has(e.from) || relevant.has(e.to));
    edges.forEach((e) => { relevant.add(e.from); relevant.add(e.to); });
    // Hierarchy-adjacency can pull in a neighbor for context (fine when it's
    // merely "not cited here yet"), but it must never override a parameter
    // being structurally inapplicable (a dimension it needs is pinned) --
    // that's a hard exclusion, checked again after the expansion above.
    const map = findMapForProblem(problemId);
    if (map && mapUsesRestrictions(map)) {
      Array.from(relevant).forEach((id) => {
        const param = paramById(id);
        if (param && !isParamRelevantForProblem(param, problemId)) relevant.delete(id);
      });
    }
    if (!relevant.size) return { html: "", width: 0 };

    const effective = effectiveParamResultsForProblem(problemId);
    const nodeIds = Array.from(relevant).filter((id) => PARAM_TREE_LAYOUT[id]);
    if (!nodeIds.length) return { html: "", width: 0 };

    const pos = {};
    let maxCol = 0, maxRow = 0;
    nodeIds.forEach((id) => {
      const l = PARAM_TREE_LAYOUT[id];
      pos[id] = { left: PARAM_TREE_MARGIN + (l.col - 1) * PARAM_TREE_COL_W, top: PARAM_TREE_MARGIN + l.row * PARAM_TREE_ROW_H };
      maxCol = Math.max(maxCol, l.col);
      maxRow = Math.max(maxRow, l.row);
    });
    const width = PARAM_TREE_MARGIN * 2 + (maxCol - 1) * PARAM_TREE_COL_W + PARAM_TREE_NODE_W;
    const height = PARAM_TREE_MARGIN * 2 + maxRow * PARAM_TREE_ROW_H + PARAM_TREE_NODE_H;

    const arrowId = "param-tree-arrow";
    const defs =
      '<defs><marker id="' + arrowId + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="' + MAP_EDGE_COLOR + '" /></marker></defs>';

    const linesSvg = edges
      .map((e) => {
        if (!pos[e.from] || !pos[e.to]) return "";
        return '<line data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="1.25" marker-end="url(#' + arrowId + ')" />';
      })
      .join("");

    const nodesSvg = nodeIds
      .map((id) => {
        const param = paramById(id);
        const p = pos[id];
        const r = effective[id];
        const cls = r ? classById(r.class) : null;
        // Fill with the panel's own background (not "transparent") so the
        // connecting lines never show through an uncolored/unfilled node —
        // same convention as the map's own "open"/"unclaimed" nodes.
        // cls.opacity (XP) fades the fill and dashes the border, marking
        // "positive result, doesn't rule out hardness" as visually distinct
        // from a settled FPT/W-hard/para-NP-hard classification.
        const bg = cls && cls.opacity ? mixWithPanelBg(cls.color, cls.opacity) : cls && cls.fill ? cls.color : "var(--panel-bg)";
        const border = cls ? cls.color : "#5c5f66";
        const dash = cls && cls.border === "dashed" ? ' stroke-dasharray="3,2"' : "";
        const textColor = cls && (cls.fill || cls.opacity) ? "#111" : "var(--fg)";
        const title = (param ? param.name : id) + (r ? " — " + (cls ? cls.label : r.class) + (r.inherited ? " (inherited)" : "") : " — no result recorded");
        return (
          '<g class="param-node" data-param="' + escapeHtml(id) + '" transform="translate(' + p.left + "," + p.top + ')">' +
          '<title>' + escapeHtml(title) + "</title>" +
          '<rect width="' + PARAM_TREE_NODE_W + '" height="' + PARAM_TREE_NODE_H +
          '" rx="5" style="fill:' + bg + ";stroke:" + border + '"' + dash + ' stroke-width="1.5" />' +
          '<text x="' + PARAM_TREE_NODE_W / 2 + '" y="' + (PARAM_TREE_NODE_H / 2 + 4) + '" text-anchor="middle" font-size="10.5" font-weight="600" style="fill:' + textColor + '">' +
          escapeHtml(param ? param.symbol : id) + "</text>" +
          "</g>"
        );
      })
      .join("");

    return {
      html:
        '<div class="param-tree-wrap"><svg class="param-tree-svg" width="' + width + '" height="' + height + '">' +
        defs + linesSvg + nodesSvg +
        "</svg></div>",
      width: width,
    };
  }

  // Positions each edge line from the current transform of its endpoint
  // nodes (rather than baking in coordinates at HTML-string build time),
  // and is called both once after inserting the tree and again on every
  // drag frame — the single source of truth for line placement.
  function layoutParamTreeEdges(svg) {
    svg.querySelectorAll("g.param-node").forEach((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform"));
      g.dataset.x = m[1];
      g.dataset.y = m[2];
    });
    svg.querySelectorAll("line[data-from]").forEach((line) => {
      const a = svg.querySelector('g.param-node[data-param="' + cssEscape(line.dataset.from) + '"]');
      const b = svg.querySelector('g.param-node[data-param="' + cssEscape(line.dataset.to) + '"]');
      if (!a || !b) return;
      const ax = parseFloat(a.dataset.x) + PARAM_TREE_NODE_W / 2, ay = parseFloat(a.dataset.y) + PARAM_TREE_NODE_H / 2;
      const bx = parseFloat(b.dataset.x) + PARAM_TREE_NODE_W / 2, by = parseFloat(b.dataset.y) + PARAM_TREE_NODE_H / 2;
      const tip = pullBackToRect(ax, ay, bx, by, PARAM_TREE_NODE_W / 2, PARAM_TREE_NODE_H / 2, 4);
      line.setAttribute("x1", ax);
      line.setAttribute("y1", ay);
      line.setAttribute("x2", tip.x);
      line.setAttribute("y2", tip.y);
    });
  }

  function enableParamTreeDragging(wrap) {
    const svg = wrap && wrap.querySelector(".param-tree-svg");
    if (!svg) return;
    layoutParamTreeEdges(svg);
    let drag = null;
    svg.querySelectorAll("g.param-node").forEach((g) => {
      g.style.cursor = "grab";
      g.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        drag = { g, startX: e.clientX, startY: e.clientY, x0: parseFloat(g.dataset.x), y0: parseFloat(g.dataset.y) };
      });
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const x = drag.x0 + (e.clientX - drag.startX), y = drag.y0 + (e.clientY - drag.startY);
      drag.g.setAttribute("transform", "translate(" + x + "," + y + ")");
      drag.g.dataset.x = x;
      drag.g.dataset.y = y;
      layoutParamTreeEdges(svg);
    });
    document.addEventListener("pointerup", () => { drag = null; });
  }

  function mapNodeCenter(node, nodeW, nodeH, colStagger) {
    const left = MAP_MARGIN + (node.col - 1) * MAP_COL_W;
    const top = MAP_MARGIN + node.row * MAP_ROW_H + (node.col - 1) * colStagger;
    return { left, top, cx: left + nodeW / 2, cy: top + nodeH / 2 };
  }

  function notationFontSize(notation) {
    if (notation.length > 20) return "0.56rem";
    if (notation.length > 13) return "0.64rem";
    return "0.74rem";
  }

  // Converts the handful of unicode symbols actually used in notation/label
  // strings into plain LaTeX source, and escapes LaTeX special characters.
  // Not a general-purpose converter — just enough for this site's own text.
  // \Sigma, \leq, \sigma etc. are math-mode-only commands in plain LaTeX --
  // emitting them bare in running text is exactly "Missing $ inserted."
  // Each gets its own self-contained $...$ instead of math-ifying the whole
  // label, so surrounding plain text (job/machine letters) stays upright.
  const LATEX_CHAR_MAP = {
    "Σ": "$\\Sigma$", "≤": "$\\leq$", "≥": "$\\geq$", "−": "-",
    "σ": "$\\sigma$", "λ": "$\\lambda$", "α": "$\\alpha$", "β": "$\\beta$", "γ": "$\\gamma$",
    "_": "\\_", "%": "\\%", "&": "\\&", "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}",
  };
  function latexEscapeText(s) {
    return String(s).replace(/[Σ≤≥−σλαβγ_%&#$^]/g, (c) => LATEX_CHAR_MAP[c] || c);
  }
  function tikzSanitizeId(id) {
    return "n" + String(id).replace(/[^a-zA-Z0-9]/g, "");
  }

  // Builds a self-contained tikzpicture reproducing the currently rendered
  // map: same node positions/colors/labels and same generalizes->specific
  // edges. TikZ auto-clips `--` connections to each named node's boundary,
  // so no manual arrow pullback is needed here (unlike the SVG renderer).
  function mapToTikzCode(map, positions, effective, nodeW, nodeH) {
    const SCALE = 42; // px per cm
    const usedColors = new Map();
    function colorName(hex) {
      const key = hex.replace("#", "").toUpperCase();
      if (!usedColors.has(key)) usedColors.set(key, "c" + key);
      return usedColors.get(key);
    }

    const nodeLines = map.nodes
      .map((n) => {
        const p = problemById(n.problemId);
        if (!p) return "";
        const pos = positions[n.problemId];
        const cc = classicalClassById(effective[n.problemId]);
        const borderName = colorName(cc ? cc.color : "868e96");
        const fillName = cc && cc.fill ? colorName(cc.color) : null;
        const x = (pos.cx / SCALE).toFixed(2), y = (-pos.cy / SCALE).toFixed(2);
        const style =
          "draw=" + borderName + (cc && cc.border === "dashed" ? ", dashed" : "") +
          (fillName ? ", fill=" + fillName : ", fill=white") +
          ", rounded corners=2pt, minimum width=" + (nodeW / SCALE).toFixed(2) + "cm" +
          ", minimum height=" + (nodeH / SCALE).toFixed(2) + "cm, align=center, font=\\scriptsize, text=black";
        return "\\node[" + style + "] (" + tikzSanitizeId(n.problemId) + ") at (" + x + "," + y + ") {" + latexEscapeText(p.notation) + "};";
      })
      .filter(Boolean);

    // Plain "->" with no >=... option: the default core-TikZ arrow tip,
    // which needs nothing beyond \usepackage{tikz} -- no arrows.meta, no
    // arrows library, nothing version-sensitive.
    const edgeLines = mapEdges(map).map(
      (e) => "\\draw[->, gray!70] (" + tikzSanitizeId(e.from) + ") -- (" + tikzSanitizeId(e.to) + ");"
    );

    const colorDefs = Array.from(usedColors.entries()).map(
      ([hex, name]) => "\\definecolor{" + name + "}{HTML}{" + hex + "}"
    );

    return (
      "% " + map.title + " -- exported from The Parameterized Scheduling Zoo\n" +
      "% Requires only: \\usepackage{tikz} -- no extra tikz libraries.\n" +
      "\\begin{tikzpicture}\n" +
      colorDefs.map((l) => "  " + l).join("\n") + "\n" +
      nodeLines.map((l) => "  " + l).join("\n") + "\n" +
      edgeLines.map((l) => "  " + l).join("\n") + "\n" +
      "\\end{tikzpicture}\n"
    );
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function renderMap(id) {
    const map = mapById(id);
    if (!map) {
      els.viewMap.innerHTML =
        '<div class="map-page"><a class="wiki-back" href="#/maps">&larr; Back to problem maps</a><p>Unknown map: ' +
        escapeHtml(id) + "</p></div>";
      return;
    }

    const nodeW = map.nodeW || MAP_NODE_W_DEFAULT;
    const nodeH = map.nodeH || MAP_NODE_H_DEFAULT;
    const colStagger = map.colStagger != null ? map.colStagger : MAP_COL_STAGGER_DEFAULT;

    const positions = {};
    let maxCol = 0, maxRow = 0;
    map.nodes.forEach((n) => {
      positions[n.problemId] = mapNodeCenter(n, nodeW, nodeH, colStagger);
      maxCol = Math.max(maxCol, n.col);
      maxRow = Math.max(maxRow, n.row);
    });
    const width = MAP_MARGIN * 2 + (maxCol - 1) * MAP_COL_W + nodeW;
    const height = MAP_MARGIN * 2 + maxRow * MAP_ROW_H + (maxCol - 1) * colStagger + nodeH;

    const effective = computeEffectiveClasses(map);

    const arrowDef =
      '<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="' + MAP_EDGE_COLOR + '" /></marker></defs>';

    const linesSvg = mapEdges(map)
      .map((e) => {
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return "";
        const axis = axisById(e.axis) || (e.axis ? { label: e.axis } : null);
        const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, nodeW / 2, nodeH / 2, 5);
        return (
          '<line data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y +
          '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="1.5" marker-end="url(#map-arrow)">' +
          (axis ? "<title>" + escapeHtml(axis.label) + "</title>" : "") +
          "</line>"
        );
      })
      .join("");

    const nodesHtml = map.nodes
      .map((n) => {
        const p = problemById(n.problemId);
        if (!p) return "";
        const pos = positions[n.problemId];
        const cc = classicalClassById(effective[n.problemId]);
        const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
        const border = cc ? cc.color : "#868e96";
        const borderStyle = cc ? cc.border || "solid" : "solid";
        return (
          '<a class="map-node' + (cc && !cc.fill ? " outline" : "") + '" data-problem-id="' + escapeHtml(p.id) + '" title="' +
          escapeHtml(p.classicalStatus) + '" href="#/problem/' + encodeURIComponent(p.id) +
          '" style="left:' + pos.left + "px;top:" + pos.top + "px;width:" + nodeW +
          "px;height:" + nodeH + "px;background:" + bg + ";border-color:" + border +
          ";border-style:" + borderStyle + ";font-size:" + notationFontSize(p.notation) + '">' +
          escapeHtml(p.notation) + "</a>"
        );
      })
      .join("");

    const usedClasses = new Set(map.nodes.map((n) => effective[n.problemId]));
    const classLegendHtml = DATA.classicalClasses
      .filter((c) => usedClasses.has(c.id) && c.id !== "unclaimed")
      .map(
        (c) =>
          '<div class="legend-item"><span class="legend-swatch" style="background:' +
          (c.fill ? c.color : "transparent") + ";border:2px " + (c.border || "solid") + " " + c.color +
          '"></span><span>' + c.label + "</span></div>"
      )
      .join("");

    const excludedHtml = (map.excluded || []).length
      ? '<div class="map-excluded"><h3>Deliberately excluded</h3><ul>' +
        map.excluded.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
        "</ul></div>"
      : "";

    els.viewMap.innerHTML =
      '<div class="map-page">' +
      '<a class="wiki-back" href="#/maps">&larr; Back to problem maps</a>' +
      '<button type="button" class="tikz-export-btn" title="Copy this diagram as TikZ code">⧉ TikZ</button>' +
      '<div class="map-page-header"><h2>' + escapeHtml(map.title) + "</h2><p>" + escapeHtml(map.description || "") +
      '</p><p class="map-drag-hint">Drag any node to declutter overlapping edges — layout is per-session, not saved.</p></div>' +
      '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + width + "px;height:" + height + 'px">' +
      '<svg class="map-edge-svg" width="' + width + '" height="' + height + '">' + arrowDef + linesSvg + "</svg>" +
      nodesHtml +
      "</div></div>" +
      '<div class="map-legend">' + classLegendHtml + "</div>" +
      excludedHtml +
      "</div>";

    enableMapNodeDragging(els.viewMap.querySelector(".map-canvas"), nodeW, nodeH);

    const tikzBtn = els.viewMap.querySelector(".tikz-export-btn");
    tikzBtn.addEventListener("click", () => {
      const code = mapToTikzCode(map, positions, effective, nodeW, nodeH);
      const original = tikzBtn.textContent;
      copyTextToClipboard(code)
        .then(() => { tikzBtn.textContent = "Copied!"; })
        .catch(() => { tikzBtn.textContent = "Copy failed — see console"; console.log(code); })
        .then(() => setTimeout(() => { tikzBtn.textContent = original; }, 1800));
    });
  }

  // Drag is tracked at the document level once started, not on the node
  // element itself: a real mouse moving quickly outrun a small node's
  // bounds between events, and per-element listeners simply stop firing
  // once the cursor leaves them — which looks exactly like "dragging does
  // nothing." Document-level listeners don't have that problem.
  function enableMapNodeDragging(canvas, nodeW, nodeH) {
    if (!canvas) return;
    const svg = canvas.querySelector(".map-edge-svg");
    const halfW = nodeW / 2, halfH = nodeH / 2;
    let drag = null; // { el, id, startX, startY, left0, top0, moved }

    function updateEdgesFor(id, cx, cy) {
      svg.querySelectorAll('line[data-from="' + cssEscape(id) + '"]').forEach((line) => {
        line.setAttribute("x1", cx);
        line.setAttribute("y1", cy);
        const targetEl = canvas.querySelector('.map-node[data-problem-id="' + cssEscape(line.dataset.to) + '"]');
        if (!targetEl) return;
        const tcx = parseFloat(targetEl.style.left) + halfW, tcy = parseFloat(targetEl.style.top) + halfH;
        const tip = pullBackToRect(cx, cy, tcx, tcy, halfW, halfH, 5);
        line.setAttribute("x2", tip.x);
        line.setAttribute("y2", tip.y);
      });
      svg.querySelectorAll('line[data-to="' + cssEscape(id) + '"]').forEach((line) => {
        const x1 = parseFloat(line.getAttribute("x1")), y1 = parseFloat(line.getAttribute("y1"));
        const tip = pullBackToRect(x1, y1, cx, cy, halfW, halfH, 5);
        line.setAttribute("x2", tip.x);
        line.setAttribute("y2", tip.y);
      });
    }

    canvas.querySelectorAll(".map-node").forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        drag = {
          el,
          id: el.dataset.problemId,
          startX: e.clientX,
          startY: e.clientY,
          left0: parseFloat(el.style.left),
          top0: parseFloat(el.style.top),
          moved: false,
        };
      });
      // A click always opens the side panel in place instead of navigating
      // (a real page nav would be jarring while reviewing a map); dragging
      // suppresses this via drag.moved below.
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (drag && drag.moved) return;
        openProblemPanel(el.dataset.problemId);
      });
    });

    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const left = drag.left0 + dx, top = drag.top0 + dy;
      drag.el.style.left = left + "px";
      drag.el.style.top = top + "px";
      updateEdgesFor(drag.id, left + halfW, top + halfH);
    });

    document.addEventListener("pointerup", () => {
      // Cleared on the next tick, after the browser's own click event (which
      // fires right after pointerup) has had a chance to read drag.moved.
      setTimeout(() => { drag = null; }, 0);
    });
  }

  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  // Point along the a->b segment, pulled back from b by `dist`, so the
  // arrowhead lands just outside the target node's box instead of being
  // hidden underneath it.
  // Where a ray from (bx,by) toward (ax,ay) exits b's axis-aligned box
  // (half-width/half-height halfW/halfH), plus a small gap — the correct
  // rectangle-edge intersection, not a fixed-radius circle approximation.
  // A circle big enough to clear a wide-but-short box's corners overshoots
  // badly on near-vertical approaches, and one sized for the short side
  // undershoots (arrowhead lands under the box) on near-horizontal ones.
  function pullBackToRect(ax, ay, bx, by, halfW, halfH, gap) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tx = ux !== 0 ? halfW / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? halfH / Math.abs(uy) : Infinity;
    const t = Math.min(tx, ty, len - 1) + gap;
    return { x: bx - ux * t, y: by - uy * t };
  }

  // ---------- references ----------

  function renderReferences() {
    const keys = Object.keys(DATA.references).sort();
    els.viewReferences.innerHTML =
      '<h2 class="page-title">References</h2><div class="ref-list">' +
      keys
        .map(
          (k) =>
            '<div class="ref-item"><span class="ref-key">[' + k + ']</span><span>' +
            escapeHtml(DATA.references[k].text) + "</span></div>"
        )
        .join("") +
      "</div>";
  }
})();
