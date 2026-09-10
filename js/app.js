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
    viewSearch: document.getElementById("view-search"),
    viewProblem: document.getElementById("view-problem"),
    viewMaps: document.getElementById("view-maps"),
    viewMap: document.getElementById("view-map"),
    viewDesign: document.getElementById("view-design"),
    viewGlossary: document.getElementById("view-glossary"),
    viewDocs: document.getElementById("view-docs"),
    viewReferences: document.getElementById("view-references"),
    viewSchedulingZoo: document.getElementById("view-schedulingzoo"),
    navLinks: document.querySelectorAll(".site-nav a"),
  };

  const EMPTY_BETA_TOKEN = "∅";
  const VIEWS = {
    "/": els.viewSearch,
    "/maps": els.viewMaps,
    "/design": els.viewDesign,
    "/glossary": els.viewGlossary,
    "/docs": els.viewDocs,
    "/references": els.viewReferences,
    "/schedulingzoo": els.viewSchedulingZoo,
  };

  let DATA_SZ = null; // lazily fetched -- data/schedulingzoo.json, ~400KB, not needed unless visited
  let SZ_EFFECTIVE = null; // lazily computed once DATA_SZ is loaded -- see computeEffectiveClassesForSz
  let SZ_FOCUS_IDS = null; // Set of ids to restrict the overview to (declutter), or null for the full graph
  let SZ_LAST_FILTERS = null; // filter input values to restore across a declutter/reset re-render
  // The live settings dropdown for the CURRENT render, so filter-change
  // callbacks can refresh its counts without closing over a const that may
  // not be initialised yet (see updateSzFilterButtons).
  let szSettingsControl = null;
  let szValueDropdowns = null;
  // Ids dragged out of the diagram's frame and hidden from THIS view only --
  // separate from SZ_FOCUS_IDS (the search-driven declutter subset) so that
  // dropping one stray node doesn't also flip the whole graph into
  // declutter's enlarged 1.7x layout; a hidden id is simply subtracted from
  // whatever SZ_FOCUS_IDS/no-filter set is already showing. Never touches
  // DATA_SZ itself -- purely a rendering exclusion. SZ_HIDDEN_STACK records
  // the order ids were hidden in (for the Undo button); SZ_HIDDEN_REDO_STACK
  // holds ids popped off by Undo, ready for Redo. Hiding/undoing/redoing a
  // single id is done in place (toggling a CSS class on that one node + its
  // edges -- see setSzNodeHidden) rather than re-rendering the whole
  // diagram, so the rest of the layout never jumps around; a genuine full
  // re-render (declutter/reset/auto-arrange) bakes SZ_HIDDEN_IDS into the
  // fresh layout and clears both stacks, since "undo" a hide from a layout
  // that no longer exists wouldn't mean anything.
  let SZ_HIDDEN_IDS = new Set();
  let SZ_HIDDEN_STACK = [];
  let SZ_HIDDEN_REDO_STACK = [];
  // Same idea for the hand-curated problem maps, keyed per map id (a user
  // can hide different nodes on different maps without them fighting).
  // Never touches map.nodes/map.edges in data/problems.json.
  let MAP_HIDDEN_IDS = {};
  let MAP_HIDDEN_STACK = {};
  let MAP_HIDDEN_REDO_STACK = {};

  fetch("data/problems.json")
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      DATA.parameters.forEach((p) => state.params.add(p.id));
      buildFacets();
      buildParamToggle();
      buildLegend();
      renderMatrix();
      window.addEventListener("hashchange", route);
      window.addEventListener("resize", () => {
        if (!els.viewMap.hidden) fitMapCanvasToWidth(els.viewMap);
        if (!els.viewDesign.hidden) fitMapCanvasToWidth(els.viewDesign);
        if (!els.viewSchedulingZoo.hidden) fitMapCanvasToWidth(els.viewSchedulingZoo);
      });
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
      if (path === "/docs") renderDocs();
      if (path === "/references") renderReferences();
      if (path === "/maps") renderMapsIndex();
      if (path === "/design") renderDesign();
      if (path === "/schedulingzoo") renderSchedulingZoo();
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
  function fillTextColor(cls) {
    return "#111";
  }
  // `result` is optional: when a W1/W2 result also carries a cited XP
  // upper bound (xpBound), it's filled solid instead of outline-only --
  // otherwise it looks identical to a plain W-hardness claim with no
  // known n^f(k) algorithm highlighted, which loses real information.
  // Solid (not dashed/translucent like XP itself), since the hardness
  // question here is settled, unlike XP's "still open" status.
  function classPillStyle(cls, result) {
    if (!cls) return "background:#868e96;color:#fff;border:2px solid #868e96";
    const border = "2px " + (cls.border || "solid") + " " + cls.color;
    // opacity (e.g. XP) fades only the fill, not the border/text -- signals
    // "positive result that doesn't rule out hardness," not "unfilled/open".
    if (cls.opacity) return "background:" + mixWithPanelBg(cls.color, cls.opacity) + ";color:#111;border:" + border;
    const filled = cls.fill || (result && result.xpBound);
    return filled
      ? "background:" + cls.color + ";color:" + fillTextColor(cls) + ";border:" + border
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
  // The paper's own DOI (or arXiv URL, when it has no DOI) if we have one;
  // otherwise falls back to the References page anchor for that key.
  function refUrl(key) {
    const r = DATA.references[key];
    if (!r) return "#/references";
    if (r.doi) return "https://doi.org/" + r.doi;
    if (r.url) return r.url;
    return "#/references";
  }
  function citeLinks(keys) {
    if (!keys || !keys.length) return "";
    return keys
      .map((k) => {
        const url = refUrl(k);
        const external = url !== "#/references";
        return (
          '<a class="cite-link" href="' + escapeHtml(url) + '"' +
          (external ? ' target="_blank" rel="noopener"' : "") + ">[" + escapeHtml(k) + "]</a>"
        );
      })
      .join(" ");
  }
  // Free-text fields (classicalStatus, overview) name papers in prose --
  // "Lenstra, Rinnooy Kan & Brucker (1977)" -- rather than using the
  // bracketed [KEY] badges results[] entries get. Authoring those mentions
  // as `[[KEY:visible text]]` in the JSON lets this turn them into a real
  // hyperlink (to the paper's own DOI/URL, not just the References page)
  // without hand-writing raw HTML into the data (which would need its own
  // escaping and double as a self-inflicted injection risk).
  function linkifyCitations(text) {
    const escaped = escapeHtml(text || "");
    return escaped.replace(/\[\[(\w+):([^\]]+)\]\]/g, (_, key, label) => {
      const url = refUrl(key);
      const external = url !== "#/references";
      return (
        '<a class="inline-cite" href="' + escapeHtml(url) + '"' +
        (external ? ' target="_blank" rel="noopener"' : "") + ">" + label + "</a>"
      );
    });
  }
  // For plain-text contexts that can't hold markup (an HTML attribute like
  // a tooltip's title=""): drop the [[KEY:...]] wrapper down to just the
  // visible label instead of showing the raw marker syntax on hover.
  function stripCitationMarkup(text) {
    return String(text || "").replace(/\[\[\w+:([^\]]+)\]\]/g, "$1");
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
        '<a class="notation" href="#/problem/' + encodeURIComponent(p.id) + '">' + escapeHtml(p.notation) + "</a>" +
        '<div class="pname">' + escapeHtml(p.name) + "</div>" +
        '<div class="pname" style="margin-top:.3rem">' + linkifyCitations(p.classicalStatus) + "</div>";
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
          btn.style.cssText = classPillStyle(cls, result);
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
      '<div class="detail-class-badge" style="' + classPillStyle(cls, result) + '">' +
      (cls ? cls.label : result.class) + "</div>" +
      detailField("Problem", problem.name) +
      detailField("Parameter", param.name) +
      detailFieldHtml("Classical (unparameterized) status", linkifyCitations(problem.classicalStatus)) +
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
  function buildResultsListHtml(effectiveResults, isInP) {
    if (!effectiveResults.length) {
      return isInP
        ? '<p style="color:var(--muted)">All parameters are trivially FPT, as the problem is in P. Fine-grained FPT results are open.</p>'
        : '<p style="color:var(--muted)">No parameterized results recorded for this problem yet.</p>';
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
            '<div class="result-body"><p>' + linkifyCitations(r.note || "") + "</p>" +
            "<p>" + citeLinks(r.referenceKeys) +
            (r.confidence ? ' <span class="conf-dot ' + escapeHtml(r.confidence) + '" title="' +
              escapeHtml(confidenceLabel(r.confidence)) + '"></span> <em style="color:var(--muted);font-size:0.8em">' +
              escapeHtml(r.confidence) + "</em>" : "") +
            "</p></div>" +
            '<span class="class-pill" style="' + classPillStyle(cls, r) + '">' +
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
      buildClassicalBadgeHtml(p) + linkifyCitations(p.classicalStatus) + "</div>" +
      (p.overview ? detailFieldHtml("Overview", linkifyCitations(p.overview)) : "") +
      '<div class="detail-field"><h4>Parameter hierarchy</h4>' + tree.html + "</div>" +
      '<div class="detail-field"><h4>Parameterized results</h4>' + buildResultsListHtml(effectiveResultsForProblem(p.id), effectiveClassForProblem(p.id) === "P") + "</div>" +
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

    const resultsHtml = buildResultsListHtml(effectiveResultsForProblem(p.id), effectiveClassForProblem(p.id) === "P");

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
      '<div class="wiki-status"><b>Classical (unparameterized) status</b>' + ccBadge + linkifyCitations(p.classicalStatus) + "</div>" +
      '<div class="wiki-section wiki-overview"><h3>Overview</h3><p>' + linkifyCitations(p.overview || "") + "</p></div>" +
      '<div class="wiki-section"><h3>Parameterized results</h3>' + resultsHtml + "</div>" +
      '<div class="wiki-section"><h3>Related problems</h3>' + relatedHtml + "</div>" +
      "</div>";
  }

  // ---------- glossary ----------

  // Static reference pages about how this site's own model works -- as
  // opposed to the Glossary (what the complexity classes and parameters
  // mean) or References (the literature). Written as literal markup rather
  // than driven off a data file: this is prose about the model itself, and
  // it should be edited the way prose is, not squeezed into a JSON schema.
  function renderDocs() {
    els.viewDocs.innerHTML =
      '<div class="docs-page">' +
      '<h2 class="page-title">Documentation</h2>' +
      '<p class="design-intro">How to read the graphs on this site -- what an arrow actually claims, ' +
      "and how far that claim reaches.</p>" +

      '<section class="docs-section" id="docs-arrow-rules">' +
      "<h3>Arrow rule types</h3>" +

      "<p>Every arrow on this site points from a <b>general</b> problem to a <b>special case</b> of it, and " +
      "means the same thing in one direction: <b>hardness flows upward</b>, from the special case to the " +
      "general one. If the specific problem is NP-hard, so is the general one, because the general problem " +
      "contains the specific one. Positive results never flow downward -- a polynomial algorithm for the " +
      "general problem does imply one for the special case, but this site does not draw that inference " +
      "automatically, because most \"general\" nodes here are only general along one axis.</p>" +

      "<p>What that hides is that <b>\"is a special case of\" is produced by five different mechanisms</b>, " +
      "and they are not equally strong. All five preserve classical NP-hardness. They do <i>not</i> all " +
      "preserve <i>parameterized</i> hardness, because that depends on what the transformation does to the " +
      "parameter's value -- which is invisible in the arrow itself.</p>" +

      '<div class="docs-table-wrap"><table class="docs-table">' +
      "<thead><tr><th>Type</th><th>What happens to the instance</th><th>NP-hardness</th>" +
      "<th>Parameterized hardness</th></tr></thead><tbody>" +
      "<tr><td><b>1. Value restriction</b></td><td>Nothing. The specific instance <i>literally is</i> an " +
      "instance of the general problem.</td><td>Carries</td><td><b>Carries, for every parameter</b> -- every " +
      "parameter takes the same value on both sides.</td></tr>" +
      "<tr><td><b>2. Padding / defaults</b></td><td>A trivial rewrite: fill in a constant that was absent " +
      "(all weights 1, all release dates 0, one idle machine).</td><td>Carries</td><td>Carries for most " +
      "parameters, but count-style ones collapse to 1 -- check per parameter.</td></tr>" +
      "<tr><td><b>3. Encoding reduction</b></td><td>Numeric structure is rewritten to simulate a missing " +
      "feature.</td><td>Carries</td><td><b>Not in general</b> -- the encoding can blow a parameter up.</td></tr>" +
      "<tr><td><b>4. Objective / threshold</b></td><td>A different objective function, often equivalent only " +
      "at one threshold value.</td><td>Carries</td><td><b>Not in general</b> -- optimum-valued parameters need " +
      "not survive.</td></tr>" +
      "<tr><td><b>5. Decision-version</b></td><td>Optimization restated as a yes/no question at a fixed " +
      "threshold.</td><td>Carries</td><td><b>Not in general</b> -- same caveat as type 4.</td></tr>" +
      "</tbody></table></div>" +

      "<h4>1. Value restriction &mdash; the safe majority</h4>" +
      "<p>One field's value is a strictly narrower version of another: <code>p<sub>j</sub>=1</code> inside " +
      "<code>p<sub>j</sub>=p</code>, <code>chains</code> inside <code>outtree</code> inside <code>prec</code>, " +
      "<code>P</code> inside <code>Q</code> inside <code>R</code>, <code>F</code> inside <code>J</code>. " +
      "Nothing is rewritten -- the narrower instance already satisfies the wider problem's definition. Since " +
      "the instance is bit-for-bit identical, <i>every</i> parameter defined on it takes the same value on " +
      "both sides, so parameterized hardness carries for free, for any parameter, with no case analysis.</p>" +
      "<p class=\"docs-example\"><b>Example.</b> <code>P2|chains;p<sub>j</sub>=1|&Sigma;w<sub>j</sub>C<sub>j</sub></code> " +
      "&rarr; <code>P2|p<sub>j</sub>=1;outtree|&Sigma;w<sub>j</sub>C<sub>j</sub></code>. A set of chains has " +
      "in-degree and out-degree at most 1; an out-tree only requires in-degree at most 1, so every chain " +
      "instance already is an out-tree instance. The first is strongly NP-hard, so the second is too.</p>" +
      "<p class=\"docs-example\">The same axis shows why it matters: " +
      "<code>O|p<sub>ij</sub>=1;outtree;no-wait|&Sigma;C<sub>j</sub></code> is in <b>P</b>, while " +
      "<code>O|p<sub>ij</sub>=1;prec;no-wait|&Sigma;C<sub>j</sub></code> is <b>strongly NP-hard</b>. Relaxing " +
      "the precedence shape from an out-tree to an arbitrary DAG is the whole difference.</p>" +

      "<h4>2. Padding and defaults</h4>" +
      "<p>The specific instance needs a trivial rewrite before it is an instance of the general problem: set " +
      "every weight to 1 (unweighted inside weighted), every release date to 0, every due date to 0 " +
      "(<code>C<sub>max</sub></code> inside <code>L<sub>max</sub></code>), or add one idle machine (this " +
      "site's own machine-count rule). The rewrite is harmless for classical complexity. For parameters it " +
      "usually is too -- but note that count-style parameters collapse: an unweighted instance viewed as a " +
      "weighted one has exactly one distinct weight. That is still a bounded value, so hardness transfers, " +
      "but a parameter defined on the structure being <i>added</i> has to be checked individually.</p>" +

      "<h4>3. Encoding reductions</h4>" +
      "<p>Here the instance is genuinely rewritten to simulate a feature the general problem lacks. The " +
      "Scheduling Zoo corpus contains exactly one, and annotates it itself: on unrelated machines, " +
      "<code>M<sub>j</sub></code> (job <i>j</i> may only run on a given set of machines) reduces to no " +
      "<code>M<sub>j</sub></code> at all, because <q>processing times p<sub>ij</sub>=&infin; can be used to " +
      "encode M<sub>j</sub></q>. That is sound classically and <b>destroys p<sub>max</sub></b>: the encoding " +
      "introduces an unboundedly large processing time. A W-hardness result parameterized by " +
      "p<sub>max</sub> or #p must not travel along this arrow.</p>" +

      "<h4>4. Objective and threshold reductions</h4>" +
      "<p>These change the objective rather than the instance: <code>C<sub>max</sub></code> &rarr; " +
      "<code>L<sub>max</sub></code>, <code>C<sub>max</sub></code> &rarr; " +
      "<code>&Sigma;(1-U<sub>j</sub>)</code>, <code>L<sub>max</sub></code> &rarr; " +
      "<code>&Sigma;T<sub>j</sub></code>, <code>&Sigma;C<sub>j</sub></code> &rarr; " +
      "<code>&Sigma;T<sub>j</sub></code>, and several more. Some are genuine restrictions in disguise " +
      "(<code>&Sigma;C<sub>j</sub></code> is <code>&Sigma;w<sub>j</sub>C<sub>j</sub></code> with all weights " +
      "1). Others hold only at a single threshold -- <q>L<sub>max</sub>&nbsp;&le;&nbsp;0 if and only if " +
      "&Sigma;T<sub>j</sub>&nbsp;=&nbsp;0</q> -- which preserves the yes/no answer but not the optimum. Fine " +
      "for NP-hardness; not automatically fine for a parameter measured on the optimum.</p>" +

      "<h4>5. Decision-version arrows</h4>" +
      "<p>Only in the hand-curated maps, where three axes (<code>decision-threshold</code>, " +
      "<code>general-threshold</code>, <code>threshold-zero</code>) relate an optimization problem to its " +
      "decision version at a fixed threshold. Same caveat as type 4.</p>" +

      "<h4>The same problem, one level down: strong NP-hardness</h4>" +
      "<p>Parameterized results are not the only thing an arrow can fail to carry. <b>Strong</b> NP-hardness " +
      "means NP-hard even when every number in the input is bounded by a polynomial in the input length. A " +
      "reduction preserves that only if it does not blow the numbers up superpolynomially -- it has to be a " +
      "<i>pseudo-polynomial</i> reduction. So the same question applies one level down: an arrow can carry " +
      "plain NP-hardness while silently losing the <i>strong</i> part.</p>" +
      "<p>Type-3 arrows are exactly where this bites. The <code>M<sub>j</sub></code> encoding introduces an " +
      "unboundedly large processing time, so it cannot be relied on to transport a strong NP-hardness claim " +
      "either -- the same defect that breaks p<sub>max</sub>, for the same reason.</p>" +
      "<p><b>Audited, and this one is clean.</b> Of the 59 nodes here whose strongly-NP-hard status is " +
      "inherited rather than cited, 28 reach it across an objective-function arrow -- so the question is " +
      "live. But every objective rule in this corpus rewrites numbers only <i>downward</i>: it sets weights " +
      "to 1, sets due dates to 0, or shifts by a value already in the input. None of them multiplies " +
      "anything, so strong NP-hardness survives all of them. And the one genuinely dangerous rule -- the " +
      "<code>M<sub>j</sub></code> encoding -- turns out to generate <b>zero</b> edges in this graph: all 111 " +
      "machine-set arrows run the other way (<i>no</i> restriction is a special case of having one), which " +
      "is a plain type-1 restriction. So there is no live error from this today. The mechanism is still " +
      "unguarded, though: nothing in the code would notice if a scaling rule were added later.</p>" +
      "<p><b>Does the Scheduling Zoo handle this?</b> No, and it could not: its reduction engine is pure " +
      "syntactic field substitution with no notion of how numbers grow, and its result classifier is a " +
      "keyword regex that sorts every citation into just \"positive\" or \"negative\" " +
      "(<code>NP</code>, <code>hard</code>, <code>&ge;</code>, <code>cannot</code>, <code>ETH</code>, &hellip;). " +
      "It has no representation of <i>strongly</i> versus <i>weakly</i> NP-hard at all, so there is nothing " +
      "for it to preserve or check. The strongly / weakly / pseudo-polynomial tiers shown on this site are " +
      "our own reading of their citation text, not a distinction they record.</p>" +

      "<h4>What this site actually does today</h4>" +
      "<ul class=\"docs-list\">" +
      "<li><b>Scheduling Zoo overview:</b> only <i>classical</i> hardness is inherited along arrows. " +
      "Parameterized results are shown on each node but are never propagated. Nothing unsound -- and nothing " +
      "inherited either.</li>" +
      "<li><b>Hand-curated maps:</b> parameterized hardness (W[1], W[2], para-NP) <i>is</i> inherited upward " +
      "along arrows, for the same parameter. FPT, XP and P correctly never transfer. Every inheritance that " +
      "fires in the current data crosses a type-1 or type-2 arrow, so all of them are sound -- but that is a " +
      "property of the data as it stands, <b>not something the code checks</b>.</li>" +
      "</ul>" +

      "<h4>Open problem: what does &ldquo;parameter-safe&rdquo; even mean here?</h4>" +
      "<p>The obvious fix is to mark each arrow as parameter-safe or not. The obvious fix does not quite " +
      "work, because safety is not a property of the arrow alone -- it is a property of <b>the arrow and the " +
      "parameter together</b>. The <code>M<sub>j</sub></code> encoding above is perfectly safe for the number " +
      "of jobs, for the number of machines, for treewidth of the precedence graph; it is catastrophic for " +
      "p<sub>max</sub>. A single boolean cannot express that, and a full matrix of every arrow against every " +
      "parameter is a large amount of data to state and to keep honest.</p>" +
      "<p>A middle path that seems worth trying: type-1 arrows need no annotation at all, since they preserve " +
      "every parameter by construction, and they are the large majority. Only types 3, 4 and 5 need to name " +
      "the parameters they break -- which is a much shorter list than naming the ones they preserve. Until " +
      "that exists, the honest position is the current one: propagate classical hardness freely, propagate " +
      "parameterized hardness only where the arrow is known to be a plain restriction.</p>" +
      "</section>" +
      "</div>";
  }

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
  // A "stealth" style arrowhead (concave notch cut into the back, like
  // TikZ's Stealth arrow tip) instead of a solid filled triangle -- shared
  // by both the map and the parameter-tree SVGs so the two match.
  const STEALTH_ARROW_PATH = "M0,0 L10,5 L0,10 L3.2,5 Z";

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
  // c/k:"param" means "no actual restriction, just marking that this
  // dimension is being studied as a parameter" -- by the data model's own
  // documented rule it's supposed to be exactly equivalent to "free" for
  // generalization purposes. That equivalence has to be checked BEFORE the
  // family-match test below, not after: a "boundedValue,c=param" compared
  // against a genuinely free restriction on the other side previously hit
  // the family-mismatch/family-vs-free branches first and was judged
  // strictly more restrictive than free, when it should compare as equal.
  function isEffectivelyFree(r) {
    return r.family === "free" || r.k === "param" || r.c === "param";
  }
  function compareRestriction(ra, rb) {
    const raFree = isEffectivelyFree(ra), rbFree = isEffectivelyFree(rb);
    if (raFree) return rbFree ? 0 : 1;
    if (rbFree) return -1;
    if (ra.family !== rb.family) return null;
    if (ra.family === "value") return ra.equals === rb.equals ? 0 : null;
    const ca = ra.k !== undefined ? ra.k : ra.c;
    const cb = rb.k !== undefined ? rb.k : rb.c;
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

  // On-demand re-layout so hand-curated col/row values (fragile as a map
  // grows -- this is exactly the overlap that had to be fixed by hand for
  // the mega-problem map) can be regenerated instead of nudged by eye.
  // Row = longest path down from a root (a node nothing else generalizes),
  // matching the site-wide convention that generalization runs upward.
  // Column, within a row, is a single top-down barycenter pass (average
  // column of each node's already-placed parents) -- a standard, cheap
  // Sugiyama-style heuristic that keeps a node roughly under its parents
  // and so keeps edges closer to vertical, without claiming to be a
  // crossing-minimal solver.
  // Shared by autoArrangeMap (regular maps) and the Scheduling Zoo overview
  // (a much bigger, externally-sourced graph) -- takes plain node ids and
  // {from,to} edges, returns {row, col} keyed by id. Row = longest path
  // from a root; column = single top-down barycenter pass.
  function layoutDag(ids, edgeList) {
    const inEdges = {}, order = {};
    ids.forEach((id, i) => { inEdges[id] = []; order[id] = i; });
    edgeList.forEach((e) => {
      if (inEdges[e.to] && ids.includes(e.from)) inEdges[e.to].push(e.from);
    });

    const row = {};
    function computeRow(id, visiting) {
      if (row[id] !== undefined) return row[id];
      if (!inEdges[id].length || visiting.has(id)) return (row[id] = 0);
      visiting.add(id);
      const r = 1 + Math.max(...inEdges[id].map((p) => computeRow(p, visiting)));
      visiting.delete(id);
      return (row[id] = r);
    }
    ids.forEach((id) => computeRow(id, new Set()));

    const byRow = {};
    ids.forEach((id) => (byRow[row[id]] = byRow[row[id]] || []).push(id));
    const col = {};
    Object.keys(byRow)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((r) => {
        byRow[r]
          .sort((a, b) => {
            const parentsA = inEdges[a], parentsB = inEdges[b];
            const ba = parentsA.length ? parentsA.reduce((s, p) => s + col[p], 0) / parentsA.length : order[a];
            const bb = parentsB.length ? parentsB.reduce((s, p) => s + col[p], 0) / parentsB.length : order[b];
            return ba - bb || order[a] - order[b];
          })
          .forEach((id, i) => { col[id] = i + 1; });
      });
    return { row, col };
  }

  function autoArrangeMap(map) {
    const ids = map.nodes.map((n) => n.problemId);
    const { row, col } = layoutDag(ids, mapEdges(map));
    map.nodes.forEach((n) => { n.row = row[n.problemId]; n.col = col[n.problemId]; });
  }

  // ---------- Scheduling Zoo overview ----------
  // A read-only, much bigger graph imported from schedulingzoo.lip6.fr's
  // own bib+notation.xml data (see data/schedulingzoo.json and the
  // conversion script in that repo). Unlike this site's own maps, these
  // results are NOT independently verified here -- every node says so, and
  // links out to the original citation instead of claiming a checked
  // classicalClass/complexityClass.
  const SZ_NODE_H = 24, SZ_ROW_H = 46, SZ_MARGIN = 30, SZ_COL_GAP = 12;
  const SZ_FONT_PX = 10.5;
  const SZ_MIN_NODE_W = 60, SZ_MAX_NODE_W = 260;

  // Generalization edges in schedzoo's own reduction graph that we've
  // manually spot-checked and found internally inconsistent with schedzoo's
  // OWN cited results -- flagged, not corrected (schedzoo's data stays
  // exactly as they have it; see the note at the bottom of this view).
  // Each entry's `from`/`to` are raw schedzoo ids (DATA_SZ.nodes[].id).
  const SZ_FLAGGED_EDGES = [
    {
      from: "P2|fix_j|C_{\\max}",
      to: "P2||C_{\\max}",
      note:
        "schedzoo's notation.xml declares <reduction from=\"\" to=\"fix_j\" /> for the \"machine sets\" field, " +
        "i.e. plain P2||Cmax is claimed a special case of P2|fixj|Cmax. But P2|fixj|Cmax is cited P (Hoogeveen & " +
        "van de Velde, 1994) while P2||Cmax is cited NP-hard (Lenstra & Rinnooy Kan, 1977 -- P2||Cmax is exactly " +
        "Partition, about as settled as scheduling theory gets). If the generalization claim were right, P2||Cmax " +
        "would have to inherit the P2|fixj|Cmax algorithm and be in P too -- it doesn't. Neither direction actually " +
        "holds as a simple field-substitution reduction: fix_j fixes each job's machine(s) as GIVEN input (no " +
        "scheduler choice), while plain scheduling requires the scheduler to freely choose -- reducing one to the " +
        "other would mean already knowing the answer. Looks like an authoring error in notation.xml's reduction " +
        "graph, not a citation error on either end.",
    },
  ];
  function szFlaggedEdgeFor(from, to) {
    return SZ_FLAGGED_EDGES.find((f) => f.from === from && f.to === to);
  }

  // Shared between the green edges' click-through panel and the data note
  // below it -- one source of truth for why OUR_MACHINE_COUNT_RULES (see
  // convert_for_pzoo.py) is sound.
  const SZ_MACHINE_COUNT_RULE_NOTE =
    "schedzoo's own \"number of machines\" field has zero reduction rules (see the data note below) -- so we " +
    "added our own: m reduces to m+1 (1->2->3->4->5->arbitrary), layered on TOP of schedzoo's data, never " +
    "replacing anything they declared. Sound for every objective in this corpus regardless of machine " +
    "environment: for P/Q/R, an m-machine schedule stays valid with an extra machine simply left unused; for " +
    "O/F/J (where machine count = operations per job), pad every job with one zero-duration operation on the " +
    "extra machine -- neither changes any completion time, so the optimum can only get better or stay the same " +
    "with more machines, never worse, for any regular objective (Cmax, sums of completion/tardiness/flow times, " +
    "Lmax, throughput -- all of them). Restricted to fire ONLY when machine count is the sole differing field " +
    "(never combined with any other simultaneous relaxation) -- see the next data note for why. This edge is " +
    "marked green specifically because it exists ONLY due to this added rule -- checked against schedzoo's own " +
    "original rules first, edge by edge, so a pair already implied by their own data is never wrongly claimed " +
    "as ours.";

  // Shared between the S1 data note and the panel of any edge that exists
  // only because of our corrected setup-time rule (OUR_S1_SETUP_RULES in
  // convert_for_pzoo.py). On today's data that rule only removes edges.
  const SZ_S1_SETUP_NOTE =
    "What an empty setup-times field means depends on the server. With no server there is nothing to set up " +
    "(s=0). Under S1 -- one server performs every setup, and setups cannot overlap -- it has to mean ARBITRARY " +
    "setup times: zero setups would make the server constrain nothing, so S1 would be pointless. The " +
    "citations agree: Brucker, Knust & Wang (2005) prove F2;S1|pij=p|Cmax NP-hard, which zero setups would " +
    "make trivial. schedzoo's notation.xml labels that value \"no setup\" and declares \"\" -> sij=1 -> sij=s " +
    "(the same for sj), which makes arbitrary setups the most RESTRICTED case. That put 19 wrong edges in their " +
    "graph, 14 of them placing a problem cited P above one cited NP-hard (the F2;S1 cluster we used to flag " +
    "edge by edge). It is also what broke our machine-count rule whenever it combined with another field: 27 " +
    "contradictions, every one involving S1. Our correction, in our converter only (schedzoo's files are " +
    "untouched): drop the four \"\" -> s rules and chain s=1 -> s=s -> arbitrary, gated on S1 -- a two-field " +
    "(server, setup times) rule, so it never fires for a problem without a server. Result: those 19 edges " +
    "are gone, none added, no S1 contradiction remains, and the combined machine-count edges now contradict " +
    "0 of 170. Suggested upstream fix: replace <reduction from=\"\" to=\"s_{ij}=1\"/> with " +
    "<reduction from=\"S1;s_{ij}=1\" to=\"S1;not setup times\"/> and " +
    "<reduction from=\"S1;s_{ij}=s\" to=\"S1;not setup times\"/> (both spelled out: extend_complex_reduction " +
    "never actually composes rules, its recursive calls are never iterated), likewise for s_j, and relabel " +
    "the empty choice \"arbitrary setup times\".";

  // General notes about schedzoo's own data that don't attach to one
  // specific edge (so there's nothing to mark red/dashed on the graph) --
  // typos we've silently compensated for in our classifier, and structural
  // gaps in their reduction graph. Shown alongside SZ_FLAGGED_EDGES at the
  // bottom of this view.
  const SZ_DATA_NOTES = [
    {
      title: "Typo silently tolerated: \"in in $P$\" for P|pj=p;rj|Lmax",
      body:
        "Simons:83's citation for P|pj=p;rj|Lmax literally reads \"in in $P$\" in schedzoo's own bib file -- a " +
        "doubled word, not \"is in $P$\" like its three sibling citations from the very same paper. Confirmed " +
        "it's the only citation in the whole corpus starting with \"in \". Our classifier now recognizes this " +
        "specific typo (checked it can't match anything else), so the node shows P as intended -- schedzoo's " +
        "source text itself is untouched.",
    },
    {
      title: "No reduction rule connects single-machine (\"1\") to multi-machine (\"P\"/\"Q\"/\"R\"/...) problems",
      body:
        "Checked both fields that could carry this. The \"type\" field (alpha: 1/P/Q/R/O/F/J) does have " +
        "reduction rules -- but only among the multi-machine environments themselves (P->Q->R, F->J); none " +
        "mention \"1\" at all. That's because schedzoo's own parser never actually assigns type=\"1\" to a " +
        "parsed single-machine problem -- it assigns type=\"P\" (same as ordinary parallel-machine problems) " +
        "plus a separate \"number of machines\"=\"1\". And THAT field's simple_reductions set is completely " +
        "empty -- no rule for m=1, m=2, m=3, ... being a special case of arbitrary m at all. (One narrow " +
        "complex reduction exists, but only for one specific combination with three other fields at once.) So " +
        "no rule declaring \"1 reduces to P\" exists in either place it could live -- not a wrong rule, an " +
        "absent one. Result: problems that differ ONLY in machine count essentially never get a generalization " +
        "edge in this graph -- e.g. 1||ΣUj has no edge to P||ΣUj, even though m=1 is obviously a special case " +
        "of arbitrary m. Not a hand-authored graph (edges genuinely are computed from declared rules, per the " +
        "\"why so few edges\" question earlier) -- just a dimension schedzoo's own reduction data barely covers.",
    },
    {
      title: "We added a reduction rule to fill that gap -- new edges shown green",
      body: SZ_MACHINE_COUNT_RULE_NOTE,
    },
    {
      title: "Setup times under a single server (S1): schedzoo's reduction rule points the wrong way -- corrected here",
      body: SZ_S1_SETUP_NOTE,
    },
  ];

  // One-line hover summary for an edge: which field(s) it relaxes, using
  // schedzoo's own field names (see edge.diffs, computed in
  // convert_for_pzoo.py). The full per-field explanation text is reserved
  // for the click-through panel (openSchedulingZooEdgePanel) -- a hover
  // tooltip has to stay short.
  function szEdgeSummary(edge, flagged) {
    const prefix = flagged ? "⚠ FLAGGED (see note below) — " : edge.addedByUs ? "✚ ADDED BY US (see note below) — " : "";
    const diffs = edge.diffs || [];
    if (!diffs.length) return prefix + "generalizes (no field differs -- merged duplicate?)";
    if (diffs.length === 1) {
      const d = diffs[0];
      return prefix + "differs by \"" + d.field + "\": general=" + (d.generalValue || "(none)") +
        ", specific=" + (d.specificValue || "(none)") + " -- click for details";
    }
    return prefix + "generalizes along " + diffs.length + " dimensions: " +
      diffs.map((d) => d.field).join(", ") + " -- click for details";
  }

  // The objective FILTER only -- never node identity/notation/edges, which
  // stay exactly as schedzoo has them -- treats an unweighted sum objective
  // as the same family as its weighted counterpart (ΣUj is just ΣwjUj with
  // every weight fixed to 1, same underlying quantity being summed), so
  // choosing "ΣwjUj" also surfaces ΣUj problems instead of splitting one
  // objective family across two dropdown entries. Table-driven against the
  // confirmed, closed set of pairs actually present in this corpus, rather
  // than a generic regex, so it can't silently mis-rewrite an objective
  // string it wasn't checked against.
  const SZ_OBJECTIVE_CANON = {
    "ΣUj": "ΣwjUj", "ΣCj": "ΣwjCj", "ΣTj": "ΣwjTj", "ΣFj": "ΣwjFj", "Fmax": "max wjFj",
  };
  function canonicalSzObjective(o) {
    return SZ_OBJECTIVE_CANON[o] || o;
  }

  // A small dropdown component shared by all three Scheduling Zoo filters.
  // Each option is a THREE-position switch, not a checkbox: neutral (ignore
  // this value), require (+) and exclude (-). Two independent sets rather
  // than one "checked" set, because plain checkboxes can only say "keep
  // these" -- expressing "everything EXCEPT preemptive" then means ticking
  // every other box by hand, and re-ticking them whenever a new value shows
  // up. A selection is therefore {include:Set, exclude:Set}; empty include
  // means "no positive constraint", not "match nothing".
  //
  // buildMsDropdownHtml returns the markup (with `preselected` restoring a
  // previous {include, exclude}); wireMsDropdown attaches the behavior and
  // returns { getSelected }.
  function buildMsDropdownHtml(idPrefix, placeholder, options, preselected) {
    const inc = (preselected && preselected.include) || new Set();
    const exc = (preselected && preselected.exclude) || new Set();
    const optionsHtml = options.map((o) => {
      const state = exc.has(o.value) ? "out" : inc.has(o.value) ? "in" : "neutral";
      const labelHtml = o.title
        ? '<span title="' + escapeHtml(o.title) + '">' + escapeHtml(o.label) + "</span>"
        : escapeHtml(o.label);
      return '<div class="ms-option" data-value="' + escapeHtml(o.value) + '" data-state="' + state +
        '" data-count="' + (o.count || 0) + '">' +
        '<span class="tri">' +
        '<button type="button" class="tri-seg tri-out" data-set="out" title="Exclude: hide problems with this value">−</button>' +
        '<button type="button" class="tri-seg tri-neutral" data-set="neutral" title="Ignore this value">•</button>' +
        '<button type="button" class="tri-seg tri-in" data-set="in" title="Require: keep only problems with this value">+</button>' +
        "</span>" +
        '<span class="ms-option-label">' + labelHtml +
        '<span class="ms-count">' + (o.count || 0) + "</span></span>" +
        "</div>";
    }).join("");
    return '<div class="ms-dropdown" id="' + idPrefix + '">' +
      '<button type="button" class="ms-toggle" id="' + idPrefix + '-toggle">' + escapeHtml(placeholder) + "</button>" +
      '<div class="ms-panel" id="' + idPrefix + '-panel" hidden>' + optionsHtml + "</div>" +
      "</div>";
  }

  // Does one value pass a {include, exclude} selection? Exclusions win over
  // inclusions (a value switched to "-" is out even if it would otherwise
  // be required), and an empty include set means "no positive constraint".
  function msSelectionAccepts(sel, value) {
    if (!sel) return true;
    if (sel.exclude && sel.exclude.has(value)) return false;
    return !sel.include || !sel.include.size || sel.include.has(value);
  }

  // The three colors a Scheduling Zoo edge can have, and the single place
  // that decides which one an edge gets. Both the line's stroke and its
  // arrowhead marker are derived from this one value -- see arrowDef in
  // renderSchedulingZoo -- so the head can never disagree with its line.
  // Green = exists ONLY because of OUR added machine-count rule (see
  // OUR_MACHINE_COUNT_RULES in convert_for_pzoo.py); red = flagged
  // inconsistent; gray = schedzoo's own untouched reduction graph.
  const SZ_EDGE_FLAGGED_COLOR = "#cf4444";
  const SZ_EDGE_OURS_COLOR = "#2c8a3f";
  const SZ_EDGE_COLORS = [MAP_EDGE_COLOR, SZ_EDGE_FLAGGED_COLOR, SZ_EDGE_OURS_COLOR];
  function szEdgeStroke(edge, flagged) {
    if (flagged) return SZ_EDGE_FLAGGED_COLOR;
    return edge.addedByUs ? SZ_EDGE_OURS_COLOR : MAP_EDGE_COLOR;
  }
  function szArrowIdFor(color) {
    return "sz-arrow-" + color.replace("#", "");
  }

  // Notation is stored with the real symbols ("1|rj|ΣUj"), but nobody types
  // Σ into a search box. Each node therefore gets a haystack holding
  // several spellings of itself -- as written, with symbols spelled out as
  // words ("sum"), with symbols dropped entirely ("uj"), and the raw LaTeX
  // id -- and the query is expanded the same three ways before matching, so
  // "1|rj|Uj", "1|rj|sumUj" and "1|rj|ΣUj" all find the same problem.
  const SZ_SYMBOL_WORDS = {
    "Σ": "sum", "∞": "infty", "≤": "<=", "≥": ">=", "∈": "in", "≠": "!=",
    "·": "", "…": "...", "⊆": "subseteq", "≺": "prec", "≥": ">=",
  };
  function szSearchForms(s) {
    const base = String(s || "").toLowerCase().replace(/\s+/g, "");
    let worded = base, stripped = base;
    Object.keys(SZ_SYMBOL_WORDS).forEach((sym) => {
      const low = sym.toLowerCase();
      worded = worded.split(low).join(SZ_SYMBOL_WORDS[sym]);
      stripped = worded === base ? stripped : stripped;
      stripped = stripped.split(low).join("");
    });
    // Also drop LaTeX punctuation so a pasted "\sum w_jC_j" still matches.
    const delatexed = base.replace(/[\\{}$_^]/g, "");
    return [base, worded, stripped, delatexed];
  }
  function szNodeSearchHaystack(node) {
    if (node._searchKey === undefined) {
      node._searchKey = szSearchForms(node.notation).concat(szSearchForms(node.id)).join("\n");
    }
    return node._searchKey;
  }
  // True when any spelling of `needle` occurs in any spelling of `hay`.
  function szFormsContain(hayForms, needle) {
    return szSearchForms(needle).some((nf) => nf && hayForms.some((hf) => hf.includes(nf)));
  }

  // Two matching modes, because plain substring search is too literal to be
  // useful on alpha|beta|gamma notation: "1|rj|Uj" would find nothing, since
  // the actual problems are "1|rj;pmtn|ΣUj", "1|rj;pj=p|ΣUj" and so on --
  // the beta field carries extra constraints and is not in a fixed order.
  //
  // So a query CONTAINING "|" is matched slot by slot: its alpha must occur
  // in the node's alpha, its gamma in the node's gamma, and every
  // ";"-separated beta token must occur somewhere in the node's beta, in any
  // order. "1|rj|Uj" then means "single machine, has release dates, some
  // U_j objective", which is what someone typing it means. A query with no
  // "|" stays a free substring search over every spelling of the notation.
  function szNodeMatchesQuery(node, q) {
    if (!q) return true;
    if (q.indexOf("|") === -1) {
      const hay = szNodeSearchHaystack(node);
      return szSearchForms(q).some((form) => form && hay.includes(form));
    }
    const qSlots = q.split("|");
    const nSlots = String(node.notation || "").split("|");
    if (qSlots.length > nSlots.length) return false;
    for (let i = 0; i < qSlots.length; i++) {
      if (!qSlots[i].trim()) continue;
      const nodeForms = szSearchForms(nSlots[i] || "");
      const tokens = qSlots[i].split(";").map((t) => t.trim()).filter(Boolean);
      if (!tokens.every((t) => szFormsContain(nodeForms, t))) return false;
    }
    return true;
  }

  // ---- the "Settings" filter: schedzoo's beta fields (precedence shape,
  // batching, multiprocessor, no-wait, ...), which are per-node data in
  // node.settings (see SETTINGS_FIELDS in convert_for_pzoo.py).
  //
  // Two tiers, because a flat list of every value across every field would
  // be ~60 rows: each FIELD is a collapsible group whose own switch means
  // "this constraint is present at all" (+) or "absent entirely" (-), and
  // expanding it exposes that field's individual values as their own
  // switches. The common intent ("no batching") is then one click without
  // having to know the five batch variants, and the specific intent is one
  // click more -- no separate "advanced mode" to discover or remember.
  const SZ_SETTING_LABELS = {
    preemption: "Preemption",
    "precedence relation": "Precedence",
    "processing times": "Processing times",
    "release time": "Release dates",
    batching: "Batching",
    server: "Single server",
    "no-wait": "No-wait",
    "number of jobs": "Job-count limits",
    "transportation delays": "Transportation delays",
    "setup times": "Setup times",
    robot: "Transport robot",
    "time lags": "Time lags",
    "communication delay": "Communication delays",
    "due date": "Due-date windows",
    deadline: "Deadlines",
    "no-idle": "No-idle",
    recirculation: "Recirculation",
    "rejection cost": "Rejection",
  };

  // A few schedzoo FIELDS are one concept split across two field names, and
  // grouping the menu strictly by field name gets them wrong. "job size"
  // (size_j) is not about how long a job is -- schedzoo's own text is
  // "multiprocessor tasks ... executed simultaneously on size_j parallel
  // machines" -- so it belongs with machine sets (M_j, fix_j), which is the
  // same question of which/how many machines a job demands at once. Merged
  // groups keep each value tagged with its real field for matching; only
  // the presentation is joined.
  const SZ_SETTING_GROUP_MERGES = [
    { key: "multiprocessor", label: "Multiprocessor tasks", fields: ["machine sets", "job size"] },
    // Verified against the corpus, not assumed: every problem setting any of
    // the first six fields is in a shop environment (O/F/J) -- no-wait
    // 47/47, job counts 47/47, transport delays 45/45, robot 23/23, no-idle
    // 2/2, recirculation 1/1. ("Shop", not "job shop": O is open and F is
    // flow.) The single server is the exception: strictly it belongs to the
    // machine environment, and 23 of its 47 problems are on P. It is filed
    // here anyway because S1 is read as a setting -- its presence is what
    // gives a problem setup times at all.
    {
      key: "shop",
      label: "Shop constraints (O/F/J)",
      fields: ["no-wait", "number of jobs", "transportation delays", "robot", "no-idle", "recirculation", "server"],
      // Six fields and sixteen values is a wall of unrelated switches when
      // flattened, so this one nests: each field stays its own sub-group.
      nested: true,
    },
  ];

  // Some single VALUES matter more than the field they live in. "online-r_j"
  // is one value of the release-time field, but it is not a variation on
  // having release dates -- it switches the whole model to an online one
  // (jobs revealed over time, competitive analysis), and it is the only
  // family in the corpus that no reduction rule touches in either
  // direction. Filed under "Release dates" it is invisible, and with 18
  // problems it would sink into "Rare"; so it gets its own pinned group
  // whose "+"/"-" mean online / not online, rather than the field group's
  // "has release dates at all / has none". It still appears as a value
  // under Release dates too -- the same problems, asked about differently.
  const SZ_SETTING_VALUE_GROUPS = [
    {
      key: "online",
      label: "Online (jobs revealed over time)",
      values: [
        { field: "release time", value: "online-r_j" },
        // restarts is filed under "preemption" by schedzoo, but all four of
        // its problems are online -- it is the online model's own
        // preemption variant, so it belongs to this family. It stays listed
        // under Preemption as well; the same problems, asked about
        // differently.
        { field: "preemption", value: "restarts" },
      ],
    },
  ];

  // (field, value) pairs never listed as a selectable value under their own
  // field, because the group's "+" already says the same thing.
  const SZ_HIDDEN_SETTING_VALUES = [
    { field: "precedence relation", value: "prec" },
    // Both of these are listed under Online instead -- they ARE the online
    // family. Their own fields keep counting them (a problem with
    // online-r_j does have release dates, and restarts is a kind of
    // preemption), they just aren't offered twice as switches.
    { field: "release time", value: "online-r_j" },
    { field: "preemption", value: "restarts" },
  ];
  // Below this many problems a field goes behind the "Rare settings"
  // expander rather than cluttering the main list -- there are six of them
  // and between them they cover 18 problems.
  const SZ_RARE_SETTING_MAX = 20;
  // Within a group, values this rare are folded into a nested "More
  // settings" expander too. Precedence is the case that needs it: seven of
  // its shapes have a single problem each, and several are refinements of
  // one another (DC-graph inside sp-graph, quasi- inside over-interval
  // order), so listing them all at the top level buries chains and outtree
  // under a wall of near-duplicates.
  const SZ_MORE_VALUE_MAX = 2;

  // Preemption is a beta field like any other, but it lives in its own
  // top-level node key (it predates node.settings), so reading a setting
  // goes through here rather than straight into node.settings.
  function szSettingValue(node, field) {
    if (field === "preemption") return node.preemption || "";
    return (node.settings && node.settings[field]) || "";
  }

  // The settings menu, assembled from the corpus itself (DATA_SZ
  // .settingsFields, regenerated with the data) plus preemption, which is
  // synthesised here since it isn't in that list. Preemptive and
  // non-preemptive are mutually exclusive, so the group's own -/+ switch
  // already expresses "non-preemptive" / "preemptive" without needing a
  // separate value row for the absent case.
  function szSettingGroups() {
    const byField = {};
    (DATA_SZ.settingsFields || []).forEach((f) => {
      byField[f.field] = f.values.map((v) => Object.assign({ field: f.field }, v));
    });
    const pmtnCounts = {};
    DATA_SZ.nodes.forEach((n) => {
      if (n.preemption) pmtnCounts[n.preemption] = (pmtnCounts[n.preemption] || 0) + 1;
    });
    byField.preemption = [
      { field: "preemption", value: "pmtn", label: "pmtn", count: pmtnCounts.pmtn || 0,
        explanation: "Jobs can be preempted and resumed, possibly on another machine." },
      { field: "preemption", value: "restarts", label: "restarts", count: pmtnCounts.restarts || 0,
        explanation: "Preempted jobs restart from the beginning. Only occurs on online problems in this corpus." },
    ].filter((v) => v.count);

    // Values a group deliberately doesn't list: "prec" is arbitrary
    // precedence, i.e. the whole category, so as a sibling of "chains" and
    // "outtree" it reads as one more shape when it is really the group's
    // own "+". The group switch covers it.
    const byFieldAll = {};
    Object.keys(byField).forEach((f) => { byFieldAll[f] = byField[f]; });
    SZ_HIDDEN_SETTING_VALUES.forEach((h) => {
      if (byField[h.field]) byField[h.field] = byField[h.field].filter((v) => v.value !== h.value);
    });

    const merged = new Set();
    const groups = [];
    SZ_SETTING_GROUP_MERGES.forEach((m) => {
      const fields = m.fields.filter((f) => byField[f]);
      if (!fields.length) return;
      fields.forEach((f) => merged.add(f));
      groups.push({
        key: m.key,
        fields: fields,
        label: m.label,
        values: fields.reduce((acc, f) => acc.concat(byField[f]), []),
        subgroups: m.nested
          ? fields.map((f) => ({
              key: m.key + "/" + f,
              fields: [f],
              label: SZ_SETTING_LABELS[f] || f,
              values: byField[f],
            }))
          : null,
      });
    });
    // Value groups match specific VALUES rather than "field is set at all",
    // and may draw those values from more than one field: Online is
    // online-r_j (a release-time value) together with restarts (a
    // preemption value), which is a coherent family even though schedzoo
    // files the two under different fields.
    SZ_SETTING_VALUE_GROUPS.forEach((m) => {
      const values = m.values
        .map((mv) => (byFieldAll[mv.field] || []).filter((v) => v.value === mv.value)[0])
        .filter(Boolean);
      if (!values.length) return;
      groups.push({
        key: m.key,
        fields: values.map((v) => v.field),
        isValueGroup: true,
        label: m.label,
        pinned: true,
        values: values,
      });
    });
    Object.keys(byField).forEach((f) => {
      if (merged.has(f)) return;
      groups.push({ key: f, fields: [f], label: SZ_SETTING_LABELS[f] || f, values: byField[f] });
    });
    // A group's own count is the number of problems it MATCHES: for a value
    // group that means holding one of its listed values, for a field group
    // (merged or not) it means using any of its fields -- which is why a
    // merged group's count isn't just the sum, a problem could set both.
    const countGroup = (g) => {
      g.count = DATA_SZ.nodes.filter((n) => szGroupMatches(n, g)).length;
      g.values.sort((a, b) => b.count - a.count);
      (g.subgroups || []).forEach(countGroup);
      if (g.subgroups) g.subgroups.sort((a, b) => b.count - a.count);
    };
    groups.forEach(countGroup);
    // Sorted purely by count. `pinned` only keeps a group out of the "Rare"
    // bucket -- it does NOT float it to the top, which looked wrong with
    // Online's 18 sitting above fields with hundreds.
    return groups.sort((a, b) => b.count - a.count);
  }

  // Is this node in the group? A value group ("Online") means holding one
  // of its listed values; a field group means any value of any of its
  // fields.
  // The (field, value) pairs a rendered group lists, read back off its own
  // value rows -- so a value group's match set is simply "what it shows",
  // with no separate encoding of it in a data attribute to keep in sync.
  function szGroupValueRefs(groupEl) {
    return Array.from(groupEl.querySelectorAll(".ms-value")).map((v) => ({
      field: v.dataset.field,
      value: v.dataset.value,
    }));
  }

  function szGroupMatches(node, g) {
    if (g.isValueGroup) return (g.values || []).some((v) => szSettingValue(node, v.field) === v.value);
    return g.fields.some((f) => !!szSettingValue(node, f));
  }

  // A node passes when it satisfies every group-level constraint ("+" = at
  // least one of the group's fields is set, "-" = none of them are) and
  // every value-level one.
  function szNodeMatchesSettings(node, sel) {
    if (!sel) return true;
    const groups = sel.groups || [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const has = szGroupMatches(node, g);
      if ((g.state === "in" && !has) || (g.state === "out" && has)) return false;
    }
    const values = sel.values || {};
    const fields = Object.keys(values);
    for (let i = 0; i < fields.length; i++) {
      if (!msSelectionAccepts(values[fields[i]], szSettingValue(node, fields[i]))) return false;
    }
    return true;
  }

  function buildSzSettingsHtml(idPrefix, groups, preselected) {
    const prevFields = {};
    ((preselected && preselected.groups) || []).forEach((g) => { prevFields[g.key] = g.state; });
    const prevValues = (preselected && preselected.values) || {};
    const triHtml =
      '<span class="tri">' +
      '<button type="button" class="tri-seg tri-out" data-set="out" title="Exclude">−</button>' +
      '<button type="button" class="tri-seg tri-neutral" data-set="neutral" title="Ignore">•</button>' +
      '<button type="button" class="tri-seg tri-in" data-set="in" title="Require">+</button>' +
      "</span>";
    const isSet = (v, side) => (prevValues[v.field] && prevValues[v.field][side] || new Set()).has(v.value);
    const valueHtml = (v) => {
      const st = isSet(v, "exclude") ? "out" : isSet(v, "include") ? "in" : "neutral";
      return '<div class="ms-option ms-value" data-field="' + escapeHtml(v.field) +
        '" data-value="' + escapeHtml(v.value) + '" data-state="' + st + '">' +
        triHtml +
        '<span class="ms-option-label"' + (v.explanation ? ' title="' + escapeHtml(v.explanation) + '"' : "") + ">" +
        escapeHtml(v.label) + '<span class="ms-count">' + v.count + "</span></span></div>";
    };
    // A group renders either its own values, or -- when it merges several
    // fields that each have their own values -- one nested SUB-GROUP per
    // field. Shop constraints is the case that needs it: six fields and
    // sixteen values in one flat list is unreadable, whereas "Shop > Job
    // counts > n=2" is three obvious steps. Sub-groups are ordinary groups
    // (own switch, own count, own expander); everything downstream --
    // selection, counting, sorting -- walks .ms-group without caring about
    // the depth.
    const groupHtml = (g) => {
      const gState = prevFields[g.key] || "neutral";
      const children = g.subgroups || [];
      const nested = children.length > 0;
      const anyValueSet = g.values.some((v) => isSet(v, "include") || isSet(v, "exclude"));
      // One value means the value switch and the group switch would say the
      // same thing, so there is nothing worth expanding -- render it flat.
      const expandable = nested || g.values.length > 1;
      const mainVals = g.values.filter((v) => v.count >= SZ_MORE_VALUE_MAX);
      const moreVals = g.values.filter((v) => v.count < SZ_MORE_VALUE_MAX);
      const moreOpen = moreVals.some((v) => isSet(v, "include") || isSet(v, "exclude"));
      const moreHtml = moreVals.length
        ? '<div class="ms-rare"><button type="button" class="ms-caret ms-rare-caret"' +
          (moreOpen ? ' aria-expanded="true"' : "") + ">▸</button>" +
          '<span class="ms-rare-label">More settings (' + moreVals.length + ")</span>" +
          '<div class="ms-rare-body"' + (moreOpen ? "" : " hidden") + ">" +
          moreVals.map(valueHtml).join("") + "</div></div>"
        : "";
      const bodyHtml = nested
        ? children.map(groupHtml).join("")
        : mainVals.map(valueHtml).join("") + moreHtml;
      return '<div class="ms-group" data-key="' + escapeHtml(g.key) +
        '" data-fields="' + escapeHtml(g.fields.join("|")) + '"' + (g.pinned ? ' data-pinned="1"' : "") +
        (g.isValueGroup ? ' data-valuegroup="1"' : "") +
        ' data-state="' + gState + '">' +
        '<div class="ms-option ms-group-head' + (expandable ? "" : " ms-group-leaf") + '">' + triHtml +
        (expandable
          ? '<button type="button" class="ms-caret"' + (anyValueSet ? ' aria-expanded="true"' : "") + ">▸</button>"
          : '<span class="ms-caret ms-caret-empty"></span>') +
        '<span class="ms-option-label ms-group-label">' + escapeHtml(g.label) +
        '<span class="ms-count">' + g.count + "</span></span></div>" +
        (expandable ? '<div class="ms-group-values"' + (anyValueSet ? "" : " hidden") + ">" + bodyHtml + "</div>" : "") +
        "</div>";
    };
    const common = groups.filter((g) => g.pinned || g.count >= SZ_RARE_SETTING_MAX);
    const rare = groups.filter((g) => !g.pinned && g.count < SZ_RARE_SETTING_MAX);
    const rareHtml = rare.length
      ? '<div class="ms-rare"><button type="button" class="ms-caret ms-rare-caret">▸</button>' +
        '<span class="ms-rare-label">More settings (' + rare.length + ")</span>" +
        '<div class="ms-rare-body" hidden>' + rare.map(groupHtml).join("") + "</div></div>"
      : "";
    return '<div class="ms-dropdown" id="' + idPrefix + '">' +
      '<button type="button" class="ms-toggle" id="' + idPrefix + '-toggle">Settings</button>' +
      '<div class="ms-panel ms-panel-settings" id="' + idPrefix + '-panel" hidden>' +
      common.map(groupHtml).join("") + rareHtml +
      "</div></div>";
  }

  function wireSzSettingsDropdown(idPrefix, root, onChange) {
    const toggle = root.querySelector("#" + idPrefix + "-toggle");
    const panel = root.querySelector("#" + idPrefix + "-panel");
    const groups = Array.from(panel.querySelectorAll(".ms-group"));
    function selected() {
      const sel = { groups: [], values: {} };
      groups.forEach((g) => {
        const fields = g.dataset.fields.split("|");
        if (g.dataset.state !== "neutral") {
          sel.groups.push({
            key: g.dataset.key,
            fields: fields,
            isValueGroup: !!g.dataset.valuegroup,
            values: szGroupValueRefs(g),
            state: g.dataset.state,
          });
        }
        g.querySelectorAll(".ms-value").forEach((v) => {
          if (v.dataset.state === "neutral") return;
          const f = v.dataset.field;
          if (!sel.values[f]) sel.values[f] = { include: new Set(), exclude: new Set() };
          sel.values[f][v.dataset.state === "in" ? "include" : "exclude"].add(v.dataset.value);
        });
      });
      return sel;
    }

    // Counts shown next to each group and value are recomputed from the set
    // of problems the filter currently selects, not the whole corpus, so
    // they answer "how many of what I'm looking at" rather than a fixed
    // headline number. Zeros are greyed rather than hidden -- a value that
    // exists but has nothing left under the current filter is information.
    function refreshCounts(matchedIds) {
      const valueCounts = {}, groupCounts = {};
      const groupFields = groups.map((g) => ({
        key: g.dataset.key,
        fields: g.dataset.fields.split("|"),
        isValueGroup: !!g.dataset.valuegroup,
        values: szGroupValueRefs(g),
      }));
      // Value counts are tallied over the DISTINCT fields, not per group:
      // a field can belong to two groups at once (release time is both its
      // own group and half of Online), and counting inside the group loop
      // would then count each of its problems once per group.
      const allFields = Array.from(new Set([].concat.apply([], groupFields.map((g) => g.fields))));
      DATA_SZ.nodes.forEach((n) => {
        if (matchedIds && !matchedIds.has(n.id)) return;
        allFields.forEach((f) => {
          const v = szSettingValue(n, f);
          if (v) valueCounts[f + "|" + v] = (valueCounts[f + "|" + v] || 0) + 1;
        });
        groupFields.forEach((g) => {
          if (szGroupMatches(n, g)) groupCounts[g.key] = (groupCounts[g.key] || 0) + 1;
        });
      });
      groups.forEach((g) => {
        const gc = groupCounts[g.dataset.key] || 0;
        const gCountEl = g.querySelector(".ms-group-label .ms-count");
        gCountEl.textContent = gc;
        g.querySelector(".ms-group-head").classList.toggle("ms-zero", gc === 0);
        g.querySelectorAll(".ms-value").forEach((v) => {
          const c = valueCounts[v.dataset.field + "|" + v.dataset.value] || 0;
          v.querySelector(".ms-count").textContent = c;
          v.classList.toggle("ms-zero", c === 0);
          v.dataset.count = c;
        });
        g.dataset.count = gc;
      });
    }

    // Re-sorting happens when the panel OPENS, not on every count change:
    // the list is then always in most-common-first order whenever you look
    // at it, without rows sliding out from under the cursor mid-click while
    // switching values changes the counts.
    function sortByCount() {
      const byCount = (a, b) => (+b.dataset.count || 0) - (+a.dataset.count || 0);
      const containers = new Set(groups.map((g) => g.parentElement));
      containers.forEach((c) => {
        // insertBefore the "Rare settings" block, not appendChild: the rare
        // block is the panel's last child, so appending would file every
        // common group in after it.
        const tail = c.querySelector(":scope > .ms-rare");
        Array.from(c.querySelectorAll(":scope > .ms-group"))
          .sort(byCount)
          .forEach((g) => c.insertBefore(g, tail));
      });
      groups.forEach((g) => {
        const body = g.querySelector(".ms-group-values");
        if (!body) return; // a value group ("Online") is a leaf, nothing to sort
        Array.from(body.children).sort(byCount).forEach((v) => body.appendChild(v));
      });
    }
    function updateLabel() {
      const parts = [];
      groups.forEach((g) => {
        const name = g.querySelector(".ms-group-label").firstChild.textContent.trim();
        const vs = Array.from(g.querySelectorAll('.ms-value:not([data-state="neutral"])'));
        if (vs.length) {
          vs.forEach((v) => parts.push((v.dataset.state === "out" ? "−" : "") + v.dataset.value));
        } else if (g.dataset.state !== "neutral") {
          parts.push((g.dataset.state === "out" ? "no " : "") + name.toLowerCase());
        }
      });
      if (!parts.length) toggle.textContent = "Settings";
      else if (parts.length <= 2) toggle.textContent = parts.join(", ");
      else toggle.textContent = parts.length + " settings";
    }
    updateLabel();
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      root.querySelectorAll(".ms-panel").forEach((p) => (p.hidden = true));
      panel.hidden = !willOpen;
      if (willOpen) sortByCount();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => { panel.hidden = true; });

    function setState(el, state) {
      if (el.dataset.state === state) return;
      el.dataset.state = state;
      updateLabel();
      onChange(selected());
    }
    function wireTri(el) {
      el.querySelectorAll(":scope > .ms-option > .tri > .tri-seg, :scope > .tri > .tri-seg").forEach((seg) => {
        seg.addEventListener("click", (ev) => {
          ev.preventDefault();
          setState(el, seg.dataset.set);
        });
      });
    }
    function toggleExpand(caret, body) {
      const open = body.hidden;
      body.hidden = !open;
      caret.setAttribute("aria-expanded", open ? "true" : "false");
    }
    groups.forEach((g) => {
      wireTri(g);
      const caret = g.querySelector(".ms-caret");
      const body = g.querySelector(".ms-group-values");
      // The whole header row expands/collapses, not just the little caret
      // glyph -- a ~10px triangle is a miserable click target. The switch
      // sitting inside that row stops its own clicks from bubbling here, so
      // hitting -/./+ still only sets state.
      const head = g.querySelector(".ms-group-head");
      head.addEventListener("click", (ev) => {
        if (ev.target.closest(".tri") || !body) return;
        ev.preventDefault();
        toggleExpand(caret, body);
      });
      g.querySelectorAll(".ms-value").forEach((v) => {
        wireTri(v);
        v.querySelector(".ms-option-label").addEventListener("click", () => {
          setState(v, v.dataset.state === "in" ? "neutral" : "in");
        });
      });
    });
    // Every "More settings" block -- the panel-level one and the per-group
    // ones inside a value list -- gets the same expander behavior.
    panel.querySelectorAll(".ms-rare").forEach((block) => {
      const caret = block.querySelector(".ms-rare-caret");
      const body = block.querySelector(".ms-rare-body");
      if (!caret || !body) return;
      block.addEventListener("click", (ev) => {
        if (ev.target.closest(".ms-rare-body")) return; // a click on a value inside it
        ev.preventDefault();
        toggleExpand(caret, body);
      });
    });
    return { getSelected: selected, refreshCounts: refreshCounts };
  }

  function wireMsDropdown(idPrefix, root, placeholder, onChange, valueOf) {
    const toggle = root.querySelector("#" + idPrefix + "-toggle");
    const panel = root.querySelector("#" + idPrefix + "-panel");
    const rows = Array.from(panel.querySelectorAll(".ms-option"));
    function selected() {
      const include = new Set(), exclude = new Set();
      rows.forEach((r) => {
        if (r.dataset.state === "in") include.add(r.dataset.value);
        else if (r.dataset.state === "out") exclude.add(r.dataset.value);
      });
      return { include, exclude };
    }
    // Shows each switched option's own LABEL text (e.g. "Non-preemptive"),
    // not its raw value (e.g. "__none__", a sentinel that only means
    // something internally) -- read straight off the DOM rather than
    // needing a separate value->label map passed in. Excluded values are
    // shown with a leading "-" so the button says which way each one went.
    const labelOf = (row) => row.querySelector(".ms-option-label").firstChild.textContent.trim();
    function updateLabel() {
      const inRows = rows.filter((r) => r.dataset.state === "in");
      const outRows = rows.filter((r) => r.dataset.state === "out");
      if (!inRows.length && !outRows.length) {
        toggle.textContent = placeholder;
        return;
      }
      const parts = [];
      if (inRows.length && inRows.length <= 2) inRows.forEach((r) => parts.push(labelOf(r)));
      else if (inRows.length) parts.push(inRows.length + " required");
      if (outRows.length && outRows.length <= 2) outRows.forEach((r) => parts.push("−" + labelOf(r)));
      else if (outRows.length) parts.push(outRows.length + " excluded");
      toggle.textContent = parts.join(", ");
    }
    updateLabel();
    // Counts follow the current selection, and rows are re-sorted
    // most-common-first when the panel OPENS -- not on every change, so
    // nothing slides out from under the cursor mid-click. Same rules as the
    // settings panel; see refreshCounts/sortByCount there.
    function refreshCounts(matchedIds) {
      if (!valueOf) return;
      const counts = {};
      DATA_SZ.nodes.forEach((n) => {
        if (matchedIds && !matchedIds.has(n.id)) return;
        const v = valueOf(n);
        if (v !== undefined && v !== null) counts[v] = (counts[v] || 0) + 1;
      });
      rows.forEach((r) => {
        const c = counts[r.dataset.value] || 0;
        r.dataset.count = c;
        r.querySelector(".ms-count").textContent = c;
        r.classList.toggle("ms-zero", c === 0);
      });
    }
    function sortByCount() {
      Array.from(panel.children)
        .sort((a, b) => (+b.dataset.count || 0) - (+a.dataset.count || 0))
        .forEach((r) => panel.appendChild(r));
    }
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      root.querySelectorAll(".ms-panel").forEach((p) => (p.hidden = true));
      panel.hidden = !willOpen;
      if (willOpen) sortByCount();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => { panel.hidden = true; });

    function setState(row, state) {
      if (row.dataset.state === state) return;
      row.dataset.state = state;
      updateLabel();
      onChange(selected());
    }
    rows.forEach((row) => {
      row.querySelectorAll(".tri-seg").forEach((seg) => {
        seg.addEventListener("click", (e) => {
          e.preventDefault();
          setState(row, seg.dataset.set);
        });
      });
      // Clicking the label itself is the common case -- require <-> ignore --
      // so the usual "just pick these values" flow stays one click per value,
      // exactly like the checkboxes this replaced.
      row.querySelector(".ms-option-label").addEventListener("click", () => {
        setState(row, row.dataset.state === "in" ? "neutral" : "in");
      });
    });
    return { getSelected: selected, refreshCounts: refreshCounts };
  }

  // Color reuses this site's own 5-tier classicalClass model (P / weakly-
  // NP-hard / NP-hard-unresolved / strongly-NP-hard / unclaimed) -- the
  // SAME palette and fill/outline rules as every other map -- instead of
  // schedzoo's own flat binary lower/upper split. node.classicalClass is
  // computed once during conversion (see convert_for_pzoo.py) from
  // schedzoo's own cited bound text, using only its small set of clean
  // canonical phrases ("is in P", "is in Ppseudo", "is strongly NP-hard",
  // "is NP-hard"); it is decided from CLASSICAL results only ("X", no
  // bracket) -- never from a merged-in parameterized result ("X [y]") --
  // so a problem schedzoo never classified classically doesn't get
  // painted P/NP-hard just because someone studied a parameter of it.
  function szNodeStyle(classId) {
    const cc = classicalClassById(classId);
    const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
    const border = cc ? cc.color : "#868e96";
    const borderStyle = cc ? cc.border || "solid" : "solid";
    const textColor = cc && cc.fill ? fillTextColor(cc) : "var(--fg)";
    return "background:" + bg + ";border-color:" + border + ";border-style:" + borderStyle + ";color:" + textColor;
  }

  // Same DAG-inheritance principle as computeEffectiveClasses (used by every
  // other map on this site): a node with no direct classical citation we
  // could parse ("unclaimed") is not necessarily open -- if it strictly
  // generalizes a node we DID classify as hard, that hardness is a proven
  // mathematical fact (the general problem contains the specific one as an
  // instance), not a citation, so it should show up regardless. Reuses the
  // exact same strongerOf/inheritedContribution rules (strongly-NP-hard
  // transfers as-is; weakly-NP-hard's hardness half transfers but its
  // "admits a pseudo-poly algorithm" half does NOT, since that algorithm
  // doesn't automatically extend to the more general problem -- so it
  // downgrades to NP-hard-unresolved; P doesn't transfer at all). Kept as
  // its own copy (rather than reusing computeEffectiveClasses directly)
  // since it walks DATA_SZ's own id space/edges, not DATA.problems/map.edges.
  function computeEffectiveClassesForSz(nodes, edges) {
    const effective = {};
    const visiting = new Set();
    function resolve(id, cls) {
      if (effective[id] !== undefined) return effective[id];
      let result = cls[id];
      if ((!result || result === "unclaimed") && !visiting.has(id)) {
        visiting.add(id);
        let best = null;
        edges.forEach((e) => {
          if (e.from === id) {
            best = strongerOf(best, inheritedContribution(resolve(e.to, cls)));
          }
        });
        visiting.delete(id);
        if (best) result = best;
      }
      effective[id] = result;
      return result;
    }
    const cls = {};
    nodes.forEach((n) => { cls[n.id] = n.classicalClass; });
    nodes.forEach((n) => resolve(n.id, cls));
    return effective;
  }

  function renderSchedulingZoo() {
    if (!DATA_SZ) {
      els.viewSchedulingZoo.innerHTML = '<div class="map-page"><h2 class="page-title">Scheduling Zoo overview</h2><p class="design-intro">Loading…</p></div>';
      fetch("data/schedulingzoo.json")
        .then((r) => r.json())
        .then((data) => { DATA_SZ = data; renderSchedulingZoo(); })
        .catch((err) => {
          els.viewSchedulingZoo.innerHTML =
            '<div class="map-page"><h2 class="page-title">Scheduling Zoo overview</h2>' +
            '<p style="color:#c92a2a">Failed to load data/schedulingzoo.json: ' + escapeHtml(String(err)) + "</p></div>";
        });
      return;
    }

    // A full render bakes the currently-hidden ids into the fresh layout
    // (see `nodes` below) and starts a new undo/redo history -- the old
    // stacks refer to positions in a layout that's about to be discarded,
    // so "undo" from here on would mean recomputing the whole diagram
    // anyway, defeating the point of doing hides in place. See the
    // SZ_HIDDEN_STACK declaration up top.
    SZ_HIDDEN_STACK = [];
    SZ_HIDDEN_REDO_STACK = [];

    // Declutter mode (SZ_FOCUS_IDS set) restricts the whole layout to a
    // chosen subset of nodes/edges and enlarges everything to fill the
    // freed-up space -- same layout algorithm, just scoped and rescaled.
    // SZ_HIDDEN_IDS (individually dragged-out nodes) is subtracted on top of
    // that, but deliberately does NOT affect szScale -- hiding one stray
    // node from an otherwise-full graph shouldn't suddenly blow the whole
    // remaining ~700-node layout up to declutter's enlarged scale.
    const nodes = DATA_SZ.nodes.filter((n) => (!SZ_FOCUS_IDS || SZ_FOCUS_IDS.has(n.id)) && !SZ_HIDDEN_IDS.has(n.id));
    const edgesAll = DATA_SZ.edges.filter(
      (e) => (!SZ_FOCUS_IDS || (SZ_FOCUS_IDS.has(e.from) && SZ_FOCUS_IDS.has(e.to))) && !SZ_HIDDEN_IDS.has(e.from) && !SZ_HIDDEN_IDS.has(e.to)
    );
    const szScale = SZ_FOCUS_IDS ? 1.7 : 1;
    const nodeH = Math.round(SZ_NODE_H * szScale), rowH = Math.round(SZ_ROW_H * szScale);
    const margin = Math.round(SZ_MARGIN * szScale), colGap = Math.round(SZ_COL_GAP * szScale);
    const compGap = Math.round(22 * szScale);
    const fontPx = +(SZ_FONT_PX * szScale).toFixed(1);
    const minW = Math.round(SZ_MIN_NODE_W * szScale), maxW = Math.round(SZ_MAX_NODE_W * szScale);

    const ids = nodes.map((n) => n.id);
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    if (!SZ_EFFECTIVE) SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges);
    const szEffective = SZ_EFFECTIVE;

    const widthOf = {};
    ids.forEach((id) => {
      const w = measureTextWidthPx(byId[id].notation, fontPx) + 14;
      widthOf[id] = Math.min(maxW, Math.max(minW, Math.ceil(w)));
    });

    // Most of this graph is NOT one connected lattice -- of 767 problems,
    // 269 have no reduction edge to or from any other node in this corpus
    // at all, and the rest split into many small clusters. A single global
    // longest-path layering therefore piles hundreds of unrelated roots
    // into row 0, producing a diagram tens of thousands of pixels wide and
    // a few hundred tall. Instead: lay out each connected component on its
    // own (same row/col algorithm as every other map on this site, just
    // scoped to that component), then pack the resulting boxes into a
    // roughly square mosaic -- a simple shelf/bin packer, sorted largest
    // first.
    const adj = {};
    ids.forEach((id) => (adj[id] = new Set()));
    edgesAll.forEach((e) => { adj[e.from].add(e.to); adj[e.to].add(e.from); });
    const seen = new Set();
    const components = [];
    ids.forEach((start) => {
      if (seen.has(start)) return;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const u = stack.pop();
        comp.push(u);
        adj[u].forEach((v) => { if (!seen.has(v)) { seen.add(v); stack.push(v); } });
      }
      components.push(comp);
    });

    const pos = {};
    const boxes = components.map((comp) => {
      const compSet = new Set(comp);
      const compEdges = edgesAll.filter((e) => compSet.has(e.from) && compSet.has(e.to));
      const { row, col } = layoutDag(comp, compEdges);
      const maxCol = Math.max(0, ...comp.map((id) => col[id]));
      const maxRow = Math.max(0, ...comp.map((id) => row[id]));
      const colWidth = {};
      for (let c = 1; c <= maxCol; c++) {
        colWidth[c] = Math.max(0, ...comp.filter((id) => col[id] === c).map((id) => widthOf[id]));
      }
      const colX = {};
      colX[1] = 0;
      for (let c = 2; c <= maxCol; c++) colX[c] = colX[c - 1] + colWidth[c - 1] + colGap;
      comp.forEach((id) => {
        const w = widthOf[id];
        pos[id] = {
          left: colX[col[id]] + (colWidth[col[id]] - w) / 2,
          top: row[id] * rowH,
          w, h: nodeH,
        };
      });
      return {
        comp,
        width: (maxCol ? colX[maxCol] + colWidth[maxCol] : widthOf[comp[0]]),
        height: maxRow * rowH + nodeH,
      };
    });

    boxes.sort((a, b) => b.comp.length - a.comp.length || b.width * b.height - a.width * a.height);
    const totalArea = boxes.reduce((s, b) => s + b.width * b.height, 0);
    const targetWidth = Math.max(1200, Math.sqrt(totalArea * 2.2));
    let shelfX = 0, shelfY = 0, shelfH = 0, usedWidth = 0;
    boxes.forEach((box) => {
      if (shelfX > 0 && shelfX + box.width > targetWidth) {
        shelfY += shelfH + compGap;
        shelfX = 0;
        shelfH = 0;
      }
      box.comp.forEach((id) => {
        pos[id].left += shelfX + margin;
        pos[id].top += shelfY + margin;
      });
      shelfX += box.width + compGap;
      shelfH = Math.max(shelfH, box.height);
      usedWidth = Math.max(usedWidth, shelfX - compGap);
    });
    const canvasWidth = usedWidth + margin * 2;
    const canvasHeight = shelfY + shelfH + margin * 2;

    ids.forEach((id) => {
      const p = pos[id];
      p.cx = p.left + p.w / 2;
      p.cy = p.top + p.h / 2;
      p.halfW = p.w / 2;
      p.halfH = p.h / 2;
    });

    // One marker per edge color, each one's fill written from the SAME
    // color value the line's stroke is written from (szEdgeStroke below),
    // so an arrowhead cannot drift out of sync with its own line.
    //
    // This previously used a single marker with fill="context-stroke",
    // which is the elegant version -- but that renders as the default
    // BLACK here even though CSS.supports() claims to accept it, leaving
    // every arrowhead black regardless of its line. Three explicit markers
    // is duller and actually works.
    const arrowDef =
      "<defs>" +
      SZ_EDGE_COLORS.map(
        (c) =>
          '<marker id="' + szArrowIdFor(c) + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" ' +
          'markerHeight="7" orient="auto-start-reverse">' +
          '<path d="' + STEALTH_ARROW_PATH + '" fill="' + c + '" /></marker>'
      ).join("") +
      "</defs>";

    const linesSvg = edgesAll
      .map((e) => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return "";
        const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, b.halfW, b.halfH, 3);
        const flagged = szFlaggedEdgeFor(e.from, e.to);
        // Green = an edge that exists ONLY because of OUR added "number of
        // machines" reduction rule (see OUR_MACHINE_COUNT_RULES in
        // convert_for_pzoo.py) -- schedzoo's own data never implied it.
        // Never both flagged and ours: we only ever add edges we've checked
        // are sound (see the data note below), unlike the one flagged edge.
        const stroke = szEdgeStroke(e, flagged);
        const dash = flagged ? ' stroke-dasharray="6,3"' : "";
        // Two lines per edge: a wide, invisible one (easy hover/click target
        // -- the visible line alone is too thin to reliably point at) behind
        // the actual visible arrow. A shared <title> on the wrapping <g>
        // gives a hover tooltip; a click opens the full explanation (see
        // openSchedulingZooEdgePanel) -- what field(s) differ and why that
        // counts as a generalization, in schedzoo's own field-choice text.
        const fromAttr = 'data-sz-from="' + escapeHtml(e.from) + '" data-sz-to="' + escapeHtml(e.to) + '"';
        return '<g class="sz-edge" ' + fromAttr + '>' +
          "<title>" + escapeHtml(szEdgeSummary(e, flagged)) + "</title>" +
          '<line class="sz-edge-hit" ' + fromAttr + ' x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y + '" />' +
          '<line class="sz-edge-visible" ' + fromAttr + ' x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y +
          '" stroke="' + stroke + '" stroke-width="' + (flagged ? "2.6" : "2") + '"' + dash +
          ' marker-end="url(#' + szArrowIdFor(stroke) + ')" />' +
          "</g>";
      })
      .join("");

    const nodesHtml = nodes
      .map((n) => {
        const p = pos[n.id];
        return '<a class="map-node sz-node" data-sz-id="' + escapeHtml(n.id) + '" data-sz-notation="' +
          escapeHtml(n.notation.toLowerCase()) + '" data-sz-objective="' +
          escapeHtml(canonicalSzObjective(n.objective)) + '" data-sz-preemption="' + escapeHtml(n.preemption || "__none__") +
          '" data-sz-machine-env="' + escapeHtml(n.machineEnv || "") +
          '" href="javascript:void(0)" title="' +
          escapeHtml(n.notation) + '" style="left:' + p.left + "px;top:" + p.top + "px;width:" + p.w +
          "px;height:" + p.h + "px;font-size:" + fontPx + "px;" + szNodeStyle(szEffective[n.id]) + '">' +
          escapeHtml(n.notation) + "</a>";
      })
      .join("");

    // Built from the FULL corpus (DATA_SZ.nodes), not the possibly-
    // decluttered `nodes` -- otherwise, once the view narrows to a filtered
    // subset, these dropdowns would only ever offer the values already
    // showing, making it impossible to check a box for anything outside
    // the current view and so impossible to ever widen an applied filter.
    // Counted and ordered most-common-first, like the settings menu -- the
    // counts are refreshed against the current selection once wired (see
    // refreshCounts in wireMsDropdown), this is just the initial state.
    const objectiveCounts = {};
    DATA_SZ.nodes.forEach((n) => {
      const o = canonicalSzObjective(n.objective);
      if (o) objectiveCounts[o] = (objectiveCounts[o] || 0) + 1;
    });
    const objectiveOptions = Object.keys(objectiveCounts)
      .map((o) => ({ value: o, label: o, count: objectiveCounts[o] }))
      .sort((a, b) => b.count - a.count);

    // Short dropdown labels + full hover text straight from schedzoo's own
    // notation.xml <choice explanation=...> for the "type" field -- see
    // machineEnvExplanations in data/schedulingzoo.json.
    const machineEnvLabels = { 1: "1 — single machine", P: "P — parallel identical machines", Q: "Q — uniform/related machines", R: "R — unrelated machines", O: "O — open shop", F: "F — flow shop", J: "J — job shop" };
    const machineEnvExpl = DATA_SZ.machineEnvExplanations || {};
    const machineEnvCounts = {};
    DATA_SZ.nodes.forEach((n) => {
      if (n.machineEnv) machineEnvCounts[n.machineEnv] = (machineEnvCounts[n.machineEnv] || 0) + 1;
    });
    const machineEnvOptions = Object.keys(machineEnvCounts)
      .map((v) => ({
        value: v,
        label: machineEnvLabels[v] || v,
        title: machineEnvExpl[v] || "",
        count: machineEnvCounts[v],
      }))
      .sort((a, b) => b.count - a.count);

    const prevFilters = SZ_LAST_FILTERS || {};
    const machineEnvDropdownHtml = buildMsDropdownHtml("sz-ms-machine-env", "Machine Environment", machineEnvOptions, prevFilters.machineEnv);
    const objectiveDropdownHtml = buildMsDropdownHtml("sz-ms-objective", "Objective", objectiveOptions, prevFilters.objective);
    const settingsDropdownHtml = buildSzSettingsHtml("sz-settings", szSettingGroups(), prevFilters.settings);

    const szUsedClasses = new Set(nodes.map((n) => szEffective[n.id]));
    const szClassLegendHtml = DATA.classicalClasses
      .filter((c) => szUsedClasses.has(c.id))
      .map(
        (c) =>
          '<div class="legend-item"><span class="legend-swatch" style="background:' +
          (c.fill ? c.color : "transparent") + ";border:2px " + (c.border || "solid") + " " + c.color +
          '"></span><span>' + escapeHtml(c.id === "unclaimed" ? "open" : c.label) + "</span></div>"
      )
      .join("");

    // Looked up from DATA_SZ.nodes (not the possibly-decluttered `nodes`),
    // so this section always lists every flagged edge regardless of the
    // current filter/focus state.
    const szAllById = {};
    DATA_SZ.nodes.forEach((n) => { szAllById[n.id] = n; });
    const szAnomaliesHtml = SZ_FLAGGED_EDGES.length || SZ_DATA_NOTES.length
      ? '<div class="map-excluded"><h3>Known data anomalies in schedzoo</h3>' +
        "<p>Things we spot-checked and found inconsistent, or noteworthy gaps, in schedzoo's own data. Where it's " +
        "a specific edge, it's marked red/dashed above. schedzoo's source files are left exactly as-is. " +
        "Two things change how we READ them, both explained below: a single confirmed typo our classifier " +
        "tolerates, and their setup-time reduction rules under a single server, which we replace with a " +
        "corrected version.</p>" +
        "<ul>" +
        SZ_FLAGGED_EDGES.map((f) => {
          const from = szAllById[f.from], to = szAllById[f.to];
          return "<li><p style='margin:0 0 0.3rem'><b>" + escapeHtml(from ? from.notation : f.from) +
            "</b> &rarr; <b>" + escapeHtml(to ? to.notation : f.to) + "</b></p>" +
            "<p style='margin:0'>" + escapeHtml(f.note) + "</p></li>";
        }).join("") +
        SZ_DATA_NOTES.map((n) =>
          "<li><p style='margin:0 0 0.3rem'><b>" + escapeHtml(n.title) + "</b></p>" +
          "<p style='margin:0'>" + escapeHtml(n.body) + "</p></li>"
        ).join("") +
        "</ul></div>"
      : "";

    els.viewSchedulingZoo.innerHTML =
      '<div class="map-page">' +
      '<h2 class="page-title">Scheduling Zoo overview</h2>' +
      '<p class="design-intro">Every base problem that appears in a result somewhere in ' +
      '<a href="https://schedulingzoo.lip6.fr/" target="_blank" rel="noopener">schedulingzoo.lip6.fr</a>\'s ' +
      "own bibliography (" + DATA_SZ.nodes.length + " problems, " + DATA_SZ.edges.length + " generalization edges), " +
      "laid out and colored in this site's style. Schedzoo records a parameterized result (e.g. \"[m]\") as a " +
      "field on the SAME problem vector as the base problem -- so \"X\" and \"X [y]\" are merged back into one " +
      "node here, with every \"[y]\" result attached as a parameterized result on that node instead of floating " +
      "as its own disconnected, misleadingly-colored node. <b>These results are imported as-is, not " +
      "independently verified by this site</b> -- click a node for its citations and links to the original " +
      "source. Color uses this site's own classical-complexity model (see legend below), inferred from " +
      "schedzoo's own cited bound text -- schedzoo itself only tags results \"positive\" or \"negative\" by " +
      "keyword, with no P / weakly-NP-hard / strongly-NP-hard distinction, so this is our own reading of their " +
      "text, not a category schedzoo assigns itself. A node with no direct classical citation we could parse " +
      "still inherits hardness through the generalization edges below it, exactly like every other map on " +
      "this site: if it strictly generalizes a node proven NP-hard, that hardness is a mathematical " +
      "consequence (the general problem contains the specific one as an instance), not a citation, so it's " +
      "shown regardless. Only \"no direct claim\" (open) means neither a direct nor an inherited classical " +
      "claim exists here -- open a node to see the difference and its parameterized results.</p>" +
      "<p class=\"design-intro\">Arrows: hover for a quick summary, click for the full explanation of why it " +
      "exists (which field differs and what schedzoo says both values mean). Gray = schedzoo's own reduction " +
      "graph. <span style='color:#cf4444'>Red/dashed</span> = flagged as internally inconsistent (see " +
      "\"Known data anomalies\" at the bottom). <span style='color:#2c8a3f'>Green</span> = added by this site, " +
      "not schedzoo's own data (also explained at the bottom).</p>" +
      '<div class="sz-filters">' +
      '<input type="text" id="sz-filter" class="sz-filter" placeholder="Filter by notation, e.g. Cmax, pmtn, #p…">' +
      // Graham's alpha|beta|gamma order, with his separators drawn between
      // them: machine environment | constraints | objective.
      machineEnvDropdownHtml +
      '<span class="sz-field-sep">|</span>' +
      settingsDropdownHtml +
      '<span class="sz-field-sep">|</span>' +
      objectiveDropdownHtml +
      '<button type="button" id="sz-reset-filters-btn" class="map-history-btn sz-reset-filters-btn"' +
      ' title="Clear the text box and every switch, and show the full graph again">↺ Reset filters</button>' +
      "</div>" +
      '<div class="map-diagram">' +
      // Always start disabled: a full render (this one included) always
      // clears SZ_HIDDEN_STACK/SZ_HIDDEN_REDO_STACK above, since neither
      // stack means anything against a layout that's just been discarded
      // and rebuilt from scratch.
      '<div class="map-history-controls">' +
      '<button type="button" id="sz-undo-btn" class="map-history-btn" disabled title="Undo the last node hidden by dragging">↶ Undo</button>' +
      '<button type="button" id="sz-redo-btn" class="map-history-btn" disabled title="Redo the last undone hide">↷ Redo</button>' +
      '<button type="button" id="sz-reset-hidden-btn" class="map-history-btn" disabled title="Bring back every node hidden by dragging off the edge (does not touch the filters)">↺ Restore hidden</button>' +
      "</div>" +
      '<button type="button" class="tikz-export-btn" title="Copy this diagram as TikZ code">⧉ TikZ</button>' +
      '<button type="button" class="auto-arrange-btn" title="Recompute node positions from scratch">⇄ Auto-arrange</button>' +
      // Two idempotent buttons, not a toggle -- each always does exactly
      // one thing regardless of current state, so there's no click whose
      // meaning depends on hidden state to track: Apply always narrows to
      // whatever the filters above say right now (disabled when that would
      // be a no-op -- matches nothing, or matches everything already);
      // Show all always clears back to the full graph (disabled when
      // that's already the case). Which one is enabled says, at a glance,
      // whether the filter is currently on.
      '<div class="sz-filter-controls">' +
      '<button type="button" id="sz-apply-filter-btn" class="map-history-btn" disabled ' +
      'title="Show only the nodes currently matching the filters above, enlarged">⊙ Apply filter</button>' +
      '<button type="button" id="sz-show-all-btn" class="map-history-btn"' + (SZ_FOCUS_IDS ? "" : " disabled") +
      ' title="Go back to showing the full graph">↺ Show all</button>' +
      "</div>" +
      '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + canvasWidth + "px;height:" + canvasHeight + 'px">' +
      '<svg class="map-edge-svg" width="' + canvasWidth + '" height="' + canvasHeight + '">' + arrowDef + linesSvg + "</svg>" +
      nodesHtml +
      "</div></div>" +
      "</div>" +
      '<p class="map-hint"><span class="map-hint-icon">i</span> Drag a node past the diagram\'s edge to hide it, ' +
      "along with its edges, from this view only -- nothing in the underlying data changes. Undo / Redo / " +
      "Restore hidden (top-left of the diagram) step through or undo those hides. \"Apply filter\" / \"Show all\" (top-right) " +
      "is a separate, search-based view of just the currently-matching nodes -- Apply always narrows to whatever " +
      "the filters above say right now, Show all always goes back to everything.</p>" +
      '<div class="map-legend">' + szClassLegendHtml + "</div>" +
      szAnomaliesHtml +
      "</div>";

    setTimeout(() => fitMapCanvasToWidth(els.viewSchedulingZoo), 0);

    enableSzNodeDragging(els.viewSchedulingZoo.querySelector(".map-canvas"));

    // Click on an edge (either its thin visible line or its wide invisible
    // hit-area, both tagged the same way) opens the full "why does this
    // arrow exist" panel. Delegated once on the svg rather than per-edge --
    // this graph can have hundreds of edges.
    els.viewSchedulingZoo.querySelector(".map-edge-svg").addEventListener("click", (ev) => {
      const g = ev.target.closest(".sz-edge");
      if (!g) return;
      openSchedulingZooEdgePanel(g.dataset.szFrom, g.dataset.szTo);
    });

    // Auto-arrange: there's no persisted row/col to recompute in place (this
    // view lays out fresh from DATA_SZ every render, unlike the hand-curated
    // maps), so "recompute" is just "render again" -- which discards any
    // manual dragging and snaps back to the computed layout, same effect as
    // the regular maps' button.
    els.viewSchedulingZoo.querySelector(".auto-arrange-btn").addEventListener("click", () => {
      saveSzFilterState();
      renderSchedulingZoo();
    });

    els.viewSchedulingZoo.querySelector(".tikz-export-btn").addEventListener("click", (e) => {
      const tikzBtn = e.currentTarget;
      const canvas = els.viewSchedulingZoo.querySelector(".map-canvas");
      const livePositions = {};
      // Nodes hidden in place (dragged off the edge, since this render) are
      // display:none but still in the DOM -- SZ_HIDDEN_IDS is the live
      // source of truth for what's actually currently shown, so both the
      // exported node/edge lists AND their positions are filtered by it.
      canvas.querySelectorAll(".sz-node").forEach((el) => {
        if (SZ_HIDDEN_IDS.has(el.dataset.szId)) return;
        const left = parseFloat(el.style.left), top = parseFloat(el.style.top);
        const w = el.offsetWidth, h = el.offsetHeight;
        livePositions[el.dataset.szId] = { left, top, w, h, cx: left + w / 2, cy: top + h / 2 };
      });
      const visibleNodes = nodes.filter((n) => !SZ_HIDDEN_IDS.has(n.id));
      const visibleEdges = edgesAll.filter((ed) => !SZ_HIDDEN_IDS.has(ed.from) && !SZ_HIDDEN_IDS.has(ed.to));
      const code = szMapToTikzCode(visibleNodes, visibleEdges, livePositions, szEffective);
      const original = tikzBtn.textContent;
      copyTextToClipboard(code)
        .then(() => { tikzBtn.textContent = "Copied!"; })
        .catch(() => { tikzBtn.textContent = "Copy failed — see console"; console.log(code); })
        .then(() => setTimeout(() => { tikzBtn.textContent = original; }, 1800));
    });

    const filterInput = els.viewSchedulingZoo.querySelector("#sz-filter");
    if (SZ_LAST_FILTERS) filterInput.value = SZ_LAST_FILTERS.q || "";
    // Each dropdown is a multi-select checkbox popover, not a plain <select>,
    // so several values can be picked at once (e.g. "F" + "F2" + "J").
    // Empty selection means "no filter" for that dropdown, same as the old
    // blank "All ..." option did.
    const machineEnvMs = wireMsDropdown("sz-ms-machine-env", els.viewSchedulingZoo, "Machine Environment", updateSzFilterButtons, (n) => n.machineEnv || "");
    const objectiveMs = wireMsDropdown("sz-ms-objective", els.viewSchedulingZoo, "Objective", updateSzFilterButtons, (n) => canonicalSzObjective(n.objective));
    const settingsMs = wireSzSettingsDropdown("sz-settings", els.viewSchedulingZoo, updateSzFilterButtons);
    szSettingsControl = settingsMs;
    szValueDropdowns = [machineEnvMs, objectiveMs];

    // Returns the matching id set AND applies the dim class to both nodes
    // and their edges -- an edge is only fully "active" when BOTH ends are,
    // so a filtered-out node doesn't leave its arrows looking like they
    // point at nothing. Also reused by the Apply filter button to know
    // which ids to show.
    //
    // Matches are computed against the FULL corpus (DATA_SZ.nodes), not by
    // scanning whatever .sz-node elements currently happen to be in the
    // DOM. Once the view is decluttered down to a filtered subset, only
    // that handful of elements exists at all -- scoping the search to them
    // would mean a newly-checked filter box could only ever "find" nodes
    // that were already visible, making it impossible to widen a filter
    // that's already applied. The dim/undim styling below still only
    // touches whatever IS currently rendered, same as before -- that part
    // doesn't need the full corpus.
    function currentSzMatches() {
      const q = filterInput.value.trim().toLowerCase();
      const machineEnvSel = machineEnvMs.getSelected();
      const objSel = objectiveMs.getSelected();
      const settingsSel = settingsMs.getSelected();
      const matched = new Set();
      DATA_SZ.nodes.forEach((n) => {
        const match =
          szNodeMatchesQuery(n, q) &&
          msSelectionAccepts(machineEnvSel, n.machineEnv || "") &&
          msSelectionAccepts(objSel, canonicalSzObjective(n.objective)) &&
          szNodeMatchesSettings(n, settingsSel);
        if (match) matched.add(n.id);
      });
      els.viewSchedulingZoo.querySelectorAll(".sz-node").forEach((el) => {
        el.classList.toggle("sz-node-dim", !matched.has(el.dataset.szId));
      });
      els.viewSchedulingZoo.querySelectorAll(".map-edge-svg line[data-sz-from]").forEach((line) => {
        const active = matched.has(line.dataset.szFrom) && matched.has(line.dataset.szTo);
        line.classList.toggle("sz-edge-dim", !active);
      });
      return matched;
    }

    // Apply filter and Show all are each idempotent -- always do the same
    // one thing regardless of current state -- rather than a toggle whose
    // meaning depends on tracking whether the filter is already on. This
    // keeps the Apply button's enabled state honest as the filter inputs
    // change, WITHOUT re-applying anything on its own (unlike live-sync):
    // Apply only takes effect when actually clicked.
    function updateSzFilterButtons() {
      const matched = currentSzMatches();
      const applyBtn = els.viewSchedulingZoo.querySelector("#sz-apply-filter-btn");
      if (applyBtn) applyBtn.disabled = !matched.size || matched.size === DATA_SZ.nodes.length;
      // Settings counts follow the current selection (see refreshCounts).
      // Read through a plain `let` rather than testing the `const` above:
      // this function is wired as a callback before that const is
      // initialised, and `typeof` on a const still in its temporal dead
      // zone throws rather than returning "undefined".
      if (szSettingsControl) szSettingsControl.refreshCounts(matched);
      if (szValueDropdowns) szValueDropdowns.forEach((d) => d.refreshCounts(matched));
      return matched;
    }
    filterInput.addEventListener("input", updateSzFilterButtons);

    // A re-render rebuilds the filter controls from SZ_LAST_FILTERS, so
    // ANY code path that re-renders has to save the LIVE control state
    // first -- otherwise the switches snap back to whatever was saved the
    // last time Apply was pressed, silently undoing changes made since.
    function saveSzFilterState() {
      SZ_LAST_FILTERS = {
        q: filterInput.value,
        machineEnv: machineEnvMs.getSelected(),
        objective: objectiveMs.getSelected(),
        settings: settingsMs.getSelected(),
      };
    }

    els.viewSchedulingZoo.querySelector("#sz-apply-filter-btn").addEventListener("click", () => {
      const matched = currentSzMatches();
      if (!matched.size || matched.size === DATA_SZ.nodes.length) return; // nothing meaningful to filter down to
      SZ_FOCUS_IDS = matched;
      saveSzFilterState();
      renderSchedulingZoo();
    });
    // Deliberately never touches SZ_HIDDEN_IDS -- undoing a drag-hide is
    // the dedicated Undo / Redo / Restore-hidden cluster's job (see szResetHidden), not
    // this button's. It does keep the filter controls exactly as they are:
    // "show every problem again" is about the diagram, not about throwing
    // away switches the user has just set.
    // Clears every filter control AND the applied subset -- "reset the
    // filters" would be a half-truth if the diagram stayed narrowed to a
    // set the now-empty controls no longer describe. Drag-hidden nodes are
    // left alone; those belong to Undo / Redo / Restore hidden, not to the filters.
    els.viewSchedulingZoo.querySelector("#sz-reset-filters-btn").addEventListener("click", () => {
      SZ_LAST_FILTERS = null;
      SZ_FOCUS_IDS = null;
      renderSchedulingZoo();
    });
    els.viewSchedulingZoo.querySelector("#sz-show-all-btn").addEventListener("click", () => {
      if (!SZ_FOCUS_IDS) return;
      SZ_FOCUS_IDS = null;
      saveSzFilterState();
      renderSchedulingZoo();
    });
    updateSzFilterButtons();

    els.viewSchedulingZoo.querySelector("#sz-undo-btn").addEventListener("click", szUndoHide);
    els.viewSchedulingZoo.querySelector("#sz-redo-btn").addEventListener("click", szRedoHide);
    els.viewSchedulingZoo.querySelector("#sz-reset-hidden-btn").addEventListener("click", szResetHidden);
  }

  // Toggles one node (and every edge touching it) between shown and hidden
  // by adding/removing a CSS class, in place -- no re-render, so every OTHER
  // node's position is left completely alone. Undo/redo below rely on this
  // for exact, jitter-free restoration (the dragged node's own left/top are
  // snapped back to their pre-drag position before hiding it -- see
  // enableSzNodeDragging -- so showing it again puts it right back where it
  // was, edges included).
  function setSzNodeHidden(canvas, id, hidden) {
    if (!canvas) return;
    const nodeEl = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(id) + '"]');
    if (nodeEl) nodeEl.classList.toggle("node-hidden", hidden);
    canvas
      .querySelectorAll('.sz-edge[data-sz-from="' + cssEscape(id) + '"], .sz-edge[data-sz-to="' + cssEscape(id) + '"]')
      .forEach((g) => g.classList.toggle("node-hidden", hidden));
  }

  function szUpdateHistoryButtons() {
    const undoBtn = els.viewSchedulingZoo.querySelector("#sz-undo-btn");
    const redoBtn = els.viewSchedulingZoo.querySelector("#sz-redo-btn");
    const resetBtn = els.viewSchedulingZoo.querySelector("#sz-reset-hidden-btn");
    if (undoBtn) undoBtn.disabled = !SZ_HIDDEN_STACK.length;
    if (redoBtn) redoBtn.disabled = !SZ_HIDDEN_REDO_STACK.length;
    if (resetBtn) resetBtn.disabled = !SZ_HIDDEN_IDS.size;
  }

  function szUndoHide() {
    if (!SZ_HIDDEN_STACK.length) return;
    const id = SZ_HIDDEN_STACK.pop();
    SZ_HIDDEN_IDS.delete(id);
    SZ_HIDDEN_REDO_STACK.push(id);
    setSzNodeHidden(els.viewSchedulingZoo.querySelector(".map-canvas"), id, false);
    szUpdateHistoryButtons();
  }

  function szRedoHide() {
    if (!SZ_HIDDEN_REDO_STACK.length) return;
    const id = SZ_HIDDEN_REDO_STACK.pop();
    SZ_HIDDEN_IDS.add(id);
    SZ_HIDDEN_STACK.push(id);
    setSzNodeHidden(els.viewSchedulingZoo.querySelector(".map-canvas"), id, true);
    szUpdateHistoryButtons();
  }

  // Restores every node hidden on the CURRENT layout at once, in place --
  // same reasoning as mapResetHidden: no re-render, so nothing else moves,
  // and it clears the redo stack (this is "start over", not "keep
  // stepping back"). Separate from the top-right Filter toggle, which only
  // concerns the search-based subset (SZ_FOCUS_IDS).
  function szResetHidden() {
    if (!SZ_HIDDEN_STACK.length) return;
    const canvas = els.viewSchedulingZoo.querySelector(".map-canvas");
    SZ_HIDDEN_STACK.forEach((id) => setSzNodeHidden(canvas, id, false));
    SZ_HIDDEN_IDS = new Set();
    SZ_HIDDEN_STACK = [];
    SZ_HIDDEN_REDO_STACK = [];
    szUpdateHistoryButtons();
  }

  // "Why does this arrow exist?" -- shows both endpoints' notation and every
  // core field that differs between them, each with schedzoo's OWN
  // explanation text for both the general and the specific value (see
  // edge.diffs, computed once in convert_for_pzoo.py from notation.xml's
  // own <choice explanation=...> attributes -- not our own description).
  function openSchedulingZooEdgePanel(fromId, toId) {
    const from = DATA_SZ.nodes.find((n) => n.id === fromId);
    const to = DATA_SZ.nodes.find((n) => n.id === toId);
    const edge = DATA_SZ.edges.find((e) => e.from === fromId && e.to === toId);
    if (!from || !to || !edge) return;
    const flagged = szFlaggedEdgeFor(fromId, toId);
    const diffs = edge.diffs || [];

    function diffLi(d) {
      return "<li style='margin-bottom:0.6rem'><p style='margin:0 0 0.3rem'><b>" + escapeHtml(d.field) + "</b></p>" +
        "<p style='margin:0 0 0.2rem'><b>general:</b> " + escapeHtml(d.generalValue || "(none)") +
        (d.generalExplanation ? " — " + escapeHtml(d.generalExplanation) : "") + "</p>" +
        "<p style='margin:0'><b>specific:</b> " + escapeHtml(d.specificValue || "(none)") +
        (d.specificExplanation ? " — " + escapeHtml(d.specificExplanation) : "") + "</p></li>";
    }

    els.detailContent.innerHTML =
      "<h3>" + escapeHtml(from.notation) + " <span style='color:var(--muted);font-weight:400'>generalizes</span> " +
      escapeHtml(to.notation) + "</h3>" +
      '<p class="wiki-alphabetagamma" style="margin-top:-0.5rem">' +
      (edge.addedByUs
        ? "from a reduction rule <b>this site added</b> (not schedzoo's own data -- see the green note below)"
        : "from <a href=\"https://schedulingzoo.lip6.fr/\" target=\"_blank\" rel=\"noopener\">schedulingzoo.lip6.fr</a>'s own reduction graph (their notation.xml &lt;reduction&gt; declarations)") +
      " -- this arrow means every " + escapeHtml(to.notation) +
      " instance can be viewed as a " + escapeHtml(from.notation) + " instance with the same answer.</p>" +
      (flagged
        ? '<div class="detail-field" style="border-left:3px solid #cf4444;padding-left:0.7rem">' +
          "<h4 style='color:#cf4444'>⚠ Flagged as inconsistent</h4><p style='margin:0'>" + escapeHtml(flagged.note) + "</p></div>"
        : "") +
      (edge.addedByUs
        ? '<div class="detail-field" style="border-left:3px solid #2c8a3f;padding-left:0.7rem">' +
          "<h4 style='color:#2c8a3f'>✚ Added by this site</h4><p style='margin:0'>" + escapeHtml(edge.addedBy === "s1-setup" ? SZ_S1_SETUP_NOTE : SZ_MACHINE_COUNT_RULE_NOTE) + "</p></div>"
        : "") +
      '<div class="detail-field"><h4>' + diffs.length + " differing field" + (diffs.length === 1 ? "" : "s") + "</h4>" +
      "<ul class='result-list'>" + diffs.map(diffLi).join("") + "</ul></div>";
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    setPanelMinWidth(0);
  }

  function openSchedulingZooPanel(nodeId) {
    const n = DATA_SZ.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    function resultLi(r) {
      const cite = escapeHtml(r.author || "") + (r.year ? " (" + escapeHtml(r.year) + ")" : "");
      const titleHtml = r.url
        ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.title || "") + "</a>"
        : escapeHtml(r.title || "");
      return "<li><p style='margin:0 0 0.2rem'>" + escapeHtml(r.bound) + "</p>" +
        "<p style='margin:0;color:var(--muted);font-size:0.85rem'>" + cite + (r.title ? " — " + titleHtml : "") + "</p></li>";
    }
    const lower = n.classical.filter((r) => r.kind === "lower");
    const upper = n.classical.filter((r) => r.kind === "upper");
    const forest = buildParamForest(n.params);
    const paramTreeHtml = buildParamTreeHtml(forest, resultLi);
    const paramDiagram = buildParamDiagramHtml(forest);
    const paramUsedClasses = new Set(forest.labels.map((l) => bestParamComplexityClass(forest.byLabel[l])).filter(Boolean));
    const paramLegendHtml = paramUsedClasses.size
      ? '<p style="margin:0.4rem 0 0;font-size:0.8rem">' +
        DATA.complexityClasses.filter((c) => paramUsedClasses.has(c.id)).map((c) =>
          '<span style="margin-right:0.8rem"><span class="legend-swatch" style="width:0.7em;height:0.7em;display:inline-block;border-radius:2px;vertical-align:middle;margin-right:0.3em;' +
          "background:" + (c.opacity ? mixWithPanelBg(c.color, c.opacity) : c.fill ? c.color : "var(--panel-bg)") +
          ";border:1.5px " + (c.border || "solid") + " " + c.color + '"></span>' + escapeHtml(c.label) + "</span>"
        ).join("") + "</p>"
      : "";
    if (!SZ_EFFECTIVE) SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges);
    const isDirect = n.classicalClass && n.classicalClass !== "unclaimed";
    const effClassId = SZ_EFFECTIVE[n.id];
    const cc = classicalClassById(effClassId);
    const ccLabel = !effClassId || effClassId === "unclaimed" ? "open" : (cc ? cc.label : effClassId);
    const ccPillHtml = '<span class="class-pill" style="' + classPillStyle(cc) + '">' + escapeHtml(ccLabel) + "</span>" +
      (!isDirect && effClassId && effClassId !== "unclaimed"
        ? ' <span style="color:var(--muted);font-size:0.8rem">(inherited: generalizes at least one node in this graph classified ' + escapeHtml(cc ? cc.label : effClassId) + ")</span>"
        : "");

    const machineEnvExpl = (DATA_SZ.machineEnvExplanations || {})[n.machineEnv];

    els.detailContent.innerHTML =
      "<h3>" + escapeHtml(n.notation) + " " + ccPillHtml + "</h3>" +
      '<p class="wiki-alphabetagamma" style="margin-top:-0.5rem">from <a href="https://schedulingzoo.lip6.fr/" target="_blank" rel="noopener">schedulingzoo.lip6.fr</a> -- ' +
      "not independently verified by this site; classification above is this site's own reading of schedzoo's " +
      "cited text, not a category schedzoo assigns itself.</p>" +
      (machineEnvExpl ? '<p style="color:var(--muted);font-size:0.85rem"><b>' + escapeHtml(n.machineEnv) +
        "</b> — " + escapeHtml(machineEnvExpl) + " (schedzoo's own wording)</p>" : "") +
      (lower.length ? '<div class="detail-field"><h4>Classical hardness results</h4><ul class="result-list">' + lower.map(resultLi).join("") + "</ul></div>" : "") +
      (upper.length ? '<div class="detail-field"><h4>Classical positive / algorithmic results</h4><ul class="result-list">' + upper.map(resultLi).join("") + "</ul></div>" : "") +
      (paramTreeHtml ? '<div class="detail-field"><h4>Parameterized results</h4><p style="margin:0 0 0.5rem;color:var(--muted);font-size:0.85rem">' +
        "Nested by combined-parameter containment: a child bounds every measure its parent bounds, plus more" +
        (paramDiagram ? " (drag the boxes below, same as any other map on this site)" : "") + ".</p>" +
        (paramDiagram ? paramDiagram.html : "") + paramLegendHtml + paramTreeHtml + "</div>" : "");
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    setPanelMinWidth(paramDiagram ? paramDiagram.width : 0);
    if (paramDiagram) enableSzParamDiagramDragging(els.detailContent.querySelector(".param-tree-wrap"));
  }

  // Every schedzoo parameterized result is tagged with a combined-parameter
  // label like "m" or "#p+#d+#r" (several measures bounded together). Build
  // a forest by set-containment of those "+"-joined token sets -- purely
  // structural (just which label's token set is a subset of which other),
  // no complexity-theoretic claim asserted about how the results relate.
  // Smaller token set = fewer things bounded = more general, so it's the
  // parent; a bigger superset is nested underneath as the more specific
  // child, matching this site's general-to-specific convention everywhere
  // else. A label can have several equally-good immediate parents (a true
  // Hasse diagram, not a tree) -- resolved deterministically by picking the
  // alphabetically-first one so the UI stays a single tree, not a DAG.
  function paramLabelTokens(label) {
    return label.split("+").map((t) => t.trim()).filter(Boolean);
  }

  // Two source citations occasionally list the same combined parameter in a
  // different token order ("#p+#w+#d" vs "#p+#d+#w") -- same set, same
  // meaning, just serialized differently. Canonicalize by sorting tokens so
  // they group into one tree node instead of two misleadingly-separate ones.
  function canonicalParamLabel(label) {
    return paramLabelTokens(label).slice().sort().join("+");
  }

  function buildParamForest(params) {
    const byLabel = {};
    const labels = [];
    params.forEach((r) => {
      const key = canonicalParamLabel(r.param);
      if (!byLabel[key]) { byLabel[key] = []; labels.push(key); }
      byLabel[key].push(r);
    });
    const tokensOf = {};
    labels.forEach((l) => { tokensOf[l] = new Set(paramLabelTokens(l)); });
    function isProperSubset(a, b) {
      if (tokensOf[a].size >= tokensOf[b].size) return false;
      for (const t of tokensOf[a]) if (!tokensOf[b].has(t)) return false;
      return true;
    }
    const parentOf = {};
    labels.forEach((b) => {
      const candidates = labels.filter((a) => a !== b && isProperSubset(a, b));
      const immediate = candidates.filter((a) => !candidates.some((c) => c !== a && isProperSubset(a, c)));
      immediate.sort();
      parentOf[b] = immediate.length ? immediate[0] : null;
    });
    const childrenOf = {};
    labels.forEach((l) => (childrenOf[l] = []));
    labels.forEach((l) => { if (parentOf[l]) childrenOf[parentOf[l]].push(l); });
    const roots = labels.filter((l) => !parentOf[l]).sort();
    return { byLabel, labels, parentOf, childrenOf, roots };
  }

  function buildParamTreeHtml(forest, resultLi) {
    if (!forest.labels.length) return "";
    function renderLabel(label, depth) {
      const rs = forest.byLabel[label];
      const pl = rs.filter((r) => r.kind === "lower");
      const pu = rs.filter((r) => r.kind === "upper");
      const kids = forest.childrenOf[label].slice().sort();
      return '<div class="sz-param-group" style="margin-left:' + depth * 0.9 + 'rem">' +
        "<h5>parameter: " + escapeHtml(label) + "</h5>" +
        (pl.length ? '<ul class="result-list">' + pl.map(resultLi).join("") + "</ul>" : "") +
        (pu.length ? '<ul class="result-list">' + pu.map(resultLi).join("") + "</ul>" : "") +
        kids.map((k) => renderLabel(k, depth + 1)).join("") +
        "</div>";
    }
    return forest.roots.map((r) => renderLabel(r, 0)).join("");
  }

  // A small node+edge diagram of the SAME subset/superset forest, in this
  // site's own map visual idiom (boxes + arrows, general parent above,
  // specific child below) rather than a plain nested list -- auto-laid-out
  // via the generic layoutDag (schedzoo's param labels are open-ended free
  // text, not this site's own small fixed parameter set, so there's no
  // hand-curated PARAM_TREE_LAYOUT table to use here). Boxes are colored
  // through this site's own complexityClasses (FPT/XP/W1/W2/para-NP-hard --
  // see classifyParamComplexity below for how each schedzoo citation gets
  // mapped there), the SAME vocabulary and classById/mixWithPanelBg styling
  // as the wiki page's own parameter tree, not a separate red/green scheme.
  // Kept as its own small pair of functions (buildParamDiagramHtml +
  // enableSzParamDiagramDragging/layoutSzParamDiagramEdges below) rather
  // than reusing the wiki page's param-tree helpers, since those hardcode
  // that page's own fixed PARAM_TREE_NODE_W/H -- ours varies per node since
  // labels here are free text ("m" vs "#p+#d+#r"), not fixed short symbols.
  const SZ_PT_NODE_H = 26, SZ_PT_ROW_H = 48, SZ_PT_MARGIN = 10, SZ_PT_COL_GAP = 14, SZ_PT_FONT_PX = 11;
  const SZ_PT_MIN_W = 40, SZ_PT_MAX_W = 130;

  // A param label can carry several citations (different papers). Hardness
  // always wins when both a hardness and a positive result are recorded
  // for the same label (same "we know at least this much" convention used
  // everywhere else on this site), and among hardness/positive results the
  // strongest-known one wins. A citation this site's classifier couldn't
  // confidently place (approximation ratios, ad-hoc ETH runtimes, ...)
  // contributes nothing here -- shown in the text list below regardless.
  const SZ_PARAM_CLASS_RANK = { paraNP: 5, W2: 4, W1: 3, FPT: 2, XP: 1 };
  function bestParamComplexityClass(rs) {
    let best = null;
    rs.forEach((r) => {
      if (r.complexityClass && (!best || SZ_PARAM_CLASS_RANK[r.complexityClass] > SZ_PARAM_CLASS_RANK[best])) best = r.complexityClass;
    });
    return best;
  }

  function buildParamDiagramHtml(forest) {
    const ids = forest.labels;
    if (!ids.length) return null;
    const edgeList = ids.filter((id) => forest.parentOf[id]).map((id) => ({ from: forest.parentOf[id], to: id }));
    const { row, col } = layoutDag(ids, edgeList);
    const widthOf = {};
    ids.forEach((id) => {
      widthOf[id] = Math.min(SZ_PT_MAX_W, Math.max(SZ_PT_MIN_W, Math.ceil(measureTextWidthPx(id, SZ_PT_FONT_PX) + 12)));
    });
    const maxCol = Math.max(0, ...ids.map((id) => col[id]));
    const maxRow = Math.max(0, ...ids.map((id) => row[id]));
    const colWidth = {};
    for (let c = 1; c <= maxCol; c++) colWidth[c] = Math.max(0, ...ids.filter((id) => col[id] === c).map((id) => widthOf[id]));
    const colX = { 1: 0 };
    for (let c = 2; c <= maxCol; c++) colX[c] = colX[c - 1] + colWidth[c - 1] + SZ_PT_COL_GAP;
    const pos = {};
    ids.forEach((id) => {
      const w = widthOf[id];
      pos[id] = { left: SZ_PT_MARGIN + colX[col[id]] + (colWidth[col[id]] - w) / 2, top: SZ_PT_MARGIN + row[id] * SZ_PT_ROW_H, w, h: SZ_PT_NODE_H };
    });
    const width = SZ_PT_MARGIN * 2 + (maxCol ? colX[maxCol] + colWidth[maxCol] : 0);
    const height = SZ_PT_MARGIN * 2 + maxRow * SZ_PT_ROW_H + SZ_PT_NODE_H;

    const arrowId = "sz-param-tree-arrow";
    const defs = '<defs><marker id="' + arrowId + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="' + STEALTH_ARROW_PATH + '" fill="' + MAP_EDGE_COLOR + '" /></marker></defs>';

    const linesSvg = edgeList.map((e) => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return "";
      const acx = a.left + a.w / 2, acy = a.top + a.h / 2, bcx = b.left + b.w / 2, bcy = b.top + b.h / 2;
      const tip = pullBackToRect(acx, acy, bcx, bcy, b.w / 2, b.h / 2, 3);
      return '<line data-sz-pt-from="' + escapeHtml(e.from) + '" data-sz-pt-to="' + escapeHtml(e.to) +
        '" x1="' + acx + '" y1="' + acy + '" x2="' + tip.x + '" y2="' + tip.y +
        '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="1.5" marker-end="url(#' + arrowId + ')" />';
    }).join("");

    const nodesSvg = ids.map((id) => {
      const rs = forest.byLabel[id];
      const classId = bestParamComplexityClass(rs);
      const cls = classId ? classById(classId) : null;
      const filled = cls && cls.fill;
      const bg = cls && cls.opacity ? mixWithPanelBg(cls.color, cls.opacity) : filled ? cls.color : "var(--panel-bg)";
      const border = cls ? cls.color : "#868e96";
      const dash = cls && cls.border === "dashed" ? ' stroke-dasharray="3,2"' : "";
      const textColor = filled && !cls.opacity ? fillTextColor(cls) : cls && (filled || cls.opacity) ? "#111" : "var(--fg)";
      const p = pos[id];
      const title = id + (cls ? " — " + cls.label : rs.some((r) => r.kind === "lower") || rs.some((r) => r.kind === "upper") ? " — result recorded, not classified into FPT/XP/W-hierarchy (see list below)" : "");
      return '<g class="sz-pt-node" data-sz-pt-id="' + escapeHtml(id) + '" data-x="' + p.left + '" data-y="' + p.top + '" transform="translate(' + p.left + "," + p.top + ')">' +
        "<title>" + escapeHtml(title) + "</title>" +
        '<rect width="' + p.w + '" height="' + p.h + '" rx="5" style="fill:' + bg + ";stroke:" + border + '"' + dash + ' stroke-width="1.5" />' +
        '<text x="' + p.w / 2 + '" y="' + (p.h / 2 + 4) + '" text-anchor="middle" font-size="' + SZ_PT_FONT_PX + '" font-weight="600" style="fill:' + textColor + '">' +
        escapeHtml(id) + "</text></g>";
    }).join("");

    return {
      html: '<div class="param-tree-wrap"><svg class="sz-param-tree-svg" width="' + width + '" height="' + height + '">' + defs + linesSvg + nodesSvg + "</svg></div>",
      width: width,
    };
  }

  function layoutSzParamDiagramEdges(svg) {
    svg.querySelectorAll("g.sz-pt-node").forEach((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform"));
      g.dataset.x = m[1];
      g.dataset.y = m[2];
    });
    svg.querySelectorAll("line[data-sz-pt-from]").forEach((line) => {
      const a = svg.querySelector('g.sz-pt-node[data-sz-pt-id="' + cssEscape(line.dataset.szPtFrom) + '"]');
      const b = svg.querySelector('g.sz-pt-node[data-sz-pt-id="' + cssEscape(line.dataset.szPtTo) + '"]');
      if (!a || !b) return;
      const aw = a.querySelector("rect").getAttribute("width"), ah = a.querySelector("rect").getAttribute("height");
      const bw = b.querySelector("rect").getAttribute("width"), bh = b.querySelector("rect").getAttribute("height");
      const ax = parseFloat(a.dataset.x) + aw / 2, ay = parseFloat(a.dataset.y) + ah / 2;
      const bx = parseFloat(b.dataset.x) + bw / 2, by = parseFloat(b.dataset.y) + bh / 2;
      const tip = pullBackToRect(ax, ay, bx, by, bw / 2, bh / 2, 3);
      line.setAttribute("x1", ax);
      line.setAttribute("y1", ay);
      line.setAttribute("x2", tip.x);
      line.setAttribute("y2", tip.y);
    });
  }

  function enableSzParamDiagramDragging(wrap) {
    const svg = wrap && wrap.querySelector(".sz-param-tree-svg");
    if (!svg) return;
    layoutSzParamDiagramEdges(svg);
    let drag = null;
    svg.querySelectorAll("g.sz-pt-node").forEach((g) => {
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
      layoutSzParamDiagramEdges(svg);
    });
    document.addEventListener("pointerup", () => { drag = null; });
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

  // A pseudo-polynomial algorithm is, by definition, already polynomial in
  // p_max -- so classicalClass:"weakly-NP-hard" (this site's own definition
  // of that class is "admits a pseudo-polynomial algorithm") trivially
  // gives FPT w.r.t. p_max on its own, with no separate paper to cite.
  // Shared by both effective-results paths (the wiki page's cross-problem
  // inheritance and the parameter tree's cross-parameter inheritance) so
  // this base fact shows up everywhere a direct result would.
  function pseudoPolyPmaxResult(problemId) {
    const p = problemById(problemId);
    const pmaxParam = paramById("pmax");
    if (!p || p.classicalClass !== "weakly-NP-hard" || !pmaxParam || !isParamRelevantForProblem(pmaxParam, problemId)) return null;
    return {
      parameter: "pmax",
      class: "FPT",
      confidence: "verified",
      inherited: true,
      note: "Follows directly from this problem's own classical status: a pseudo-polynomial-time algorithm is already polynomial in p_max, which is exactly what FPT parameterized by p_max requires -- no separate result needed.",
    };
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
      if (!merged.pmax) {
        const base = pseudoPolyPmaxResult(problemId);
        if (base) merged.pmax = base;
      }
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
      const results = p ? p.results.slice() : [];
      if (!results.some((r) => r.parameter === "pmax")) {
        const base = pseudoPolyPmaxResult(problemId);
        if (base) results.push(base);
      }
      return results;
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
  // Edge (from,to) is redundant if `to` is also reachable from `from` via
  // some OTHER direct child -- i.e. a longer path through the hierarchy
  // already implies it. Standard DAG transitive reduction; safe to apply
  // globally and reuse for both inheritance and rendering, since removing
  // a redundant edge never removes reachability (some other path still
  // gets there), which is all effectiveParamResultsForProblem's recursive
  // resolve() actually relies on.
  function transitiveReduceEdges(edges) {
    const adj = {};
    edges.forEach((e) => { (adj[e.from] = adj[e.from] || new Set()).add(e.to); });
    function reachableFrom(node, visited) {
      visited = visited || new Set();
      (adj[node] || new Set()).forEach((next) => {
        if (!visited.has(next)) { visited.add(next); reachableFrom(next, visited); }
      });
      return visited;
    }
    return edges.filter((e) => {
      const otherTargets = Array.from(adj[e.from] || []).filter((t) => t !== e.to);
      return !otherTargets.some((t) => reachableFrom(t).has(e.to));
    });
  }

  let _paramEdgesReduced = null;
  function paramHierarchyEdges() {
    if (_paramEdgesReduced) return _paramEdgesReduced;
    const raw = (DATA.parameterHierarchy && DATA.parameterHierarchy.edges) || [];
    _paramEdgesReduced = transitiveReduceEdges(raw);
    return _paramEdgesReduced;
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
        // Hardness flows UP: from a more specific ("to") child to this
        // (more general, "from") parameter -- a child hard for X is hard
        // for whatever X generalizes.
        let best = null;
        edges.forEach((e) => {
          if (e.from !== paramId) return;
          const childResult = resolve(e.to);
          if (!childResult || resultHardnessRank(childResult.class) === 0) return;
          if (!best || resultHardnessRank(childResult.class) > resultHardnessRank(best.class)) best = childResult;
        });
        if (best && (!result || resultHardnessRank(best.class) > resultHardnessRank(result.class))) {
          result = Object.assign({}, best, { parameter: paramId, inherited: true });
        }
        // FPT flows DOWN: from a more general ("from") parent to this (more
        // specific, "to") parameter -- an FPT algorithm parameterized by a
        // general X still runs whenever a stricter Y is bounded, since the
        // edge's own definition is X <= f(Y). Only fills a genuine gap
        // (never overrides a direct citation or an already-inherited
        // hardness claim on this exact parameter).
        if (!result) {
          edges.forEach((e) => {
            if (e.to !== paramId || result) return;
            const parentResult = resolve(e.from);
            if (parentResult && parentResult.class === "FPT") {
              result = Object.assign({}, parentResult, { parameter: paramId, inherited: true });
            }
          });
        }
        visiting.delete(paramId);
      }
      resolved[paramId] = result;
      return result;
    }
    const allIds = new Set(Object.keys(direct));
    edges.forEach((e) => { allIds.add(e.from); allIds.add(e.to); });
    allIds.forEach(resolve);
    return resolved;
  }

  // ---------- problem designer (sandbox) ----------
  // Build an ad-hoc restrictions object by adding/removing restrictions on
  // the mega-problem's dimensions (machines/releaseTimes/processingTimes/
  // weights/due-date shape), scoped to the throughput-maximization (ΣUj /
  // ΣwjUj) objective family -- the only one with a restriction model at
  // all right now. This can only ever show what's INHERITED from the real,
  // cited problems already in the dataset (same specific->general hardness
  // rule as everywhere else on this site) -- it never invents a new result
  // for a combination nobody has actually studied.
  const SANDBOX_DUE_DATE_OPTIONS = [
    { id: "zero-slack", label: "zero slack (dⱼ=rⱼ+pⱼ)", dim: "slack", restriction: { family: "value", equals: 0 } },
    { id: "bounded-slack", label: "bounded additive slack (dⱼ−rⱼ≤pⱼ+σ)", dim: "slack", restriction: { family: "boundedValue", c: 2 } },
    { id: "bounded-looseness", label: "bounded looseness (dⱼ−rⱼ≤λ·pⱼ)", dim: "window", restriction: { family: "ratioBound", c: 1.5 } },
  ];
  const SANDBOX_SIMPLE_DIMENSIONS = [
    { dim: "machines", removeLabel: "allow multiple machines", addLabel: "single machine (m=1)", restriction: { family: "value", equals: 1 } },
    { dim: "releaseTimes", removeLabel: "allow release times", addLabel: "no release times (rⱼ=0)", restriction: { family: "value", equals: 0 } },
    { dim: "processingTimes", removeLabel: "allow non-uniform processing times", addLabel: "uniform processing times (pⱼ=p)", restriction: { family: "cardinality", k: 1 } },
    { dim: "weights", removeLabel: "allow weights", addLabel: "unweighted (wⱼ=1)", restriction: { family: "value", equals: 1 } },
  ];

  function sandboxDueDateOptionId(r) {
    const opt = SANDBOX_DUE_DATE_OPTIONS.find((o) => {
      const cur = r[o.dim];
      return cur && cur.family === o.restriction.family && (o.restriction.family === "value" ? cur.equals === o.restriction.equals : true);
    });
    return opt ? opt.id : null;
  }

  function sandboxNotation(r) {
    const alpha = r.machines && r.machines.family === "value" && r.machines.equals === 1 ? "1" : "P";
    const beta = [];
    if (!r.releaseTimes || r.releaseTimes.family !== "value" || r.releaseTimes.equals !== 0) beta.push("rj");
    if (r.processingTimes && r.processingTimes.family === "cardinality" && r.processingTimes.k === 1) beta.push("pj=p");
    const dd = sandboxDueDateOptionId(r);
    if (dd === "zero-slack") beta.push("dj=rj+pj");
    if (dd === "bounded-slack") beta.push("dj−rj≤pj+" + r.slack.c);
    if (dd === "bounded-looseness") beta.push("dj−rj≤" + r.window.c + "pj");
    const weighted = !r.weights || r.weights.family !== "value" || r.weights.equals !== 1;
    const gamma = weighted ? "ΣwjUj" : "ΣUj";
    return alpha + "|" + beta.join(",") + "|" + gamma;
  }

  function restrictionProblems() {
    return DATA.problems.filter((p) => p.restrictions !== undefined);
  }
  function generalizesRestrictionsObj(ra, rb) {
    let strict = false;
    for (const dim of RESTRICTION_DIMENSIONS) {
      const cmp = compareRestriction(ra[dim] || { family: "free" }, rb[dim] || { family: "free" });
      if (cmp === null || cmp < 0) return false;
      if (cmp > 0) strict = true;
    }
    return strict;
  }
  function restrictionsEqualObj(ra, rb) {
    return RESTRICTION_DIMENSIONS.every((dim) => compareRestriction(ra[dim] || { family: "free" }, rb[dim] || { family: "free" }) === 0);
  }

  function sandboxRelevantParameters(r) {
    return DATA.parameters.filter((param) => {
      const dims = param.dimensions || [];
      if (!dims.length) return false;
      return dims.every(({ dimension, measureKind }) => {
        const rr = r[dimension] || { family: "free" };
        if (rr.family === "value") return false;
        if (measureKind === "cardinality" && rr.family === "cardinality" && rr.k !== "param") return false;
        if ((rr.family === "boundedValue" || rr.family === "ratioBound") && rr.c !== "param") return false;
        return true;
      });
    });
  }

  // Everything known about the current sandbox node: an exact match (this
  // restriction combination is literally one of the 28 real problems), the
  // strongest classical hardness inherited from any real problem it
  // generalizes, the same for each relevant parameter, and the closest
  // known relatives in both directions for context.
  function sandboxKnowledge(r) {
    const all = restrictionProblems();
    const exact = all.find((p) => restrictionsEqualObj(p.restrictions, r));
    const specializations = all.filter((p) => generalizesRestrictionsObj(r, p.restrictions) || restrictionsEqualObj(p.restrictions, r));
    const generalizations = all.filter((p) => generalizesRestrictionsObj(p.restrictions, r));

    let classicalBest = null;
    specializations.forEach((p) => {
      classicalBest = strongerOf(classicalBest, inheritedContribution(effectiveClassForProblem(p.id)));
    });

    const relevant = sandboxRelevantParameters(r);
    const paramResults = {};
    relevant.forEach((param) => {
      let best = null;
      specializations.forEach((p) => {
        const pr = effectiveParamResultsForProblem(p.id)[param.id];
        if (pr && resultHardnessRank(pr.class) > 0 && (!best || resultHardnessRank(pr.class) > resultHardnessRank(best.class))) best = pr;
      });
      paramResults[param.id] = best;
    });

    return { exact, specializations, generalizations, classicalBest, relevant, paramResults };
  }

  function sandboxNodeStyle(exact, classicalBest) {
    const classId = exact ? effectiveClassForProblem(exact.id) : classicalBest;
    const cc = classId ? classicalClassById(classId) : null;
    const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
    const border = cc ? cc.color : "#868e96";
    const color = cc && cc.fill ? fillTextColor(cc) : null;
    return { cc, style: "background:" + bg + ";border-color:" + border + (color ? ";color:" + color : "") };
  }

  // The sandbox is a small discovered graph, not one mutating node: every
  // chip click adds (or reuses, if already reached by a different path) a
  // node and links it to whichever node was active, then selects it. This
  // is what makes the generalization/specialization structure explorable
  // instead of destroying the trail behind you.
  let sandboxGraph = null;

  function sandboxNodeKey(r) {
    return RESTRICTION_DIMENSIONS.map((dim) => {
      const x = r[dim];
      if (!x) return "-";
      if (x.family === "value") return "v" + x.equals;
      if (x.family === "cardinality") return "c" + x.k;
      if (x.family === "boundedValue") return "b" + x.c;
      if (x.family === "ratioBound") return "t" + x.c;
      return "-";
    }).join("_");
  }
  function sandboxRestrictionCount(r) {
    return RESTRICTION_DIMENSIONS.filter((dim) => r[dim]).length;
  }
  function resetSandboxGraph() {
    const key = sandboxNodeKey({});
    sandboxGraph = { nodes: {}, edges: [], active: key };
    sandboxGraph.nodes[key] = { key: key, restrictions: {}, row: 0, col: 0 };
  }
  // Edges are recomputed from scratch over every discovered node's actual
  // restrictions (the same generalizesRestrictionsObj + Hasse-diagram
  // reduction the real maps use), never just "the node you clicked from" --
  // otherwise which edges show up would depend on the order you happened to
  // click things in, instead of the true generalization relation between
  // whatever's on screen. Two nodes reached via unrelated paths still get
  // connected if one genuinely generalizes the other.
  function sandboxRecomputeEdges() {
    const keys = Object.keys(sandboxGraph.nodes);
    const full = [];
    keys.forEach((a) => {
      keys.forEach((b) => {
        if (a !== b && generalizesRestrictionsObj(sandboxGraph.nodes[a].restrictions, sandboxGraph.nodes[b].restrictions)) full.push([a, b]);
      });
    });
    const redundant = (a, b) =>
      keys.some(
        (c) =>
          c !== a && c !== b &&
          generalizesRestrictionsObj(sandboxGraph.nodes[a].restrictions, sandboxGraph.nodes[c].restrictions) &&
          generalizesRestrictionsObj(sandboxGraph.nodes[c].restrictions, sandboxGraph.nodes[b].restrictions)
      );
    sandboxGraph.edges = full.filter(([a, b]) => !redundant(a, b)).map(([from, to]) => ({ from: from, to: to }));
  }

  // Rows = number of active restrictions (fewer = more general = higher up,
  // same convention as every other DAG on this site); columns are just
  // insertion order within a row, which is enough to avoid overlaps.
  function sandboxDiscover(restrictions) {
    const key = sandboxNodeKey(restrictions);
    if (!sandboxGraph.nodes[key]) {
      const row = sandboxRestrictionCount(restrictions);
      const col = Object.keys(sandboxGraph.nodes).filter((k) => sandboxGraph.nodes[k].row === row).length;
      sandboxGraph.nodes[key] = { key: key, restrictions: restrictions, row: row, col: col };
    }
    sandboxRecomputeEdges();
    sandboxGraph.active = key;
    renderDesign();
  }

  const SANDBOX_NODE_H = 44, SANDBOX_ROW_H = 90, SANDBOX_MARGIN = 30, SANDBOX_COL_GAP = 40;

  // Removes a node from the discovered graph, then recomputes edges from
  // scratch over whatever nodes remain -- rather than just dropping any
  // edge that touched the deleted node, this naturally creates "bypass"
  // edges straight from its generalizations to its specializations,
  // because those pairs still generalize one another once it's gone.
  // If it was the active node, falls back to any remaining node; if it was
  // the last node left, the graph just goes back to a fresh root instead
  // of being left empty (renderDesign always assumes at least one node).
  function sandboxDeleteNode(key) {
    delete sandboxGraph.nodes[key];
    const remaining = Object.keys(sandboxGraph.nodes);
    if (!remaining.length) { resetSandboxGraph(); return; }
    sandboxRecomputeEdges();
    if (sandboxGraph.active === key) sandboxGraph.active = remaining[0];
  }

  function sandboxBinOverlapsPoint(clientX, clientY) {
    const bin = document.getElementById("design-bin");
    if (!bin) return false;
    const r = bin.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  // "Beyond the box frame" = the cursor has left the diagram's own
  // bounding box, not just the node's clipped-by-overflow visual position
  // -- .map-canvas-wrap clips its contents (see the overflow:hidden note
  // on that rule), so a node dragged past its edge otherwise just vanishes
  // silently instead of doing anything.
  function sandboxOutOfFrame(clientX, clientY) {
    const wrap = els.viewDesign.querySelector(".map-canvas-wrap");
    if (!wrap) return false;
    const r = wrap.getBoundingClientRect();
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom;
  }

  // Draggable, like the real maps -- but renderDesign() re-renders (and so
  // destroys/recreates the whole canvas) on every single click, unlike
  // renderMap() which only runs once per navigation. So the document-level
  // pointermove/pointerup listeners are attached exactly once (guarded by
  // sandboxDragReady) and always look up the CURRENT canvas/nodes fresh by
  // querying the DOM, rather than closing over elements from the render
  // that was active when they were attached -- those go stale immediately.
  // Per-node pointerdown listeners are re-attached every render, which is
  // fine: the old nodes (and their listeners) are discarded with the old DOM.
  let sandboxDrag = null;
  let sandboxDragReady = false;

  function sandboxUpdateEdgesFor(svg, canvas, key, cx, cy, halfW, halfH) {
    svg.querySelectorAll('line[data-from="' + cssEscape(key) + '"]').forEach((line) => {
      line.setAttribute("x1", cx);
      line.setAttribute("y1", cy);
      const targetEl = canvas.querySelector('.design-graph-node[data-node-key="' + cssEscape(line.dataset.to) + '"]');
      if (!targetEl) return;
      const tcx = parseFloat(targetEl.style.left) + halfW, tcy = parseFloat(targetEl.style.top) + halfH;
      const tip = pullBackToRect(cx, cy, tcx, tcy, halfW, halfH, 4);
      line.setAttribute("x2", tip.x);
      line.setAttribute("y2", tip.y);
    });
    svg.querySelectorAll('line[data-to="' + cssEscape(key) + '"]').forEach((line) => {
      const x1 = parseFloat(line.getAttribute("x1")), y1 = parseFloat(line.getAttribute("y1"));
      const tip = pullBackToRect(x1, y1, cx, cy, halfW, halfH, 4);
      line.setAttribute("x2", tip.x);
      line.setAttribute("y2", tip.y);
    });
  }

  function enableSandboxNodeDragging(nodeW, nodeH) {
    const halfW = nodeW / 2, halfH = nodeH / 2;
    const canvas = els.viewDesign.querySelector(".map-canvas");
    if (!canvas) return;

    canvas.querySelectorAll(".design-graph-node").forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        sandboxDrag = {
          key: el.dataset.nodeKey,
          startX: e.clientX, startY: e.clientY,
          left0: parseFloat(el.style.left), top0: parseFloat(el.style.top),
          halfW: halfW, halfH: halfH,
          moved: false,
        };
      });
      el.addEventListener("click", () => {
        if (sandboxDrag && sandboxDrag.moved) return;
        sandboxGraph.active = el.dataset.nodeKey;
        renderDesign();
      });
    });

    if (sandboxDragReady) return;
    sandboxDragReady = true;
    document.addEventListener("pointermove", (e) => {
      if (!sandboxDrag) return;
      const liveCanvas = els.viewDesign.querySelector(".map-canvas");
      const el = liveCanvas && liveCanvas.querySelector('.design-graph-node[data-node-key="' + cssEscape(sandboxDrag.key) + '"]');
      if (!liveCanvas || !el) { sandboxDrag = null; return; }
      const svg = liveCanvas.querySelector(".map-edge-svg");
      const scale = parseFloat(liveCanvas.dataset.scale) || 1;
      const dx = (e.clientX - sandboxDrag.startX) / scale, dy = (e.clientY - sandboxDrag.startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) sandboxDrag.moved = true;
      if (!sandboxDrag.moved) return;
      const left = sandboxDrag.left0 + dx, top = sandboxDrag.top0 + dy;
      el.style.left = left + "px";
      el.style.top = top + "px";
      sandboxUpdateEdgesFor(svg, liveCanvas, sandboxDrag.key, left + sandboxDrag.halfW, top + sandboxDrag.halfH, sandboxDrag.halfW, sandboxDrag.halfH);
      // A bin icon appears once a drag is actually underway; dropping a
      // node on it -- or dragging it out past the diagram's own frame --
      // deletes that node instead of just repositioning it.
      const bin = document.getElementById("design-bin");
      const overBin = bin && sandboxBinOverlapsPoint(e.clientX, e.clientY);
      const outOfFrame = sandboxOutOfFrame(e.clientX, e.clientY);
      if (bin) {
        bin.classList.add("visible");
        bin.classList.toggle("hover", !!overBin);
      }
      el.classList.toggle("delete-armed", !!overBin || outOfFrame);
      liveCanvas.closest(".map-canvas-wrap").classList.toggle("delete-armed", outOfFrame && !overBin);
    });
    document.addEventListener("pointerup", (e) => {
      const bin = document.getElementById("design-bin");
      const wrap = els.viewDesign.querySelector(".map-canvas-wrap");
      if (wrap) wrap.classList.remove("delete-armed");
      const droppedOnBin = sandboxDrag && sandboxDrag.moved && bin && sandboxBinOverlapsPoint(e.clientX, e.clientY);
      const droppedOutOfFrame = sandboxDrag && sandboxDrag.moved && !droppedOnBin && sandboxOutOfFrame(e.clientX, e.clientY);
      if ((droppedOnBin || droppedOutOfFrame) && sandboxGraph.nodes[sandboxDrag.key]) {
        sandboxDeleteNode(sandboxDrag.key);
        renderDesign();
      } else if (sandboxDrag && sandboxDrag.moved && sandboxGraph.nodes[sandboxDrag.key]) {
        const liveCanvas = els.viewDesign.querySelector(".map-canvas");
        const el = liveCanvas && liveCanvas.querySelector('.design-graph-node[data-node-key="' + cssEscape(sandboxDrag.key) + '"]');
        if (el) {
          // Persist the drag so it survives the next renderDesign() call
          // (every chip click re-renders and would otherwise snap the node
          // back to its auto-computed row/col position).
          sandboxGraph.nodes[sandboxDrag.key].customLeft = parseFloat(el.style.left);
          sandboxGraph.nodes[sandboxDrag.key].customTop = parseFloat(el.style.top);
        }
      }
      if (bin) { bin.classList.remove("visible", "hover"); }
      setTimeout(() => { sandboxDrag = null; }, 0);
    });
  }

  function renderDesign() {
    if (!sandboxGraph) resetSandboxGraph();
    const nodes = Object.values(sandboxGraph.nodes);
    const notationOf = {}, knowledgeOf = {};
    nodes.forEach((n) => {
      notationOf[n.key] = sandboxNotation(n.restrictions);
      knowledgeOf[n.key] = sandboxKnowledge(n.restrictions);
    });

    const fontPx = MAP_NODE_FONT_SIZE_REM * 16;
    const NODE_PADDING = 2 * 0.35 * 16 + 2 * 2;
    const longestW = Math.max(0, ...nodes.map((n) => measureTextWidthPx(notationOf[n.key], fontPx)));
    const nodeW = Math.max(150, Math.ceil(longestW + NODE_PADDING));
    const colW = nodeW + SANDBOX_COL_GAP;
    const maxCol = Math.max(0, ...nodes.map((n) => n.col));
    const maxRow = Math.max(0, ...nodes.map((n) => n.row));
    const canvasWidth = SANDBOX_MARGIN * 2 + maxCol * colW + nodeW;
    const canvasHeight = SANDBOX_MARGIN * 2 + maxRow * SANDBOX_ROW_H + SANDBOX_NODE_H;

    // A dragged node keeps its manually-set position (customLeft/Top,
    // written on pointerup below) instead of snapping back to its
    // auto-computed row/col slot on the next render.
    const pos = {};
    nodes.forEach((n) => {
      const left = n.customLeft != null ? n.customLeft : SANDBOX_MARGIN + n.col * colW;
      const top = n.customTop != null ? n.customTop : SANDBOX_MARGIN + n.row * SANDBOX_ROW_H;
      pos[n.key] = { left: left, top: top, cx: left + nodeW / 2, cy: top + SANDBOX_NODE_H / 2 };
    });
    const canvasRight = Math.max(canvasWidth, ...nodes.map((n) => pos[n.key].left + nodeW + SANDBOX_MARGIN));
    const canvasBottom = Math.max(canvasHeight, ...nodes.map((n) => pos[n.key].top + SANDBOX_NODE_H + SANDBOX_MARGIN));

    // Plain lines, no arrowheads: exploration here isn't a one-way
    // "generalizes" claim like the real maps, it's just "these two are
    // connected by one restriction" -- direction is shown by row instead.
    // data-from/data-to (matched to data-node-key) let dragging re-clip
    // the affected lines live without a full re-render.
    const linesSvg = sandboxGraph.edges
      .map((e) => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return "";
        const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, nodeW / 2, SANDBOX_NODE_H / 2, 4);
        const tail = pullBackToRect(b.cx, b.cy, a.cx, a.cy, nodeW / 2, SANDBOX_NODE_H / 2, 4);
        return '<line data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) + '" x1="' + tail.x + '" y1="' + tail.y +
          '" x2="' + tip.x + '" y2="' + tip.y + '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="2" />';
      })
      .join("");

    const nodesHtml = nodes
      .map((n) => {
        const p = pos[n.key];
        const know = knowledgeOf[n.key];
        const { style, cc } = sandboxNodeStyle(know.exact, know.classicalBest);
        const active = n.key === sandboxGraph.active;
        return (
          '<a class="map-node design-graph-node' + (!cc || !cc.fill ? " outline" : "") + (active ? " active" : "") +
          '" data-node-key="' + escapeHtml(n.key) + '" href="javascript:void(0)" style="left:' + p.left + "px;top:" + p.top +
          "px;width:" + nodeW + "px;height:" + SANDBOX_NODE_H + "px;" + style + '">' + escapeHtml(notationOf[n.key]) + "</a>"
        );
      })
      .join("");

    const activeKey = sandboxGraph.active;
    const activeNode = sandboxGraph.nodes[activeKey];
    const activeR = activeNode.restrictions;
    const know = knowledgeOf[activeKey];

    const removeChips = [];
    SANDBOX_SIMPLE_DIMENSIONS.forEach((sd) => {
      if (activeR[sd.dim]) removeChips.push('<button type="button" class="chip design-chip" data-remove-dim="' + sd.dim + '">' + escapeHtml(sd.removeLabel) + "</button>");
    });
    const ddId = sandboxDueDateOptionId(activeR);
    if (ddId) removeChips.push('<button type="button" class="chip design-chip" data-remove-dim="dueDate">allow arbitrary due dates</button>');

    const addChips = [];
    SANDBOX_SIMPLE_DIMENSIONS.forEach((sd) => {
      if (!activeR[sd.dim]) addChips.push('<button type="button" class="chip design-chip" data-add-dim="' + sd.dim + '">' + escapeHtml(sd.addLabel) + "</button>");
    });
    SANDBOX_DUE_DATE_OPTIONS.forEach((opt) => {
      if (opt.id !== ddId) addChips.push('<button type="button" class="chip design-chip" data-add-due="' + opt.id + '">' + escapeHtml(opt.label) + "</button>");
    });

    const exactHtml = know.exact
      ? '<p class="design-exact">This is exactly <a href="#/problem/' + encodeURIComponent(know.exact.id) + '">' +
        escapeHtml(know.exact.notation) + "</a> — already a page on this site."
      : "";

    const classicalHtml = know.exact
      ? buildClassicalBadgeHtml(know.exact) + linkifyCitations(know.exact.classicalStatus)
      : know.classicalBest
      ? classPillHtmlForClassicalId(know.classicalBest) +
        " Inherited: generalizes at least one real problem classified " + (classicalClassById(know.classicalBest) || {}).label + "."
      : '<span class="class-pill" style="background:transparent;border:2px solid #868e96;color:var(--muted)">no direct claim</span> Not covered by, or a generalization of, any problem in this dataset.';

    const paramsHtml = know.relevant.length
      ? '<ul class="result-list">' +
        know.relevant
          .map((param) => {
            const r2 = know.paramResults[param.id];
            const cls = r2 ? classById(r2.class) : null;
            return (
              '<li class="result-row"><div class="param-name">' + escapeHtml(param.symbol) +
              '<span class="sym">' + escapeHtml(param.name) + "</span></div>" +
              '<div class="result-body"><p>' + (r2 ? "Inherited from a more specific known problem." : "No inherited result.") + "</p></div>" +
              '<span class="class-pill" style="' + classPillStyle(cls, r2) + '">' + (cls ? cls.label : "—") + "</span></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p style="color:var(--muted)">No parameters are meaningful for the current restrictions (everything relevant is already pinned).</p>';

    function relList(problems) {
      if (!problems.length) return '<p style="color:var(--muted)">None.</p>';
      return "<ul>" + problems.map((p) => '<li><a href="#/problem/' + encodeURIComponent(p.id) + '">' + escapeHtml(p.notation) + "</a></li>").join("") + "</ul>";
    }

    els.viewDesign.innerHTML =
      '<div class="design-page">' +
      '<h2 class="page-title">Problem Designer</h2>' +
      '<p class="design-intro">Every option you click adds a new node to this graph instead of replacing the current one — click any node to make it the selected one and keep exploring from there. This only shows what is already proven for a more specific case; it cannot invent a new result for a combination nobody has studied.</p>' +
      '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + canvasRight + "px;height:" + canvasBottom + 'px">' +
      '<svg class="map-edge-svg" width="' + canvasRight + '" height="' + canvasBottom + '">' + linesSvg + "</svg>" +
      nodesHtml +
      "</div></div>" +
      '<div class="design-bin" id="design-bin" title="Drop here to remove">🗑</div>' +
      '<p class="design-selected-label">Selected: <b>' + escapeHtml(notationOf[activeKey]) + "</b></p>" +
      '<div class="design-chip-row design-generalize-row">' + (removeChips.join("") || '<span class="design-chip-empty">(fully general already)</span>') + "</div>" +
      '<div class="design-chip-row design-specialize-row">' + (addChips.join("") || '<span class="design-chip-empty">(fully restricted already)</span>') + "</div>" +
      '<div style="text-align:center;margin:1rem 0"><button type="button" class="reset-btn" id="design-reset">Clear graph</button></div>' +
      '<div class="design-details">' +
      '<div class="detail-field"><h4>Classical (unparameterized) status</h4>' + exactHtml + "<p>" + classicalHtml + "</p></div>" +
      '<div class="detail-field"><h4>Parameterized results (inherited)</h4>' + paramsHtml + "</div>" +
      '<div class="detail-field"><h4>Closest known relatives</h4>' +
      "<p><b>More general (known problems this specializes):</b></p>" + relList(know.generalizations) +
      "<p><b>More specific (known problems this generalizes):</b></p>" + relList(know.specializations) +
      "</div></div></div>";

    enableSandboxNodeDragging(nodeW, SANDBOX_NODE_H);
    els.viewDesign.querySelectorAll("[data-remove-dim]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dim = btn.dataset.removeDim;
        const next = Object.assign({}, activeR);
        if (dim === "dueDate") { delete next.slack; delete next.window; }
        else delete next[dim];
        sandboxDiscover(next);
      });
    });
    els.viewDesign.querySelectorAll("[data-add-dim]").forEach((btn) => {
      const sd = SANDBOX_SIMPLE_DIMENSIONS.find((x) => x.dim === btn.dataset.addDim);
      btn.addEventListener("click", () => {
        const next = Object.assign({}, activeR);
        next[sd.dim] = Object.assign({}, sd.restriction);
        sandboxDiscover(next);
      });
    });
    els.viewDesign.querySelectorAll("[data-add-due]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const opt = SANDBOX_DUE_DATE_OPTIONS.find((o) => o.id === btn.dataset.addDue);
        const next = Object.assign({}, activeR);
        delete next.slack;
        delete next.window;
        next[opt.dim] = Object.assign({}, opt.restriction);
        sandboxDiscover(next);
      });
    });
    const resetBtn = document.getElementById("design-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => { resetSandboxGraph(); renderDesign(); });

    setTimeout(() => fitMapCanvasToWidth(els.viewDesign), 0);
  }

  // Small helper so the classical-status line can show a colored pill for
  // an inherited-only classicalClass id (no problem object to hang it off).
  function classPillHtmlForClassicalId(classId) {
    const cc = classicalClassById(classId);
    if (!cc) return "";
    return (
      '<span class="class-pill" style="background:' + (cc.fill ? cc.color : "var(--panel-bg)") +
      ";border:2px " + (cc.border || "solid") + " " + cc.color + ";color:" + (cc.fill ? fillTextColor(cc) : "var(--fg)") +
      '">' + escapeHtml(cc.label) + "</span> "
    );
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
    sigma:         { col: 9,   row: 0 },
    lambda:        { col: 10,  row: 0 },
    sigma_plus_m:  { col: 1,   row: 1 },
    numDD_numW:    { col: 2.7, row: 1 },
    numDD_numP:    { col: 3.8, row: 1 },
    numP_numW:     { col: 4.9, row: 1 },
    pmax:          { col: 6.2, row: 1 },
    numR_numDD:    { col: 8.5, row: 1 },
    m_plus_p:      { col: 3.5, row: 2 },
    numP_numR_numDD: { col: 6, row: 2 },
    numP_numW_numR:  { col: 7.2, row: 2 },
    numP_numW_numDD: { col: 8.4, row: 2 },
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
    // A combined parameter whose only status is FPT purely because it's
    // trivially implied by a simpler combination (general-to-specific FPT
    // inheritance, see effectiveParamResultsForProblem) isn't new
    // information -- drop it rather than clutter the tree with something
    // that follows for free. Single (non-combined) parameters keep
    // showing inherited results as before; only combined ones are hidden.
    Array.from(relevant).forEach((id) => {
      const param = paramById(id);
      const r = effective[id];
      if (param && param.dimensions && param.dimensions.length > 1 && r && r.class === "FPT" && r.inherited) {
        relevant.delete(id);
      }
    });
    // A problem already known to be in P is trivially FPT for every
    // parameter (run the polynomial algorithm and ignore the parameter) --
    // color the whole tree green rather than leaving it blank/gray for lack
    // of a directly recorded per-parameter result.
    const isP = effectiveClassForProblem(problemId) === "P";
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
      '<defs><marker id="' + arrowId + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="' + STEALTH_ARROW_PATH + '" fill="' + MAP_EDGE_COLOR + '" /></marker></defs>';

    const linesSvg = edges
      .map((e) => {
        if (!pos[e.from] || !pos[e.to]) return "";
        return '<line data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="1.75" marker-end="url(#' + arrowId + ')" />';
      })
      .join("");

    const nodesSvg = nodeIds
      .map((id) => {
        const param = paramById(id);
        const p = pos[id];
        const r = effective[id];
        const cls = isP ? classById("FPT") : r ? classById(r.class) : null;
        // Fill with the panel's own background (not "transparent") so the
        // connecting lines never show through an uncolored/unfilled node —
        // same convention as the map's own "open"/"unclaimed" nodes.
        // cls.opacity (XP) fades the fill and dashes the border, marking
        // "positive result, doesn't rule out hardness" as visually distinct
        // from a settled FPT/W-hard/para-NP-hard classification. A W1/W2
        // result that also cites an XP upper bound (r.xpBound) fills solid
        // too -- plain outline would look identical to a W-hard result with
        // no known n^f(k) algorithm highlighted, losing real information.
        const filled = cls && (cls.fill || (r && r.xpBound));
        const bg = cls && cls.opacity ? mixWithPanelBg(cls.color, cls.opacity) : filled ? cls.color : "var(--panel-bg)";
        const border = cls ? cls.color : "#5c5f66";
        const dash = cls && cls.border === "dashed" ? ' stroke-dasharray="3,2"' : "";
        const textColor = filled && !cls.opacity ? fillTextColor(cls) : cls && (filled || cls.opacity) ? "#111" : "var(--fg)";
        const title = isP
          ? (param ? param.name : id) + " — trivially FPT (problem is in P)"
          : (param ? param.name : id) + (r ? " — " + (cls ? cls.label : r.class) + (r.inherited ? " (inherited)" : "") : " — no result recorded");
        return (
          '<g class="param-node" data-param="' + escapeHtml(id) + '" transform="translate(' + p.left + "," + p.top + ')">' +
          '<title>' + escapeHtml(title) + "</title>" +
          '<rect width="' + PARAM_TREE_NODE_W + '" height="' + PARAM_TREE_NODE_H +
          '" rx="5" style="fill:' + bg + ";stroke:" + border + '"' + dash + ' stroke-width="1.5" />' +
          '<text x="' + PARAM_TREE_NODE_W / 2 + '" y="' + (PARAM_TREE_NODE_H / 2 + 4) + '" text-anchor="middle" font-size="13" font-weight="600" style="fill:' + textColor + '">' +
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

  function mapNodeCenter(node, nodeW, nodeH, colStagger, colW) {
    const left = MAP_MARGIN + (node.col - 1) * (colW || MAP_COL_W);
    const top = MAP_MARGIN + node.row * MAP_ROW_H + (node.col - 1) * colStagger;
    return { left, top, cx: left + nodeW / 2, cy: top + nodeH / 2 };
  }

  const MAP_NODE_FONT_SIZE_REM = 0.94;
  let _measureCanvas = null;
  // Measures notation text at the map node's real font (bold, same family
  // as the page) so a per-map node width can be sized to fit the longest
  // notation on one line -- keeping every node in a map at the same font
  // size instead of shrinking outliers (which is how nodes used to handle
  // long notations, and made the diagram look inconsistent).
  function measureTextWidthPx(text, fontPx) {
    if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
    const ctx = _measureCanvas.getContext("2d");
    ctx.font = "600 " + fontPx + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    return ctx.measureText(text).width;
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
    "∞": "$\\infty$", "∈": "$\\in$", "≠": "$\\neq$",
    "_": "\\_", "%": "\\%", "&": "\\&", "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}",
    "—": "---", "–": "--", "‘": "`", "’": "'", "“": "``", "”": "''",
  };
  function latexEscapeText(s) {
    return String(s).replace(/[Σ≤≥−σλαβγ∞∈≠_%&#$^—–‘’“”]/g, (c) => LATEX_CHAR_MAP[c] || c);
  }
  function tikzSanitizeId(id) {
    return "n" + String(id).replace(/[^a-zA-Z0-9]/g, "");
  }

  // Same symbol set as LATEX_CHAR_MAP, but for text that's already going to
  // be wrapped in a single pair of $...$ (e.g. a figure caption) rather than
  // mixed with upright text -- each macro needs a trailing space (consumed
  // by TeX, not rendered) so it doesn't swallow the letters right after it
  // (\Sigma immediately followed by "wj" would otherwise parse as the
  // control word \Sigmawj).
  const MATH_CHAR_MAP = {
    "Σ": "\\Sigma ", "≤": "\\leq ", "≥": "\\geq ", "−": "-",
    "σ": "\\sigma ", "λ": "\\lambda ", "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ",
  };
  function notationToMathTex(s) {
    return String(s).replace(/[Σ≤≥−σλαβγ]/g, (c) => MATH_CHAR_MAP[c]);
  }

  // Builds a self-contained figure (tikzpicture + caption) reproducing the
  // currently rendered map: same node positions/colors/labels and same
  // generalizes->specific edges. Per-classicalClass node styles and a
  // single shared edge style are declared once via \tikzset, so individual
  // \node/\draw lines only ever name a style, not repeat its properties.
  // TikZ auto-clips `--` connections to each named node's boundary, so no
  // manual arrow pullback is needed here (unlike the SVG renderer); shorten
  // <>/>= just pulls the tips a little further back for visual breathing room.
  function mapToTikzCode(map, positions, effective, nodeW, nodeH) {
    const SCALE = 42; // px per cm
    const usedColors = new Map();
    function colorName(hex) {
      const key = hex.replace("#", "").toUpperCase();
      if (!usedColors.has(key)) usedColors.set(key, "c" + key);
      return usedColors.get(key);
    }
    function styleName(classId) {
      return "sty" + String(classId).replace(/[^a-zA-Z0-9]/g, "");
    }

    // Nodes currently hidden (dragged off the diagram's edge) have no entry
    // in `positions` -- livePositions is built only from what's actually
    // visible on screen right now, see the tikz-export-btn handler -- so
    // excluding anything missing here keeps a hidden node (and any edge
    // touching it) out of the export too, matching what's on screen.
    const presentNodes = map.nodes.filter((n) => positions[n.problemId]);

    const usedClassIds = new Set(presentNodes.map((n) => effective[n.problemId]));
    const classStyleDefs = Array.from(usedClassIds)
      .map((classId) => {
        const cc = classicalClassById(classId);
        const borderName = colorName(cc ? cc.color : "868e96");
        const fillName = cc && cc.fill ? colorName(cc.color) : null;
        return (
          styleName(classId) + "/.style={pnode, draw=" + borderName +
          (cc && cc.border === "dashed" ? ", dashed" : "") +
          (fillName ? ", fill=" + fillName : ", fill=white") + "}"
        );
      });

    const nodeLines = presentNodes
      .map((n) => {
        const p = problemById(n.problemId);
        if (!p) return "";
        const pos = positions[n.problemId];
        const x = (pos.cx / SCALE).toFixed(2), y = (-pos.cy / SCALE).toFixed(2);
        return (
          "\\node[" + styleName(effective[n.problemId]) + "] (" + tikzSanitizeId(n.problemId) +
          ") at (" + x + "," + y + ") {" + latexEscapeText(p.notation) + "};"
        );
      })
      .filter(Boolean);

    // Plain "->" with no >=... option: the default core-TikZ arrow tip,
    // which needs nothing beyond \usepackage{tikz} -- no arrows.meta, no
    // arrows library, nothing version-sensitive.
    //
    // Drawn from raw (x,y) coordinates, not named node references (e.g.
    // "(nodeId) -- (nodeId2)") -- raw coordinates don't depend on the
    // referenced \node already having been declared earlier in the source,
    // which is what lets these come BEFORE the \node commands below
    // despite TikZ resolving named coordinates strictly in source order.
    // That ordering is the actual point: TikZ paints later source in front
    // of earlier source, so with edges first, each node's own opaque fill
    // (drawn after) covers whatever's underneath it, putting every arrow
    // visually behind the nodes instead of drawn on top of them.
    //
    // The START point stays the source's exact center -- that segment is
    // always covered by the source's own node, drawn after, so it's never
    // visible anyway. The END point is pulled back off the target's exact
    // center to just outside its border (same pullBackToRect used for the
    // live SVG view's arrowheads) -- without that, the arrowHEAD itself
    // (not just the line) would land inside the target's box and be hidden
    // under ITS fill too, since the target is drawn after this edge.
    const edges = mapEdges(map).filter((e) => positions[e.from] && positions[e.to]);
    const halfW = nodeW / 2, halfH = nodeH / 2;
    const edgeLines = edges.map((e) => {
      const a = positions[e.from], b = positions[e.to];
      const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, halfW, halfH, 6);
      const ax = (a.cx / SCALE).toFixed(2), ay = (-a.cy / SCALE).toFixed(2);
      const bx = (tip.x / SCALE).toFixed(2), by = (-tip.y / SCALE).toFixed(2);
      return "\\draw[sedge] (" + ax + "," + ay + ") -- (" + bx + "," + by + ");";
    });

    const colorDefs = Array.from(usedColors.entries()).map(
      ([hex, name]) => "\\definecolor{" + name + "}{HTML}{" + hex + "}"
    );

    const tikzsetLines =
      "\\tikzset{\n" +
      "  pnode/.style={rounded corners=2pt, minimum width=" + (nodeW / SCALE).toFixed(2) + "cm" +
      ", minimum height=" + (nodeH / SCALE).toFixed(2) + "cm, align=center, font=\\large, text=black, line width=0.1cm},\n" +
      "  sedge/.style={->, gray!70, line width=0.1cm, shorten <=3pt, shorten >=3pt},\n" +
      classStyleDefs.map((l) => "  " + l).join(",\n") + "\n" +
      "}\n";

    const label = "fig:map-" + String(map.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    // Caption names the most general node (never a `to` in any edge, i.e.
    // nothing here further generalizes it) as "$<notation>$ and its special
    // cases." -- falls back to the map's own title/description when the
    // map has no single most-general node (e.g. independent generalization
    // axes with more than one root).
    const targetIds = new Set(edges.map((e) => e.to));
    const rootIds = presentNodes.map((n) => n.problemId).filter((id) => !targetIds.has(id));
    const rootProblem = rootIds.length === 1 ? problemById(rootIds[0]) : null;
    const captionText = rootProblem
      ? "$" + notationToMathTex(rootProblem.notation) + "$ and its special cases."
      : latexEscapeText(map.title) + (map.description ? ": " + latexEscapeText(map.description) : "");

    return (
      "\\begin{figure}[htbp]\n" +
      "\\centering\n" +
      tikzsetLines +
      "\\resizebox{\\ifdim\\width>\\textwidth\\textwidth\\else\\width\\fi}{!}{%\n" +
      "\\begin{tikzpicture}\n" +
      colorDefs.map((l) => "  " + l).join("\n") + "\n" +
      edgeLines.map((l) => "  " + l).join("\n") + "\n" +
      nodeLines.map((l) => "  " + l).join("\n") + "\n" +
      "\\end{tikzpicture}%\n" +
      "}\n" +
      "\\caption{" + captionText + "}\n" +
      "\\label{" + label + "}\n" +
      "\\end{figure}\n"
    );
  }

  // Same idea as mapToTikzCode, adapted for the Scheduling Zoo overview:
  // nodes have their own individual width (sized to fit each notation,
  // unlike every other map's fixed nodeW/nodeH) so each gets its own
  // \node's minimum width instead of one shared style, and there's no
  // single "most general" root to caption (the graph is hundreds of
  // disconnected components) so the caption just names the export itself.
  function szMapToTikzCode(nodesList, edgesList, positions, szEffective) {
    const SCALE = 42;
    const usedColors = new Map();
    function colorName(hex) {
      const key = hex.replace("#", "").toUpperCase();
      if (!usedColors.has(key)) usedColors.set(key, "c" + key);
      return usedColors.get(key);
    }
    function styleName(classId) {
      return "sty" + String(classId).replace(/[^a-zA-Z0-9]/g, "");
    }

    const usedClassIds = new Set(nodesList.map((n) => szEffective[n.id]));
    const classStyleDefs = Array.from(usedClassIds).map((classId) => {
      const cc = classicalClassById(classId);
      const borderName = colorName(cc ? cc.color : "868e96");
      const fillName = cc && cc.fill ? colorName(cc.color) : null;
      return (
        styleName(classId) + "/.style={pnode, draw=" + borderName +
        (cc && cc.border === "dashed" ? ", dashed" : "") +
        (fillName ? ", fill=" + fillName : ", fill=white") + "}"
      );
    });

    const nodeLines = nodesList
      .map((n) => {
        const pos = positions[n.id];
        if (!pos) return "";
        const x = (pos.cx / SCALE).toFixed(2), y = (-pos.cy / SCALE).toFixed(2);
        const w = (pos.w / SCALE).toFixed(2), h = (pos.h / SCALE).toFixed(2);
        return (
          "\\node[" + styleName(szEffective[n.id]) + ", minimum width=" + w + "cm, minimum height=" + h + "cm] (" +
          tikzSanitizeId(n.id) + ") at (" + x + "," + y + ") {" + latexEscapeText(n.notation) + "};"
        );
      })
      .filter(Boolean);

    // Raw (x,y) coordinates, not named node references -- see the matching
    // comment in mapToTikzCode. Lets these come before the \node commands
    // below (source order = paint order in TikZ) so each node's opaque
    // fill, drawn after, covers the part of any line underneath it --
    // arrows read as behind the nodes instead of drawn on top of them.
    //
    // The START stays the source's exact center (always covered by the
    // source's own node, drawn after). The END is pulled back off the
    // target's exact center to just outside ITS border -- using that
    // node's own w/h, since unlike mapToTikzCode every node here has its
    // own size -- otherwise the arrowHEAD itself would land inside the
    // target's box and be hidden under its fill too.
    const edgeLines = edgesList
      .map((e) => {
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return "";
        const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, b.w / 2, b.h / 2, 6);
        const ax = (a.cx / SCALE).toFixed(2), ay = (-a.cy / SCALE).toFixed(2);
        const bx = (tip.x / SCALE).toFixed(2), by = (-tip.y / SCALE).toFixed(2);
        return "\\draw[sedge] (" + ax + "," + ay + ") -- (" + bx + "," + by + ");";
      })
      .filter(Boolean);

    const colorDefs = Array.from(usedColors.entries()).map(
      ([hex, name]) => "\\definecolor{" + name + "}{HTML}{" + hex + "}"
    );

    const tikzsetLines =
      "\\tikzset{\n" +
      "  pnode/.style={rounded corners=2pt, align=center, font=\\small, text=black, line width=0.1cm},\n" +
      "  sedge/.style={->, gray!70, line width=0.1cm, shorten <=3pt, shorten >=3pt},\n" +
      classStyleDefs.map((l) => "  " + l).join(",\n") + "\n" +
      "}\n";

    return (
      "\\begin{figure}[htbp]\n" +
      "\\centering\n" +
      tikzsetLines +
      "\\resizebox{\\ifdim\\width>\\textwidth\\textwidth\\else\\width\\fi}{!}{%\n" +
      "\\begin{tikzpicture}\n" +
      colorDefs.map((l) => "  " + l).join("\n") + "\n" +
      edgeLines.map((l) => "  " + l).join("\n") + "\n" +
      nodeLines.map((l) => "  " + l).join("\n") + "\n" +
      "\\end{tikzpicture}%\n" +
      "}\n" +
      "\\caption{A subset of the Scheduling Zoo overview (" + nodesList.length + " problems, " + edgesList.length +
      " generalization edges), exported from " +
      "\\href{https://schedulingzoo.lip6.fr/}{schedulingzoo.lip6.fr}'s own bibliography.}\n" +
      "\\end{figure}\n"
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

    const nodeH = map.nodeH || MAP_NODE_H_DEFAULT;
    const colStagger = map.colStagger != null ? map.colStagger : MAP_COL_STAGGER_DEFAULT;

    // Node width grows (uniformly across the whole map) to fit whichever
    // notation is longest, at the single shared font size -- rather than
    // shrinking that one node's font below the rest. Column width follows
    // suit so wider nodes never overlap their neighbors.
    const fontPx = MAP_NODE_FONT_SIZE_REM * 16;
    const NODE_H_PADDING = 2 * 0.35 * 16 + 2 * 2; // 0.35rem each side + 2px border each side
    const longestTextW = Math.max(
      0,
      ...map.nodes.map((n) => {
        const p = problemById(n.problemId);
        return p ? measureTextWidthPx(p.notation, fontPx) : 0;
      })
    );
    const nodeW = Math.max(map.nodeW || MAP_NODE_W_DEFAULT, Math.ceil(longestTextW + NODE_H_PADDING));
    const colW = Math.max(MAP_COL_W, nodeW + 40);

    const positions = {};
    let maxCol = 0, maxRow = 0;
    map.nodes.forEach((n) => {
      positions[n.problemId] = mapNodeCenter(n, nodeW, nodeH, colStagger, colW);
      maxCol = Math.max(maxCol, n.col);
      maxRow = Math.max(maxRow, n.row);
    });
    const width = MAP_MARGIN * 2 + (maxCol - 1) * colW + nodeW;
    const height = MAP_MARGIN * 2 + maxRow * MAP_ROW_H + (maxCol - 1) * colStagger + nodeH;

    // A full render bakes the currently-hidden ids into the fresh markup
    // (see visibleNodes below) and starts a new undo/redo history for THIS
    // map -- see the SZ_HIDDEN_STACK declaration up top for why (same
    // reasoning, just keyed per map id here).
    MAP_HIDDEN_STACK[id] = [];
    MAP_HIDDEN_REDO_STACK[id] = [];

    // Nodes dragged past the frame on a PREVIOUS render of this same map are
    // hidden from this render too -- purely a display filter (canvas size
    // and hardness-inheritance below still use the full, unfiltered map, so
    // hiding a node never shifts the layout or repaints another node's
    // color). Never touches map.nodes/map.edges themselves.
    const hiddenIds = MAP_HIDDEN_IDS[id];
    const visibleNodes = hiddenIds && hiddenIds.size ? map.nodes.filter((n) => !hiddenIds.has(n.problemId)) : map.nodes;

    const effective = computeEffectiveClasses(map);

    const arrowDef =
      '<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="' + STEALTH_ARROW_PATH + '" fill="' + MAP_EDGE_COLOR + '" /></marker></defs>';

    const linesSvg = mapEdges(map)
      .map((e) => {
        if (hiddenIds && (hiddenIds.has(e.from) || hiddenIds.has(e.to))) return "";
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return "";
        const axis = axisById(e.axis) || (e.axis ? { label: e.axis } : null);
        const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, nodeW / 2, nodeH / 2, 5);
        return (
          '<line data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y +
          '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="2" marker-end="url(#map-arrow)">' +
          (axis ? "<title>" + escapeHtml(axis.label) + "</title>" : "") +
          "</line>"
        );
      })
      .join("");

    const nodesHtml = visibleNodes
      .map((n) => {
        const p = problemById(n.problemId);
        if (!p) return "";
        const pos = positions[n.problemId];
        const cc = classicalClassById(effective[n.problemId]);
        const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
        const border = cc ? cc.color : "#868e96";
        const borderStyle = cc ? cc.border || "solid" : "solid";
        const textColor = cc && cc.fill ? fillTextColor(cc) : null;
        return (
          '<a class="map-node' + (cc && !cc.fill ? " outline" : "") + '" data-problem-id="' + escapeHtml(p.id) + '" title="' +
          escapeHtml(stripCitationMarkup(p.classicalStatus)) + '" href="#/problem/' + encodeURIComponent(p.id) +
          '" style="left:' + pos.left + "px;top:" + pos.top + "px;width:" + nodeW +
          "px;height:" + nodeH + "px;background:" + bg + ";border-color:" + border +
          ";border-style:" + borderStyle + (textColor ? ";color:" + textColor : "") +
          ";font-size:" + MAP_NODE_FONT_SIZE_REM + 'rem">' +
          escapeHtml(p.notation) + "</a>"
        );
      })
      .join("");

    const usedClasses = new Set(visibleNodes.map((n) => effective[n.problemId]));
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
      '<div class="map-page-header"><h2>' + escapeHtml(map.title) + "</h2></div>" +
      '<div class="map-diagram">' +
      '<div class="map-history-controls">' +
      '<button type="button" class="map-undo-btn map-history-btn" disabled title="Undo the last node hidden by dragging">↶ Undo</button>' +
      '<button type="button" class="map-redo-btn map-history-btn" disabled title="Redo the last undone hide">↷ Redo</button>' +
      '<button type="button" class="map-reset-hidden-btn map-history-btn"' + (hiddenIds && hiddenIds.size ? "" : " disabled") +
      ' title="Bring back every node hidden by dragging off the edge on this map">↺ Restore hidden</button>' +
      "</div>" +
      '<button type="button" class="tikz-export-btn" title="Copy this diagram as TikZ code">⧉ TikZ</button>' +
      '<button type="button" class="auto-arrange-btn" title="Recompute node positions to avoid overlaps">⇄ Auto-arrange</button>' +
      '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + width + "px;height:" + height + 'px">' +
      '<svg class="map-edge-svg" width="' + width + '" height="' + height + '">' + arrowDef + linesSvg + "</svg>" +
      nodesHtml +
      "</div></div>" +
      "</div>" +
      '<p class="map-hint"><span class="map-hint-icon">i</span> Drag a node past the diagram\'s edge to hide it, ' +
      "along with its edges, from this view only -- nothing in the underlying data changes. Undo / Redo / " +
      "Restore hidden (top-left of the diagram) step through or undo those hides.</p>" +
      '<div class="map-legend">' + classLegendHtml + "</div>" +
      excludedHtml +
      "</div>";

    // Deferred: route() only un-hides #view-map right after this call
    // returns, and a hidden element's clientWidth is 0 -- fitting now would
    // always see zero available space and skip scaling entirely. setTimeout
    // (not requestAnimationFrame, which can be starved when the tab isn't
    // actively painting) just needs to run after that synchronous unhide.
    setTimeout(() => fitMapCanvasToWidth(els.viewMap), 0);
    enableMapNodeDragging(els.viewMap.querySelector(".map-canvas"), nodeW, nodeH, id);

    const arrangeBtn = els.viewMap.querySelector(".auto-arrange-btn");
    arrangeBtn.addEventListener("click", () => {
      autoArrangeMap(map);
      renderMap(id);
    });

    els.viewMap.querySelector(".map-undo-btn").addEventListener("click", () => mapUndoHide(id));
    els.viewMap.querySelector(".map-redo-btn").addEventListener("click", () => mapRedoHide(id));
    els.viewMap.querySelector(".map-reset-hidden-btn").addEventListener("click", () => mapResetHidden(id));

    const tikzBtn = els.viewMap.querySelector(".tikz-export-btn");
    tikzBtn.addEventListener("click", () => {
      // Read live DOM positions rather than the closure's original layout
      // so dragged/decluttered node placements are reflected in the export.
      const canvas = els.viewMap.querySelector(".map-canvas");
      const livePositions = {};
      // Skip nodes hidden in place (dragged off the edge since this
      // render) -- mapToTikzCode only exports whatever has an entry here.
      canvas.querySelectorAll(".map-node:not(.node-hidden)").forEach((el) => {
        const left = parseFloat(el.style.left), top = parseFloat(el.style.top);
        livePositions[el.dataset.problemId] = { left, top, cx: left + nodeW / 2, cy: top + nodeH / 2 };
      });
      const code = mapToTikzCode(map, livePositions, effective, nodeW, nodeH);
      const original = tikzBtn.textContent;
      copyTextToClipboard(code)
        .then(() => { tikzBtn.textContent = "Copied!"; })
        .catch(() => { tikzBtn.textContent = "Copy failed — see console"; console.log(code); })
        .then(() => setTimeout(() => { tikzBtn.textContent = original; }, 1800));
    });
  }

  // Same in-place show/hide as setSzNodeHidden, for the regular Map view --
  // toggles a node and every edge touching it, without re-rendering (and so
  // without disturbing any other node's position).
  function setMapNodeHidden(canvas, id, hidden) {
    if (!canvas) return;
    const nodeEl = canvas.querySelector('.map-node[data-problem-id="' + cssEscape(id) + '"]');
    if (nodeEl) nodeEl.classList.toggle("node-hidden", hidden);
    canvas
      .querySelectorAll('line[data-from="' + cssEscape(id) + '"], line[data-to="' + cssEscape(id) + '"]')
      .forEach((line) => line.classList.toggle("node-hidden", hidden));
  }

  function mapUpdateHistoryButtons(mapId) {
    const undoBtn = els.viewMap.querySelector(".map-undo-btn");
    const redoBtn = els.viewMap.querySelector(".map-redo-btn");
    const resetBtn = els.viewMap.querySelector(".map-reset-hidden-btn");
    if (undoBtn) undoBtn.disabled = !(MAP_HIDDEN_STACK[mapId] || []).length;
    if (redoBtn) redoBtn.disabled = !(MAP_HIDDEN_REDO_STACK[mapId] || []).length;
    const hidden = MAP_HIDDEN_IDS[mapId];
    if (resetBtn) resetBtn.disabled = !(hidden && hidden.size);
  }

  function mapUndoHide(mapId) {
    const stack = MAP_HIDDEN_STACK[mapId];
    if (!stack || !stack.length) return;
    const problemId = stack.pop();
    if (MAP_HIDDEN_IDS[mapId]) MAP_HIDDEN_IDS[mapId].delete(problemId);
    (MAP_HIDDEN_REDO_STACK[mapId] || (MAP_HIDDEN_REDO_STACK[mapId] = [])).push(problemId);
    setMapNodeHidden(els.viewMap.querySelector(".map-canvas"), problemId, false);
    mapUpdateHistoryButtons(mapId);
  }

  function mapRedoHide(mapId) {
    const redoStack = MAP_HIDDEN_REDO_STACK[mapId];
    if (!redoStack || !redoStack.length) return;
    const problemId = redoStack.pop();
    (MAP_HIDDEN_IDS[mapId] || (MAP_HIDDEN_IDS[mapId] = new Set())).add(problemId);
    (MAP_HIDDEN_STACK[mapId] || (MAP_HIDDEN_STACK[mapId] = [])).push(problemId);
    setMapNodeHidden(els.viewMap.querySelector(".map-canvas"), problemId, true);
    mapUpdateHistoryButtons(mapId);
  }

  // Restores every node hidden on this map at once, in place (same as
  // undo/redo -- no re-render, so nothing else's position moves) -- unlike
  // repeatedly clicking Undo, this also clears the redo stack, matching
  // what "Reset" implies (start over, not "keep stepping back").
  function mapResetHidden(mapId) {
    const stack = MAP_HIDDEN_STACK[mapId];
    if (!stack || !stack.length) return;
    const canvas = els.viewMap.querySelector(".map-canvas");
    stack.forEach((problemId) => setMapNodeHidden(canvas, problemId, false));
    delete MAP_HIDDEN_IDS[mapId];
    MAP_HIDDEN_STACK[mapId] = [];
    MAP_HIDDEN_REDO_STACK[mapId] = [];
    mapUpdateHistoryButtons(mapId);
  }

  // Drag is tracked at the document level once started, not on the node
  // element itself: a real mouse moving quickly outrun a small node's
  // bounds between events, and per-element listeners simply stop firing
  // once the cursor leaves them — which looks exactly like "dragging does
  // nothing." Document-level listeners don't have that problem.
  // Shrinks the whole diagram (via CSS transform, not smaller fonts/nodes)
  // just enough to fit within the panel with no horizontal scrollbar --
  // canvas.dataset.scale is read live by the drag handler below so mouse
  // deltas still map 1:1 to screen movement while shrunk.
  function fitMapCanvasToWidth(viewEl) {
    viewEl = viewEl || els.viewMap;
    const wrap = viewEl.querySelector(".map-canvas-wrap");
    const canvas = viewEl.querySelector(".map-canvas");
    if (!wrap || !canvas) return;
    canvas.style.transform = "";
    canvas.style.marginLeft = "";
    const naturalWidth = canvas.offsetWidth;
    const naturalHeight = canvas.offsetHeight;
    const wrapCs = getComputedStyle(wrap);
    const chrome =
      parseFloat(wrapCs.paddingLeft) + parseFloat(wrapCs.paddingRight) +
      parseFloat(wrapCs.borderLeftWidth) + parseFloat(wrapCs.borderRightWidth);
    const budget = viewEl.clientWidth - chrome;
    const scale = budget > 0 ? Math.min(1, budget / naturalWidth) : 1;
    canvas.dataset.scale = scale;
    if (scale < 1) {
      canvas.style.transformOrigin = "top left";
      canvas.style.transform = "scale(" + scale + ")";
      wrap.style.height = naturalHeight * scale + "px";
    } else {
      wrap.style.height = "";
    }
    // Center the (possibly shrunk) diagram within the wrap horizontally --
    // transform-origin:top left keeps the scaled box pinned to the left
    // edge otherwise, so a smaller diagram (or the empty margin left over
    // after shrinking a wide one) reads as pushed left instead of centered.
    const renderedWidth = naturalWidth * scale;
    canvas.style.marginLeft = Math.max(0, (budget - renderedWidth) / 2) + "px";
  }

  function enableMapNodeDragging(canvas, nodeW, nodeH, mapId) {
    if (!canvas) return;
    const svg = canvas.querySelector(".map-edge-svg");
    const wrap = canvas.closest(".map-canvas-wrap");
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
      // The canvas may be visually shrunk (see fitMapCanvasToWidth) via a
      // CSS transform -- divide screen-pixel deltas by that scale so a node
      // still tracks the cursor 1:1 instead of moving in canvas-space px.
      const scale = parseFloat(canvas.dataset.scale) || 1;
      const dx = (e.clientX - drag.startX) / scale, dy = (e.clientY - drag.startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const left = drag.left0 + dx, top = drag.top0 + dy;
      drag.el.style.left = left + "px";
      drag.el.style.top = top + "px";
      updateEdgesFor(drag.id, left + halfW, top + halfH);
      // Dragging past the diagram's own frame arms the node for deletion --
      // dropping it there hides it (and its edges) from this view only; see
      // MAP_HIDDEN_IDS. Never touches map.nodes/map.edges in problems.json.
      const outOfFrame = nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY);
      drag.el.classList.toggle("delete-armed", outOfFrame);
      if (wrap) wrap.classList.toggle("delete-armed", outOfFrame);
    });

    document.addEventListener("pointerup", (e) => {
      if (wrap) wrap.classList.remove("delete-armed");
      if (drag && drag.moved && nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY)) {
        // Snap back to the pre-drag position (and re-anchor its edges there)
        // BEFORE hiding -- setMapNodeHidden just toggles display:none, it
        // doesn't touch left/top, so without this the node would reappear
        // wherever it was dropped (off-canvas) instead of where it was.
        drag.el.style.left = drag.left0 + "px";
        drag.el.style.top = drag.top0 + "px";
        updateEdgesFor(drag.id, drag.left0 + halfW, drag.top0 + halfH);
        (MAP_HIDDEN_IDS[mapId] || (MAP_HIDDEN_IDS[mapId] = new Set())).add(drag.id);
        (MAP_HIDDEN_STACK[mapId] || (MAP_HIDDEN_STACK[mapId] = [])).push(drag.id);
        MAP_HIDDEN_REDO_STACK[mapId] = [];
        setMapNodeHidden(canvas, drag.id, true);
        mapUpdateHistoryButtons(mapId);
        drag.el.classList.remove("delete-armed");
        drag = null;
        return;
      }
      // Cleared on the next tick, after the browser's own click event (which
      // fires right after pointerup) has had a chance to read drag.moved.
      setTimeout(() => { drag = null; }, 0);
    });
  }

  // Shared by enableMapNodeDragging and enableSzNodeDragging: "past the
  // frame" is measured against the cursor's position vs. the diagram's own
  // .map-canvas-wrap bounding box, not the dragged node's own (clipped by
  // that wrap's overflow:hidden, so a node dragged far enough just vanishes
  // silently rather than reporting a sane position -- same reasoning as
  // sandboxOutOfFrame above, kept as its own copy there since the sandbox
  // looks its wrap up fresh from els.viewDesign every call instead of
  // closing over one).
  function nodeDraggedOutOfFrame(wrapEl, clientX, clientY) {
    if (!wrapEl) return false;
    const r = wrapEl.getBoundingClientRect();
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom;
  }

  // Same dragging behavior as enableMapNodeDragging, adapted for the
  // Scheduling Zoo overview: every node has its OWN width (sized to fit its
  // notation, unlike the fixed nodeW/nodeH every other map uses), and edges
  // are matched via data-sz-from/data-sz-to rather than data-problem-id, so
  // this is kept as its own small copy rather than overloading the other
  // function with a size-per-node branch.
  function enableSzNodeDragging(canvas) {
    if (!canvas) return;
    const svg = canvas.querySelector(".map-edge-svg");
    const wrap = canvas.closest(".map-canvas-wrap");
    let drag = null; // { el, id, startX, startY, left0, top0, halfW, halfH, moved }

    function halfSizeOf(id) {
      const el = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(id) + '"]');
      return el ? { halfW: el.offsetWidth / 2, halfH: el.offsetHeight / 2 } : { halfW: 0, halfH: 0 };
    }

    function updateEdgesFor(id, cx, cy, halfW, halfH) {
      svg.querySelectorAll('line[data-sz-from="' + cssEscape(id) + '"]').forEach((line) => {
        line.setAttribute("x1", cx);
        line.setAttribute("y1", cy);
        const targetEl = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(line.dataset.szTo) + '"]');
        if (!targetEl) return;
        const t = halfSizeOf(line.dataset.szTo);
        const tcx = parseFloat(targetEl.style.left) + t.halfW, tcy = parseFloat(targetEl.style.top) + t.halfH;
        const tip = pullBackToRect(cx, cy, tcx, tcy, t.halfW, t.halfH, 3);
        line.setAttribute("x2", tip.x);
        line.setAttribute("y2", tip.y);
      });
      svg.querySelectorAll('line[data-sz-to="' + cssEscape(id) + '"]').forEach((line) => {
        const x1 = parseFloat(line.getAttribute("x1")), y1 = parseFloat(line.getAttribute("y1"));
        const tip = pullBackToRect(x1, y1, cx, cy, halfW, halfH, 3);
        line.setAttribute("x2", tip.x);
        line.setAttribute("y2", tip.y);
      });
    }

    canvas.querySelectorAll(".sz-node").forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        drag = {
          el,
          id: el.dataset.szId,
          startX: e.clientX,
          startY: e.clientY,
          left0: parseFloat(el.style.left),
          top0: parseFloat(el.style.top),
          halfW: el.offsetWidth / 2,
          halfH: el.offsetHeight / 2,
          moved: false,
        };
      });
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (drag && drag.moved) return;
        openSchedulingZooPanel(el.dataset.szId);
      });
    });

    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const scale = parseFloat(canvas.dataset.scale) || 1;
      const dx = (e.clientX - drag.startX) / scale, dy = (e.clientY - drag.startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const left = drag.left0 + dx, top = drag.top0 + dy;
      drag.el.style.left = left + "px";
      drag.el.style.top = top + "px";
      updateEdgesFor(drag.id, left + drag.halfW, top + drag.halfH, drag.halfW, drag.halfH);
      // Dragging past the diagram's own frame arms the node for deletion --
      // dropping it there hides it (and its edges) from this view only.
      const outOfFrame = nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY);
      drag.el.classList.toggle("delete-armed", outOfFrame);
      if (wrap) wrap.classList.toggle("delete-armed", outOfFrame);
    });

    document.addEventListener("pointerup", (e) => {
      if (wrap) wrap.classList.remove("delete-armed");
      if (drag && drag.moved && nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY)) {
        // Snap back to the pre-drag position (and re-anchor its edges there)
        // BEFORE hiding -- setSzNodeHidden just toggles display:none, it
        // doesn't touch left/top, so without this the node would reappear
        // wherever it was dropped (off-canvas) instead of where it was.
        drag.el.style.left = drag.left0 + "px";
        drag.el.style.top = drag.top0 + "px";
        updateEdgesFor(drag.id, drag.left0 + drag.halfW, drag.top0 + drag.halfH, drag.halfW, drag.halfH);
        SZ_HIDDEN_IDS.add(drag.id);
        SZ_HIDDEN_STACK.push(drag.id);
        SZ_HIDDEN_REDO_STACK = [];
        setSzNodeHidden(canvas, drag.id, true);
        szUpdateHistoryButtons();
        drag.el.classList.remove("delete-armed");
        drag = null;
        return;
      }
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

  function referenceLinkHtml(ref) {
    if (ref.doi) {
      const url = "https://doi.org/" + ref.doi;
      return ' <a class="ref-doi" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + "</a>";
    }
    if (ref.url) {
      return ' <a class="ref-doi" href="' + escapeHtml(ref.url) + '" target="_blank" rel="noopener">' + escapeHtml(ref.url) + "</a>";
    }
    if (ref.doiNote) {
      return ' <span class="ref-doi-note">' + escapeHtml(ref.doiNote) + "</span>";
    }
    return "";
  }
  function renderReferences() {
    const keys = Object.keys(DATA.references).sort();
    els.viewReferences.innerHTML =
      '<h2 class="page-title">References</h2><div class="ref-list">' +
      keys
        .map(
          (k) =>
            '<div class="ref-item"><span class="ref-key">[' + k + ']</span><span>' +
            escapeHtml(DATA.references[k].text) + referenceLinkHtml(DATA.references[k]) + "</span></div>"
        )
        .join("") +
      "</div>";
  }
})();
