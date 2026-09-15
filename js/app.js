(function () {
  "use strict";

  let DATA = null;

  const els = {
    detailPanel: document.getElementById("detail-panel"),
    detailContent: document.getElementById("detail-content"),
    detailClose: document.getElementById("detail-close"),
    detailOverlay: document.getElementById("detail-overlay"),
    viewSearch: document.getElementById("view-search"),
    viewProblem: document.getElementById("view-problem"),
    viewMaps: document.getElementById("view-maps"),
    viewZooMaps: document.getElementById("view-zoo-maps"),
    viewMap: document.getElementById("view-map"),
    viewDesign: document.getElementById("view-design"),
    viewDocs: document.getElementById("view-docs"),
    viewNext: document.getElementById("view-next"),
    viewSchedulingZoo: document.getElementById("view-schedulingzoo"),
    navLinks: document.querySelectorAll(".site-nav a"),
  };

  const VIEWS = {
    "/search": els.viewSearch,
    "/maps": els.viewMaps,
    "/zoo-maps": els.viewZooMaps,
    "/design": els.viewDesign,
    "/docs": els.viewDocs,
    "/next": els.viewNext,
    "/schedulingzoo": els.viewSchedulingZoo,
  };

  let DATA_SZ = null; // data/schedulingzoo.json -- see loadSzData
  // Fetched once and shared: both the Search matrix (the landing page) and
  // the Scheduling Zoo overview are built from it. Declared up here rather
  // than next to its users so nothing can reach it in its temporal dead zone.
  let DATA_SZ_PROMISE = null;
  function loadSzData() {
    if (!DATA_SZ_PROMISE) {
      DATA_SZ_PROMISE = fetch("data/schedulingzoo.json")
        .then((r) => r.json())
        .then((data) => { DATA_SZ = data; return data; })
        .catch((err) => { DATA_SZ_PROMISE = null; throw err; });
    }
    return DATA_SZ_PROMISE;
  }
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
      window.addEventListener("hashchange", route);
      window.addEventListener("resize", () => {
        if (!els.viewMap.hidden) fitMapCanvasToWidth(els.viewMap);
        if (!els.viewDesign.hidden) { fitMapCanvasToWidth(els.viewDesign); refreshDesignerResults(); }
        if (!els.viewSchedulingZoo.hidden) fitMapCanvasToWidth(els.viewSchedulingZoo);
      });
      route();
    })
    .catch((err) => {
      els.viewSearch.innerHTML =
        '<p style="padding:1rem;color:#c92a2a">Failed to load data/problems.json: ' + escapeHtml(String(err)) + "</p>";
    });

  // ---------- routing ----------

  // The home page is the Scheduling Zoo map: "#/" (or no hash) is read as
  // "#/schedulingzoo".
  function currentPath() {
    const h = location.hash.replace(/^#/, "");
    return !h || h === "/" ? "/schedulingzoo" : h;
  }

  function route() {
    const path = currentPath();
    Object.values(VIEWS).forEach((v) => (v.hidden = true));
    els.viewProblem.hidden = true;
    els.viewMap.hidden = true;

    let matched = null;
    const problemMatch = /^\/problem\/(.+)$/.exec(path);
    const mapMatch = /^\/map\/(.+)$/.exec(path);
    // #/docs/<section-id>: the Documentation page, scrolled to that section
    // (a plain #anchor would be read as a route of its own).
    // #/next/<section-id> works the same way for What's Coming Next.
    const docsMatch = /^\/(docs|next)\/(.+)$/.exec(path);
    // #/design/<map-id> opens a saved problem map in the designer;
    // #/design/new starts an empty one.
    const designMatch = /^\/design\/(.+)$/.exec(path);

    if (problemMatch) {
      renderProblemPage(decodeURIComponent(problemMatch[1]));
      els.viewProblem.hidden = false;
      matched = null; // no top-level nav item highlighted
    } else if (mapMatch) {
      renderMap(decodeURIComponent(mapMatch[1]));
      els.viewMap.hidden = false;
      matched = "/maps";
    } else if (designMatch) {
      els.viewDesign.hidden = false;
      const mapId = decodeURIComponent(designMatch[1]);
      els.viewDesign.innerHTML = '<div class="design-page"><h2 class="page-title">Problem Map Designer</h2><p class="design-intro">Loading…</p></div>';
      loadSzData().then(() => { openDesignerMap(mapId); renderDesign(); });
      matched = "/design";
    } else if (docsMatch) {
      const isNext = docsMatch[1] === "next";
      (isNext ? els.viewNext : els.viewDocs).hidden = false;
      if (isNext) renderNext();
      else renderDocs();
      matched = "/" + docsMatch[1];
      els.navLinks.forEach((a) => a.classList.toggle("active", a.dataset.route === matched));
      closeDetail();
      const target = document.getElementById(decodeURIComponent(docsMatch[2]));
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
      return;
    } else if (VIEWS[path]) {
      VIEWS[path].hidden = false;
      if (path === "/search") renderSearch();
      if (path === "/docs") renderDocs();
      if (path === "/next") renderNext();
      if (path === "/maps") renderMapsIndex();
      if (path === "/zoo-maps") renderZooMapsIndex();
      if (path === "/design") renderDesign();
      if (path === "/schedulingzoo") renderSchedulingZoo();
      matched = path;
    } else {
      els.viewSchedulingZoo.hidden = false;
      renderSchedulingZoo();
      matched = "/schedulingzoo";
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
  // otherwise null, and the citation is shown as plain text with the full
  // reference in its tooltip.
  function refUrl(key) {
    const r = DATA.references[key];
    if (!r) return null;
    if (r.doi) return "https://doi.org/" + r.doi;
    if (r.url) return r.url;
    return null;
  }
  function citeLinks(keys) {
    if (!keys || !keys.length) return "";
    return keys
      .map((k) => {
        const url = refUrl(k);
        return url
          ? '<a class="cite-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener" title="' +
            escapeHtml(refText(k)) + '">[' + escapeHtml(k) + "]</a>"
          : '<span class="cite-link" title="' + escapeHtml(refText(k)) + '">[' + escapeHtml(k) + "]</span>";
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
      return url
        ? '<a class="inline-cite" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + label + "</a>"
        : '<span class="inline-cite" title="' + escapeHtml(refText(key)) + '">' + label + "</span>";
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

  // The landing page: every problem in The Scheduling Zoo's bibliography
  // (DATA_SZ, the same data as the overview map) as a problems x parameters
  // matrix -- classical status first, then one column per combined
  // parameter a result is stated for ("m", "#d+#p+#r"). Filtered with the
  // same alpha|beta|gamma controls as the overview, but live: a table is
  // cheap to redraw, whereas the map needs an explicit Apply because it
  // re-runs its whole layout. Built once per page load, so the filters
  // survive switching tabs.
  let SEARCH_BUILT = false;
  const SZ_MACHINE_ENV_ORDER = ["1", "P", "Q", "R", "O", "F", "J"];

  // Machine-environment and objective options for a filter bar, counted
  // over the full corpus and ordered most common first. Shared by Search
  // and the overview so both bars always offer the same values.
  function szFilterOptions() {
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
    const machineEnvExpl = DATA_SZ.machineEnvExplanations || {};
    const machineEnvCounts = {};
    DATA_SZ.nodes.forEach((n) => {
      if (n.machineEnv) machineEnvCounts[n.machineEnv] = (machineEnvCounts[n.machineEnv] || 0) + 1;
    });
    const machineEnvOptions = Object.keys(machineEnvCounts)
      .map((v) => ({
        value: v,
        label: SZ_MACHINE_ENV_LABELS[v] || v,
        title: machineEnvExpl[v] || "",
        count: machineEnvCounts[v],
      }))
      .sort((a, b) => b.count - a.count);
    return { machineEnvOptions, objectiveOptions };
  }

  // One cited result: its bound text, then author (year) -- title, linked
  // when schedzoo has a URL/DOI. Shared by the problem panel and Search.
  // A problem's parameterized results: its own, then the hardness results
  // this site infers for it along parameter-safe arrows (inheritedParams,
  // see param_safe_tokens in convert_for_pzoo.py).
  function szAllParams(n) {
    return n.params.concat(n.inheritedParams || []);
  }
  function szNotationOf(id) {
    const n = DATA_SZ.nodes.find((x) => x.id === id);
    return n ? n.notation : id;
  }

  function szCitationHtml(r) {
    if (r.inheritedFrom) {
      return "<p style='margin:0 0 0.2rem'><b>Inherited</b> from its special case " + escapeHtml(szNotationOf(r.inheritedFrom)) +
        ", which " + escapeHtml(r.bound) + " for " + escapeHtml(r.param) + ".</p>" +
        "<p style='margin:0 0 0.2rem;color:var(--muted);font-size:0.85rem'>Along " +
        escapeHtml(r.via.map(szNotationOf).join(" → ")) + ": every arrow keeps " + escapeHtml(r.param) + " bounded.</p>" +
        szCitationHtml(Object.assign({}, r, { inheritedFrom: null }));
    }
    const cite = escapeHtml(r.author || "") + (r.year ? " (" + escapeHtml(r.year) + ")" : "");
    const titleHtml = r.url
      ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.title || "") + "</a>"
      : escapeHtml(r.title || "");
    return "<p style='margin:0 0 0.2rem'>" + escapeHtml(r.bound) + "</p>" +
      "<p style='margin:0;color:var(--muted);font-size:0.85rem'>" + cite + (r.title ? " — " + titleHtml : "") + "</p>";
  }
  function szResultLi(r) {
    return "<li>" + szCitationHtml(r) + "</li>";
  }

  function renderSearch() {
    if (SEARCH_BUILT) return;
    if (!DATA_SZ) {
      els.viewSearch.innerHTML = '<p class="design-intro">Loading The Scheduling Zoo data…</p>';
      loadSzData()
        .then(() => renderSearch())
        .catch((err) => {
          els.viewSearch.innerHTML =
            '<p style="color:#c92a2a">Failed to load data/schedulingzoo.json: ' + escapeHtml(String(err)) + "</p>";
        });
      return;
    }
    SEARCH_BUILT = true;
    if (!SZ_EFFECTIVE) SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges);
    const root = els.viewSearch;

    // A stable, readable row order: machine environment, then notation.
    const envRank = (e) => {
      const i = SZ_MACHINE_ENV_ORDER.indexOf(e);
      return i === -1 ? SZ_MACHINE_ENV_ORDER.length : i;
    };
    const nodes = DATA_SZ.nodes.slice().sort((a, b) =>
      envRank(a.machineEnv) - envRank(b.machineEnv) || a.notation.localeCompare(b.notation));

    // Each problem's parameterized results grouped by canonical label, once
    // ("#p+#d+#w" and "#p+#w+#d" are the same column).
    const resultsByLabel = new Map();
    const paramCounts = {};
    nodes.forEach((n) => {
      const byLabel = {};
      szAllParams(n).forEach((r) => {
        const l = canonicalParamLabel(r.param);
        (byLabel[l] = byLabel[l] || []).push(r);
      });
      Object.keys(byLabel).forEach((l) => { paramCounts[l] = (paramCounts[l] || 0) + 1; });
      resultsByLabel.set(n.id, byLabel);
    });
    const allParams = Object.keys(paramCounts).sort((a, b) => paramCounts[b] - paramCounts[a] || a.localeCompare(b));
    const shownParams = new Set(allParams);

    const swatch = (c) =>
      '<span class="legend-swatch" style="background:' +
      (c.opacity ? mixWithPanelBg(c.color, c.opacity) : c.fill ? c.color : "transparent") +
      ";border:2px " + (c.border || "solid") + " " + c.color + '"></span>';
    const legendItem = (c, label, title) =>
      '<div class="legend-item"' + (title ? ' title="' + escapeHtml(title) + '"' : "") + ">" +
      swatch(c) + "<span>" + escapeHtml(label) + "</span></div>";
    const usedClassical = new Set(nodes.map((n) => SZ_EFFECTIVE[n.id]));
    const usedParam = new Set();
    nodes.forEach((n) => szAllParams(n).forEach((r) => { if (r.complexityClass) usedParam.add(r.complexityClass); }));
    const classicalLegend = DATA.classicalClasses
      .filter((c) => usedClassical.has(c.id))
      .map((c) => legendItem(c, c.id === "unclaimed" ? "open" : c.label))
      .join("");
    const paramLegend = DATA.complexityClasses
      .filter((c) => usedParam.has(c.id))
      .map((c) => legendItem(c, c.label, c.description))
      .join("");

    const opts = szFilterOptions();
    root.innerHTML =
      '<p class="design-intro">Every problem in <a href="https://schedulingzoo.lip6.fr/" target="_blank" rel="noopener">' +
      "The Scheduling Zoo</a>'s bibliography, with its classical status and every parameterized result recorded for " +
      "it. Imported as-is, not independently verified by this site -- click a problem or a result for its " +
      'citations. The same problems drawn as a reduction graph are in the <a href="#/schedulingzoo">Scheduling Zoo</a> tab.</p>' +
      '<div class="sz-filters">' +
      '<input type="text" id="search-filter" class="sz-filter" placeholder="Search, e.g. 1 rj Uj, preemptive, setup, flow shop…">' +
      buildMsDropdownHtml("search-ms-machine-env", "Machine Environment", opts.machineEnvOptions) +
      '<span class="sz-field-sep">|</span>' +
      buildSzSettingsHtml("search-settings", szSettingGroups()) +
      '<span class="sz-field-sep">|</span>' +
      buildMsDropdownHtml("search-ms-objective", "Objective", opts.objectiveOptions) +
      '<button type="button" id="search-reset-btn" class="map-history-btn sz-reset-filters-btn"' +
      ' title="Clear the text box and every switch, and show every parameter again">↺ Reset filters</button>' +
      "</div>" +
      '<div class="search-params"><span class="search-params-label">Parameters shown</span>' +
      allParams
        .map((l) =>
          '<button type="button" class="chip active" aria-pressed="true" data-param="' + escapeHtml(l) + '" title="' +
          escapeHtml(paramCounts[l] + " problem" + (paramCounts[l] === 1 ? "" : "s") + " with a result for " + l) + '">' +
          escapeHtml(l) + "</button>")
        .join("") +
      "</div>" +
      '<div class="search-status"><span id="search-count"></span>' +
      '<label class="search-only-param"><input type="checkbox" id="search-only-param" checked> ' +
      "Only problems with a parameterized result</label></div>" +
      '<div class="matrix-wrap"><table class="matrix search-matrix">' +
      '<thead><tr id="search-matrix-head"></tr></thead><tbody id="search-matrix-body"></tbody></table>' +
      '<p id="search-empty" class="empty-state" hidden></p></div>' +
      '<div class="legend search-legend"><h2>Legend</h2>' +
      '<div class="legend-items"><span class="search-legend-label">Classical</span>' + classicalLegend +
      '<span class="search-legend-label">• = inherited through a reduction edge, not cited directly</span></div>' +
      '<div class="legend-items"><span class="search-legend-label">Parameterized</span>' + paramLegend +
      '<span class="search-legend-label">×n = n cited results, strongest shown · • = inherited along parameter-safe arrows</span></div>' +
      "</div>";

    const filterInput = root.querySelector("#search-filter");
    const onlyParam = root.querySelector("#search-only-param");
    const machineEnvMs = wireMsDropdown("search-ms-machine-env", root, "Machine Environment", update, (n) => n.machineEnv || "");
    const objectiveMs = wireMsDropdown("search-ms-objective", root, "Objective", update, (n) => canonicalSzObjective(n.objective));
    const settingsMs = wireSzSettingsDropdown("search-settings", root, update);

    function update() {
      const q = filterInput.value.trim().toLowerCase();
      const envSel = machineEnvMs.getSelected();
      const objSel = objectiveMs.getSelected();
      const setSel = settingsMs.getSelected();
      const base = nodes.filter((n) =>
        szNodeMatchesQuery(n, q) &&
        msSelectionAccepts(envSel, n.machineEnv || "") &&
        msSelectionAccepts(objSel, canonicalSzObjective(n.objective)) &&
        szNodeMatchesSettings(n, setSel));
      const rows = onlyParam.checked
        ? base.filter((n) => Object.keys(resultsByLabel.get(n.id)).some((l) => shownParams.has(l)))
        : base;
      // The dropdown counts describe the rows actually listed, the same way
      // the overview's counts describe what its filter selects.
      const ids = new Set(rows.map((n) => n.id));
      machineEnvMs.refreshCounts(ids);
      objectiveMs.refreshCounts(ids);
      settingsMs.refreshCounts(ids);
      renderRows(rows, base.length);
    }

    function renderRows(rows, baseCount) {
      const empty = root.querySelector("#search-empty");
      empty.hidden = rows.length > 0;
      empty.textContent = onlyParam.checked && baseCount
        ? baseCount + (baseCount === 1 ? " problem matches" : " problems match") + " these filters, but none has a " +
          "parameterized result -- untick \"Only problems with a parameterized result\" to list them."
        : "No problems match the current filters.";
      root.querySelector("#search-count").textContent =
        "Showing " + rows.length + " of " + DATA_SZ.nodes.length + " problems";

      // Columns: parameters that are switched on AND have a result in at
      // least one listed row -- no column of nothing but dashes.
      const present = new Set();
      rows.forEach((n) => Object.keys(resultsByLabel.get(n.id)).forEach((l) => present.add(l)));
      const cols = allParams.filter((l) => shownParams.has(l) && present.has(l));
      root.querySelector("#search-matrix-head").innerHTML = rows.length
        ? '<th class="problem-col">Problem (α|β|γ)</th><th>Classical</th>' +
          cols.map((l) => '<th title="' + escapeHtml("parameterized by " + l) + '">' + escapeHtml(l) + "</th>").join("")
        : "";

      root.querySelector("#search-matrix-body").innerHTML = rows
        .map((n) => {
          const eff = SZ_EFFECTIVE[n.id];
          const cc = classicalClassById(eff);
          const open = !eff || eff === "unclaimed";
          const direct = n.classicalClass && n.classicalClass !== "unclaimed";
          const ccLabel = open ? "open" : cc ? cc.label : eff;
          const ccTitle = direct
            ? "Cited directly -- click for the citations"
            : open
              ? "No classical claim, direct or inherited"
              : "Inherited: generalizes a problem classified " + ccLabel;
          const byLabel = resultsByLabel.get(n.id);
          return "<tr>" +
            '<td class="problem-cell"><button type="button" class="search-problem-link" data-sz-id="' +
            escapeHtml(n.id) + '">' + escapeHtml(n.notation) + "</button></td>" +
            '<td class="result-cell"><button type="button" class="badge" data-sz-id="' + escapeHtml(n.id) +
            '" style="' + classPillStyle(cc) + '" title="' + escapeHtml(ccTitle) +
            '" aria-label="' + escapeHtml("Classical: " + ccLabel + ". " + ccTitle) + '">' + escapeHtml(ccLabel) +
            (!direct && !open ? '<span class="conf-flag">•</span>' : "") + "</button></td>" +
            cols
              .map((l) => {
                const rs = byLabel[l];
                if (!rs) return '<td class="result-cell"><div class="badge na">—</div></td>';
                const best = bestParamComplexityClass(rs);
                const pc = best ? classById(best) : null;
                // • when the class shown comes only from an inherited result
                const inheritedOnly = !!best && bestParamComplexityClass(rs.filter((r) => !r.inheritedFrom)) !== best;
                return '<td class="result-cell"><button type="button" class="badge" data-sz-id="' + escapeHtml(n.id) +
                  '" data-param="' + escapeHtml(l) + '" style="' +
                  (pc ? classPillStyle(pc) : "background:transparent;color:var(--muted);border:2px dashed #868e96") +
                  '" title="' + escapeHtml(rs.length + " cited result" + (rs.length === 1 ? "" : "s") + " -- click for details") +
                  // The title alone would become the accessible name, which
                  // never says the class the cell is showing.
                  '" aria-label="' + escapeHtml((pc ? pc.label : "Unclassified result") + " for " + l + ", " +
                    rs.length + " cited result" + (rs.length === 1 ? "" : "s")) +
                  '">' + escapeHtml(pc ? pc.label : "other") +
                  (rs.length > 1 ? '<span class="conf-flag">×' + rs.length + "</span>" : "") +
                  (inheritedOnly ? '<span class="conf-flag" title="Inherited along parameter-safe arrows">•</span>' : "") + "</button></td>";
              })
              .join("") +
            "</tr>";
        })
        .join("");
    }

    filterInput.addEventListener("input", update);
    onlyParam.addEventListener("change", update);
    root.querySelector(".search-params").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const l = chip.dataset.param;
      if (shownParams.has(l)) shownParams.delete(l);
      else shownParams.add(l);
      chip.classList.toggle("active", shownParams.has(l));
      chip.setAttribute("aria-pressed", shownParams.has(l) ? "true" : "false");
      update();
    });
    root.querySelector("#search-matrix-body").addEventListener("click", (e) => {
      const el = e.target.closest("[data-sz-id]");
      if (!el) return;
      if (el.dataset.param) openSzParamResultsPanel(el.dataset.szId, el.dataset.param);
      else openSchedulingZooPanel(el.dataset.szId);
    });
    // Rebuilding is the simplest complete reset: every switch, the text
    // box, the parameter chips and the checkbox all come back at default.
    root.querySelector("#search-reset-btn").addEventListener("click", () => {
      SEARCH_BUILT = false;
      renderSearch();
    });
    update(); // fill the table for the first time
  }

  // One problem's results for ONE parameter (a Search matrix cell): the
  // class shown in the cell, what it means, and every citation behind it.
  function openSzParamResultsPanel(nodeId, label) {
    const n = DATA_SZ.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const rs = szAllParams(n).filter((r) => canonicalParamLabel(r.param) === label);
    const best = bestParamComplexityClass(rs);
    const pc = best ? classById(best) : null;
    const pill = (c) => '<span class="class-pill" style="' + classPillStyle(c) + '">' + escapeHtml(c.label) + "</span>";
    els.detailContent.innerHTML =
      "<h3>" + escapeHtml(n.notation) + " — parameterized by " + escapeHtml(label) + "</h3>" +
      (pc
        ? '<div class="detail-class-badge" style="' + classPillStyle(pc) + '">' + escapeHtml(pc.label) + "</div>" +
          detailField("What this means", pc.description) +
          (rs.length > 1
            ? detailField("Why this class", "It is the strongest of the cited results below: a hardness result wins over a positive one, and within each kind the strongest statement wins.")
            : "")
        : detailField("Classification", "None of the cited results below is an FPT, XP, W-hardness or para-NP-hardness statement this site recognizes (for example a fine-grained running-time bound), so no class is shown.")) +
      '<div class="detail-field"><h4>Result' + (rs.length === 1 ? "" : "s") + " (cited in The Scheduling Zoo, or inherited from one)</h4>" +
      '<ul class="result-list">' +
      rs.map((r) => {
        const c = r.complexityClass ? classById(r.complexityClass) : null;
        return "<li>" + (c ? "<p style='margin:0 0 0.3rem'>" + pill(c) + "</p>" : "") + szCitationHtml(r) + "</li>";
      }).join("") +
      "</ul></div>" +
      '<p style="margin-top:1rem"><a class="wiki-back" href="javascript:void(0)" id="search-open-problem">Every result for this problem →</a></p>';
    els.detailContent.querySelector("#search-open-problem").addEventListener("click", () => openSchedulingZooPanel(n.id));
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
  // map).
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
  // 420px-ish width for panels with no such content (e.g. the Search
  // matrix's single-parameter view).
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
        '<div class="wiki-page"><a class="wiki-back" href="#/maps">&larr; Back to problem maps</a><p>Unknown problem: ' +
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
      '<a class="wiki-back" href="#/maps">&larr; Back to problem maps</a>' +
      "<h2>" + p.notation + "</h2>" +
      '<p class="wiki-alphabetagamma">' + p.name + "</p>" +
      '<div class="wiki-status"><b>Classical (unparameterized) status</b>' + ccBadge + linkifyCitations(p.classicalStatus) + "</div>" +
      '<div class="wiki-section wiki-overview"><h3>Overview</h3><p>' + linkifyCitations(p.overview || "") + "</p></div>" +
      '<div class="wiki-section"><h3>Parameterized results</h3>' + resultsHtml + "</div>" +
      '<div class="wiki-section"><h3>Related problems</h3>' + relatedHtml + "</div>" +
      "</div>";
  }

  // ---------- documentation ----------

  // Static reference pages about how this site's own model works -- as
  // opposed to References (the literature). Written as literal markup rather
  // than driven off a data file: this is prose about the model itself, and
  // it should be edited the way prose is, not squeezed into a JSON schema.
  function renderDocs() {
    els.viewDocs.innerHTML =
      '<div class="docs-page">' +
      '<h2 class="page-title">Documentation</h2>' +
      '<p class="design-intro">How to read the graphs on this site -- what an arrow actually claims, ' +
      "and how far that claim reaches -- and how the data from The Scheduling Zoo is read and combined.</p>" +
      '<nav class="docs-toc" aria-label="Contents"></nav>' +

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
      "<li><b>Scheduling Zoo map and Search:</b> classical hardness is inherited along every arrow. " +
      "Parameterized hardness (W[1], W[2], para-NP) is inherited only along arrows whose kind is known to keep " +
      "the parameter bounded -- a value restriction, or padding with constant data that doesn't feed the " +
      "parameter -- and this <b>is</b> checked, arrow by arrow, when the data is built (see Inherited hardness " +
      "below). FPT, XP and P never transfer.</li>" +
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

      '<section class="docs-section" id="docs-scheduling-zoo-data">' +
      "<h3>Data from The Scheduling Zoo</h3>" +
      "<p>The Search tab and the Scheduling Zoo map are built from " +
      '<a href="https://schedulingzoo.lip6.fr/" target="_blank" rel="noopener">The Scheduling Zoo</a> ' +
      "(schedulingzoo.lip6.fr, by Christoph Dürr and contributors, MIT License). It keeps every result as a " +
      "BibTeX entry whose annotation lists problems in α|β|γ notation with a bound, such as <code>is in P</code> " +
      "or <code>is strongly NP-hard</code>, plus a file, <code>notation.xml</code>, defining each field's values " +
      "and the reduction rules between them. This site runs The Scheduling Zoo's own parser on those files, " +
      "unmodified, and converts its output into problems and arrows.</p>" +

      "<h4>How it stores parameterized results</h4>" +
      "<p>A parameterized result is the problem followed by its parameters in brackets, several parameters " +
      "separated by semicolons (plain text here):</p>" +
      '<p class="docs-example"><code>P2|rj|Lmax [pw(I)]</code> is para-NP-complete<br>' +
      "<code>P|Mj;prec;rj;l|Cmax [pw(I);pmax]</code> is fixed parameter tractable</p>" +
      "<p>The parser reads the bracket as extra fields of the same problem, so <code>X</code> and " +
      "<code>X [k]</code> come out as two unrelated problems: the parameterized one has no arrows to its base " +
      "problem and gets a color of its own.</p>" +

      "<h4>How this site combines them</h4>" +
      '<ul class="docs-list">' +
      "<li><b>One node per problem.</b> Every <code>X [k]</code> result is attached to the base problem " +
      "<code>X</code> as one of its parameterized results, and the parameter fields are ignored when arrows are " +
      "computed, so arrows only ever connect base problems.</li>" +
      "<li><b>Combined parameters.</b> <code>[pw(I);pmax]</code> is shown as <code>pmax+pw(I)</code>: all of " +
      "them bounded at once. The same set in a different order -- <code>#p+#w+#d</code> and " +
      "<code>#p+#d+#w</code> are both cited for <code>1|rj|ΣwjUj</code> -- counts as one parameter.</li>" +
      "<li><b>Same problem, different spelling.</b> Problems whose settings are only listed in a different " +
      "order, like <code>P|pj=p;rj|…</code> and <code>P|rj;pj=p|…</code>, are merged into one node.</li>" +
      "<li><b>Nested parameters.</b> In a problem's panel, a parameter set that contains another is drawn " +
      "beneath it: <code>#d+#r</code> above <code>#d+#p+#r</code>.</li>" +
      "</ul>" +

      "<h4>How results are classified</h4>" +
      "<p>The Scheduling Zoo itself only marks a result as positive or negative. This site reads the wording of " +
      "each bound instead, recognizing only its standard phrases:</p>" +
      '<ul class="docs-list">' +
      "<li><b>Classical</b> (no bracket): <code>is strongly NP-hard</code> → strongly NP-hard; " +
      "<code>is NP-hard</code> together with <code>is in Ppseudo</code> → pseudo-polynomial time solvable; " +
      "<code>is NP-hard</code> alone → at least weakly NP-hard; <code>is in P</code> or a stated polynomial " +
      "running time → P. NP-complete counts as NP-hard, hardness wins when both kinds are cited, and a problem " +
      "with none of these phrases is open.</li>" +
      "<li><b>Parameterized</b> (bracket): <code>is fixed parameter tractable</code> → FPT; " +
      "<code>is in P</code> or <code>is in Ppseudo</code> → XP, read as solvable for every fixed value of the " +
      "parameter, which does not make it FPT; <code>W[1]-hard</code> / <code>W[2]-hard</code> → W[1]- / " +
      "W[2]-hard; <code>para-NP-hard</code> or <code>is NP-hard</code> → para-NP-hard, i.e. hard even for a " +
      "constant value. Other bounds, such as ETH-based running-time lower bounds or approximation ratios, are " +
      "listed as text without a class.</li>" +
      "<li><b>Several results for one parameter.</b> The strongest is shown: para-NP-hard, then W[2]-hard, " +
      "W[1]-hard, FPT, XP.</li>" +
      "</ul>" +

      "<h4>Inherited hardness</h4>" +
      "<p>A problem with no classical result of its own takes the hardness of any special case of it -- any " +
      "problem its arrows reach -- that is proven hard. Strongly NP-hard carries over as it is; " +
      "pseudo-polynomial carries over only as at least weakly NP-hard, since its algorithm need not extend to the " +
      "more general problem; P never carries over. A problem's panel says when its class is inherited. " +
      "</p>" +
      "<p>Parameterized <b>hardness</b> (W[1], W[2], para-NP) is carried too, but only along arrows known to keep " +
      "the parameter bounded. An arrow qualifies when every field it changes either reads the same instance with " +
      "a wider value (a set of chains is a precedence order, p<sub>j</sub>=1 is p<sub>j</sub>=p with p=1) or pads " +
      "it with constant data (weights 1, due dates or release dates 0, speeds 1, every machine eligible). Paddings " +
      "exclude the measures built from the padded data: release and due dates set to 0 change the windows behind " +
      "pw(I) and slack<sub>max</sub>, and unrelated machines rescale the processing times behind p<sub>max</sub> " +
      "and #p. Nothing is carried across machine counts, preemption, the online model, or objective changes that " +
      "only hold at one threshold. For example, P|r<sub>j</sub>;p<sub>j</sub>=p|ΣU<sub>j</sub> is W[2]-hard in " +
      "m, and weighting its jobs changes nothing about m, so P|r<sub>j</sub>;p<sub>j</sub>=p|Σw<sub>j</sub>U<sub>j</sub> " +
      "is W[2]-hard in m too. Inherited results are marked in the Search matrix and explained, with the chain of " +
      "arrows, in each problem's panel. Positive results (FPT, XP) are not carried yet.</p>" +

      "<h4>Where this site reads the data differently</h4>" +
      "<p>Two reduction rules are corrected (setup times under a single server, and multiprocessor tasks on " +
      "parallel machines), one is added (machine counts), two conditions of the problem-builder form are " +
      "corrected, and one typo is tolerated. Each is explained, with its " +
      "evidence, " +
      'under <a href="#/docs/docs-anomalies">Known data anomalies</a> below. The Scheduling ' +
      "Zoo's own files are never edited.</p>" +
      "</section>" +
      szAnomaliesSectionHtml() +
      "</div>";
    buildDocsToc(els.viewDocs);
  }

  // Contents for a page of prose (Documentation, What's Coming Next), built
  // from its own headings: every section (h3) and its subsections (h4), each
  // linked as #/<route>/<id>.
  function buildDocsToc(root, route) {
    route = route || "docs";
    const toc = root.querySelector(".docs-toc");
    if (!toc) return;
    const used = new Set();
    const idFor = (el) => {
      if (el.id) return el.id;
      let base = route + "-" + el.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      let id = base, n = 2;
      while (used.has(id) || document.getElementById(id)) id = base + "-" + n++;
      el.id = id;
      return id;
    };
    const link = (el) => '<a href="#/' + route + "/" + encodeURIComponent(idFor(el)) + '">' + escapeHtml(el.textContent) + "</a>";
    toc.innerHTML = "<h3>Contents</h3><ol>" +
      Array.from(root.querySelectorAll(".docs-section")).map((sec) => {
        const h3 = sec.querySelector("h3");
        if (!h3) return "";
        if (!h3.id) h3.id = sec.id;
        used.add(h3.id);
        const subs = Array.from(sec.querySelectorAll("h4"));
        return "<li>" + link(h3) + (subs.length ? "<ol>" + subs.map((h) => { const l = link(h); used.add(h.id); return "<li>" + l + "</li>"; }).join("") + "</ol>" : "") + "</li>";
      }).join("") + "</ol>";
  }

  // Known data anomalies in The Scheduling Zoo, and how this site reads
  // around them -- one subsection per note, so each gets a Contents entry.
  function szAnomaliesSectionHtml() {
    if (!SZ_FLAGGED_EDGES.length && !SZ_DATA_NOTES.length) return "";
    const byId = {};
    if (DATA_SZ) DATA_SZ.nodes.forEach((n) => { byId[n.id] = n; });
    return '<section class="docs-section" id="docs-anomalies">' +
      "<h3>Known data anomalies in The Scheduling Zoo</h3>" +
      "<p>Things we spot-checked and found inconsistent, or noteworthy gaps, in The Scheduling Zoo's own data." +
      (SZ_FLAGGED_EDGES.length ? " Arrows we only flag are drawn red and dashed on the Scheduling Zoo map." : "") +
      " Its source files are left exactly as-is. Four things change how we read them: a single confirmed typo our " +
      "classifier tolerates, two conditions of the problem-builder form, and two reduction rules we replace with " +
      "corrected versions -- setup times under a single server, and multiprocessor tasks on parallel machines. " +
      "Arrows that exist only because of a rule of ours look like any other arrow; clicking one says which rule " +
      "added it.</p>" +
      SZ_FLAGGED_EDGES.map((f) => {
        const from = byId[f.from], to = byId[f.to];
        return "<h4>Flagged: " + escapeHtml(from ? from.notation : f.from) + " → " + escapeHtml(to ? to.notation : f.to) + "</h4>" +
          "<p>" + escapeHtml(f.note) + "</p>";
      }).join("") +
      SZ_DATA_NOTES.map((n) => "<h4>" + escapeHtml(n.title) + "</h4><p>" + escapeHtml(n.body) + "</p>").join("") +
      "</section>";
  }

  // ---------- what's coming next ----------

  // The roadmap: long-term goals, then the extensions we plan. Prose, so
  // written as markup like Documentation, with the same contents box.
  function renderNext() {
    const code = (s) => "<code>" + s + "</code>";
    els.viewNext.innerHTML =
      '<div class="docs-page">' +
      "<h2 class=\"page-title\">What's Coming Next</h2>" +
      '<p class="design-intro">Where this project is heading: the goal behind it, and the extensions we plan. ' +
      "None of this exists on the site yet.</p>" +
      '<nav class="docs-toc" aria-label="Contents"></nav>' +

      '<section class="docs-section" id="next-goals">' +
      "<h3>Long-term goal: persisting domain knowledge and making it easy to reach</h3>" +
      "<p>What the scheduling community knows about the complexity of its problems is spread over decades of " +
      "papers, surveys and tables, and much of it lives only in the heads of the people who proved it: which " +
      "reductions are folklore, which results quietly depend on a restriction, which questions are still open. " +
      "The Scheduling Zoo made a large part of that searchable. We want to go further in two directions.</p>" +
      "<h4>Persisting it</h4>" +
      "<p>Knowledge that is written down once and checked keeps its value. That means keeping every result " +
      "tied to its source, every reduction tied to a statement of what it preserves, and every correction to the " +
      "record visible rather than silently applied -- the way the anomaly notes in the Documentation already work. " +
      "Problem maps are the first piece of this built here, and today they only live in one browser. The next " +
      "step is to keep them as files in the repository, so a map becomes a reviewable, citable contribution with " +
      "a history, and to offer JSON export and import for anyone working offline.</p>" +
      "<h4>Making it easy to reach</h4>" +
      "<p>A researcher should get from a question -- is this variant hard? for which parameter? what is the " +
      "closest known result? -- to the answer and its citation in a few clicks, without first learning a " +
      "notation or reading the survey it came from. The search, the filters and the maps on this site are the " +
      "start of that; every extension below is judged by whether it keeps that path short.</p>" +
      "</section>" +

      '<section class="docs-section" id="next-models">' +
      "<h3>Scheduling is a zoo; this site is a simplification of it</h3>" +
      "<p>Everything here is squeezed into Graham's three fields: one machine environment, a list of settings, " +
      "one objective. That already covers a great deal, but the problems people actually study keep escaping it, " +
      "and today they are either left out or forced into a string that loses what makes them different.</p>" +
      "<h4>Richer machine environments</h4>" +
      "<p>Hybrid and flexible shops such as " + code("F(1,m)") + " -- one machine at the first stage, " +
      code("m") + " parallel machines at the second -- have no place in The Scheduling Zoo's notation, which is " +
      "why the Just-in-Time map lives in our own data. We want environments described by their structure " +
      "(stages, machines per stage, eligibility) rather than by a fixed list of letters, so that such problems " +
      "take part in search, filters and arrows like any other.</p>" +
      "<h4>More than one objective, and more than one kind of input</h4>" +
      "<p>Bicriteria and Pareto problems, weighted combinations of objectives, stochastic and robust " +
      "scheduling, energy and resource constraints, and scenario-based inputs all change what a " +
      "\"problem\" is. Supporting them means storing problems as structured records whose fields can be " +
      "added without breaking the old ones, instead of as notation strings.</p>" +
      "<h4>Problems as data, not strings</h4>" +
      "<p>Most of the effort behind this site went into reading strings: sorting settings to recognise the same " +
      "problem written twice, and checking which combinations are even well-formed. A structured model with " +
      "explicit fields, value orders and validity rules makes those questions answerable directly, and makes the " +
      "reduction rules part of the data instead of a separate file to keep in sync.</p>" +
      "</section>" +

      '<section class="docs-section" id="next-parameterized-reductions">' +
      "<h3>Parameterized reductions</h3>" +
      "<p>An arrow on these maps says that one problem is a special case of another, which is enough to carry " +
      "classical NP-hardness. It is not enough to carry parameterized results. A W[1]-hardness result for a " +
      "parameter travels along an arrow only if the reduction keeps that parameter bounded, and an FPT " +
      "algorithm travels the other way only under the same condition. Documentation → Arrow rule types explains " +
      "why the question has no single answer per arrow.</p>" +
      "<h4>What we plan to record</h4>" +
      "<p>For every reduction, for which parameters it is safe, and in what sense: the parameter keeps its " +
      "value; it is bounded by a function of the original parameter; or it becomes unbounded. The Problem Map " +
      "Designer already asks a first, deliberately coarse version of this question when an arrow is drawn. " +
      "The full model needs to be per parameter, and needs to follow the parameter hierarchy -- a reduction " +
      "that is safe for " + code("#p") + " is also safe for every parameter that bounds " + code("#p") + ".</p>" +
      "<h4>What it enables</h4>" +
      "<p>A first, conservative version is already live: parameterized hardness is carried along The Scheduling " +
      "Zoo's own arrows whose kind is known to keep the parameter bounded (Documentation → Inherited hardness). " +
      "With safety recorded per reduction, hardness and tractability can be propagated across every map the way " +
      "classical hardness is, each inferred result showing the chain of reductions it rests on. Gaps " +
      "become visible too: a problem whose neighbours are W[1]-hard for a parameter along safe arrows, but which " +
      "has no result of its own, is a natural open question.</p>" +
      "</section>" +

      '<section class="docs-section" id="next-approximation">' +
      "<h3>Approximation hardness</h3>" +
      "<p>The Scheduling Zoo already contains approximation results -- ratios achieved, inapproximability " +
      "bounds, PTAS and EPTAS results -- which this site currently shows as text without a class. They deserve " +
      "their own view.</p>" +
      "<h4>How to visualise it</h4>" +
      "<p>Unlike P versus NP-hard, approximability is not a single label but an interval: the best ratio " +
      "achieved, and the best ratio ruled out. We plan a separate lens on the same maps that draws that " +
      "interval on every node, closing to a single point where the answer is known and highlighting where the " +
      "gap is widest. Scheme-type results (FPTAS, EPTAS, PTAS, APX-hard) fit the same scale as its end points.</p>" +
      "<h4>Which arrows carry it</h4>" +
      "<p>Not every reduction preserves approximation: a special case inherits algorithms with their ratio, " +
      "but hardness of approximation needs approximation-preserving reductions (L-, AP- or PTAS-reductions). " +
      "Arrows will record which kind they are, in the same way as for parameters, and the lens will only carry " +
      "bounds along the arrows that support them.</p>" +
      "</section>" +

      '<section class="docs-section" id="next-online">' +
      "<h3>Competitive ratio: online hardness</h3>" +
      "<p>Online problems -- jobs revealed over time, decisions that cannot be revised -- are measured by their " +
      "competitive ratio rather than by running time. The Scheduling Zoo lists them (the " + code("online-rj") +
      " problems), but a single colour cannot say anything useful about them.</p>" +
      "<h4>What to show</h4>" +
      "<p>The same interval idea as for approximation: the best competitive ratio achieved and the best lower " +
      "bound, kept separately for deterministic and randomised algorithms, since they often differ. A lower " +
      "bound proved by an adversary on a special case holds for the general problem too, so these bounds can be " +
      "propagated along arrows -- as long as the arrow keeps the online model itself, which the arrow's " +
      "description will have to say.</p>" +
      "</section>" +

      '<section class="docs-section" id="next-lean">' +
      "<h3>Lean 4: stating and verifying reductions</h3>" +
      "<p>Every arrow on these maps is a claim. Most are obvious, some are subtle, and a few -- as the anomaly " +
      "notes show -- turned out to be wrong in widely used data. A proof assistant can remove the doubt.</p>" +
      "<h4>Statements</h4>" +
      "<p>We plan to express scheduling problems and reductions in Lean 4: a problem as a type of instances with " +
      "a feasibility predicate and an objective, a reduction as a function between instance types together with " +
      "the theorem that it preserves the answer. The properties this page is about become further theorems " +
      "about the same function -- that it runs in polynomial time, that it keeps numbers polynomially bounded, " +
      "that it keeps a given parameter bounded.</p>" +
      "<h4>Verification on the site</h4>" +
      "<p>Arrows backed by a checked proof would carry a verified mark and link to it, and proofs would be " +
      "re-checked automatically whenever the repository changes. Value restrictions -- the large majority of " +
      "arrows -- should be close to mechanical to state, so the aim is to cover them wholesale first and treat " +
      "encoding reductions one by one.</p>" +
      "</section>" +
      "</div>";
    buildDocsToc(els.viewNext, "next");
  }

  // ---------- problem maps (generalization poset diagrams) ----------

  // ---------- saved problem maps (built from The Scheduling Zoo data) ----------
  // Kept in this browser's localStorage for now -- see the Problem Maps
  // page. A map is { id, title, createdAt, updatedAt, problemIds,
  // positions: {id: {left, top}}, drafts: {id: draft problem}, notations }.
  const SAVED_MAPS_KEY = "psz.problemMaps.v1";
  function loadSavedMaps() {
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_MAPS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function storeSavedMaps(list) {
    try {
      localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function renderZooMapsIndex() {
    const maps = loadSavedMaps().slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };
    els.viewZooMaps.innerHTML =
      '<h2 class="page-title">Problem Maps</h2>' +
      '<p class="design-intro">Maps of problems from The Scheduling Zoo, built in the Problem Map Designer or saved ' +
      "from the Scheduling Zoo map. They are stored in this browser only for now.</p>" +
      '<div class="map-list">' +
      '<a class="map-card map-card-new" href="#/design/new"><h3>+ Create a New Problem Map</h3>' +
      "<p>Opens the Problem Map Designer with an empty map.</p></a>" +
      maps.map((m) => {
        const n = (m.problemIds || []).length;
        const preview = (m.notations || []).slice(0, 4).join(", ") + (n > 4 ? ", …" : "");
        return '<div class="map-card map-card-saved">' +
          '<a class="map-card-link" href="#/design/' + encodeURIComponent(m.id) + '">' +
          "<h3>" + escapeHtml(m.title || "Untitled problem map") + "</h3>" +
          "<p>" + n + " problem" + (n === 1 ? "" : "s") + (m.updatedAt ? " · saved " + escapeHtml(when(m.updatedAt)) : "") +
          (preview ? "<br>" + escapeHtml(preview) : "") + "</p></a>" +
          '<button type="button" class="map-history-btn map-card-delete" data-delete-map="' + escapeHtml(m.id) + '">Delete</button>' +
          "</div>";
      }).join("") +
      "</div>" +
      (maps.length ? "" : '<p class="design-intro" style="margin-top:1rem">No saved maps yet.</p>');
    els.viewZooMaps.querySelectorAll("[data-delete-map]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = loadSavedMaps().find((x) => x.id === btn.dataset.deleteMap);
        if (!m || !window.confirm("Delete “" + (m.title || "Untitled problem map") + "”? This can't be undone.")) return;
        storeSavedMaps(loadSavedMaps().filter((x) => x.id !== m.id));
        renderZooMapsIndex();
      });
    });
  }

  function renderMapsIndex() {
    els.viewMaps.innerHTML =
      '<h2 class="page-title">Problem Maps [WIP]</h2><div class="map-list">' +
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

  // Generalization edges in The Scheduling Zoo's own reduction graph that
  // we've spot-checked and found inconsistent with its OWN cited results,
  // and flag rather than correct: red/dashed on the map, listed at the
  // bottom of the view. Each entry's `from`/`to` are raw ids
  // (DATA_SZ.nodes[].id). Empty for now -- the only such edge,
  // P2|fixj|Cmax -> P2||Cmax, came from a rule we now correct (see
  // SZ_FIXJ_SHOP_NOTE), so it is no longer drawn.
  const SZ_FLAGGED_EDGES = [];
  function szFlaggedEdgeFor(from, to) {
    return SZ_FLAGGED_EDGES.find((f) => f.from === from && f.to === to);
  }

  // Shared between the green edges' click-through panel and the data note
  // below it -- one source of truth for why OUR_MACHINE_COUNT_RULES (see
  // convert_for_pzoo.py) is sound.
  const SZ_MACHINE_COUNT_RULE_NOTE =
    "The Scheduling Zoo's own \"number of machines\" field has zero reduction rules (see Known data anomalies in the Documentation) -- so we " +
    "added our own: m reduces to m+1 (1->2->3->4->5->arbitrary), layered on TOP of The Scheduling Zoo's data, never " +
    "replacing anything they declared. Sound for every objective in this corpus regardless of machine " +
    "environment: for P/Q/R, an m-machine schedule stays valid with an extra machine simply left unused; for " +
    "O/F/J (where machine count = operations per job), pad every job with one zero-duration operation on the " +
    "extra machine -- neither changes any completion time, so the optimum can only get better or stay the same " +
    "with more machines, never worse, for any regular objective (Cmax, sums of completion/tardiness/flow times, " +
    "Lmax, throughput -- all of them). Restricted to fire ONLY when machine count is the sole differing field " +
    "(never combined with any other simultaneous relaxation) -- see the next data note for why. An edge is " +
    "counted as added by this site only when it exists ONLY due to this rule -- checked against The Scheduling Zoo's own " +
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
    "make trivial. The Scheduling Zoo's notation.xml labels that value \"no setup\" and declares \"\" -> sij=1 -> sij=s " +
    "(the same for sj), which makes arbitrary setups the most RESTRICTED case. That put 19 wrong edges in their " +
    "graph, 14 of them placing a problem cited P above one cited NP-hard (the F2;S1 cluster we used to flag " +
    "edge by edge). It is also what broke our machine-count rule whenever it combined with another field: 27 " +
    "contradictions, every one involving S1. Our correction, in our converter only (The Scheduling Zoo's files are " +
    "untouched): drop the four \"\" -> s rules and chain s=1 -> s=s -> arbitrary, gated on S1 -- a two-field " +
    "(server, setup times) rule, so it never fires for a problem without a server. Result: those 19 edges " +
    "are gone, none added, no S1 contradiction remains, and the combined machine-count edges now contradict " +
    "0 of 170. Suggested upstream fix: replace <reduction from=\"\" to=\"s_{ij}=1\"/> with " +
    "<reduction from=\"S1;s_{ij}=1\" to=\"S1;not setup times\"/> and " +
    "<reduction from=\"S1;s_{ij}=s\" to=\"S1;not setup times\"/> (both spelled out: extend_complex_reduction " +
    "never actually composes rules, its recursive calls are never iterated), likewise for s_j, and relabel " +
    "the empty choice \"arbitrary setup times\".";

  // Shared between the fix_j data note and the panel of any edge that exists
  // only because of our shop-only fix_j rule (OUR_SHOP_FIX_J_RULES in
  // convert_for_pzoo.py). On today's data that rule only removes edges.
  const SZ_FIXJ_SHOP_NOTE =
    "The Scheduling Zoo's notation.xml declares <reduction from=\"\" to=\"fix_j\"/>: a problem with no machine-set " +
    "constraint is a special case of the same problem where every job needs a given set of machines at once " +
    "(fixj, multiprocessor tasks). Whether that holds depends on the machine environment. In a shop (O, F, J) " +
    "every operation's machine is already part of the input -- \"operation Oij must be processed on machine i\" " +
    "-- so the plain shop is fixj with every set of size one, and the rule holds. On parallel machines (P, Q, R) " +
    "an empty field means the scheduler chooses one machine per job, while fixj makes the machines part of the " +
    "input: no choice of sets reproduces that choice without solving the problem (for P2||Cmax, picking the " +
    "right sets is solving Partition), and a job holding several machines at once has no counterpart the other " +
    "way. The citations show the break: P2|fixj|Cmax is in P (Hoogeveen, van de Velde & Veltman 1994, p. 261: " +
    "run the tasks needing both machines first, then each machine's own tasks back to back), yet the rule drew " +
    "it as generalizing P2||Cmax, which is NP-hard. On the map the rule drew 7 relations on parallel machines, " +
    "all false -- that one clashed with a citation, the other six sit between hard problems where nothing " +
    "showed -- while all of its shop relations are true. Our correction, in our converter only (The Scheduling " +
    "Zoo's files are untouched): drop the one-field rule and keep it for shops only, as a two-field (machine " +
    "sets, type) rule. Result: the 7 parallel-machine relations, including the arrow we used to flag red, are " +
    "gone; nothing is added; every shop relation is still on the map; and no arrow now puts a problem cited P " +
    "above one cited NP-hard. Suggested upstream fix: replace <reduction from=\"\" to=\"fix_j\"/> with " +
    "<reduction from=\"O;not machine sets\" to=\"O;fix_j\"/>, the same for F and J, and " +
    "<reduction from=\"F;not machine sets\" to=\"J;fix_j\"/> (spelled out, as extend_complex_reduction never " +
    "composes rules). Run through The Scheduling Zoo's own parser, that gives exactly the same graph as our " +
    "correction.";

  // Which of our notes explains a green (added-by-this-site) edge.
  function szAddedEdgeNote(edge) {
    if (edge.addedBy === "s1-setup") return SZ_S1_SETUP_NOTE;
    if (edge.addedBy === "fixj-shop") return SZ_FIXJ_SHOP_NOTE;
    return SZ_MACHINE_COUNT_RULE_NOTE;
  }

  // General notes about schedzoo's own data that don't attach to one
  // specific edge (so there's nothing to mark red/dashed on the graph) --
  // typos we've silently compensated for in our classifier, and structural
  // gaps in their reduction graph. Shown alongside SZ_FLAGGED_EDGES at the
  // bottom of this view.
  const SZ_DATA_NOTES = [
    {
      title: "Typo silently tolerated: \"in in $P$\" for P|pj=p;rj|Lmax",
      body:
        "Simons:83's citation for P|pj=p;rj|Lmax literally reads \"in in $P$\" in The Scheduling Zoo's own bib file -- a " +
        "doubled word, not \"is in $P$\" like its three sibling citations from the very same paper. Confirmed " +
        "it's the only citation in the whole corpus starting with \"in \". Our classifier now recognizes this " +
        "specific typo (checked it can't match anything else), so the node shows P as intended -- The Scheduling Zoo's " +
        "source text itself is untouched.",
    },
    {
      title: "No reduction rule connects single-machine (\"1\") to multi-machine (\"P\"/\"Q\"/\"R\"/...) problems",
      body:
        "Checked both fields that could carry this. The \"type\" field (alpha: 1/P/Q/R/O/F/J) does have " +
        "reduction rules -- but only among the multi-machine environments themselves (P->Q->R, F->J); none " +
        "mention \"1\" at all. That's because The Scheduling Zoo's own parser never actually assigns type=\"1\" to a " +
        "parsed single-machine problem -- it assigns type=\"P\" (same as ordinary parallel-machine problems) " +
        "plus a separate \"number of machines\"=\"1\". And THAT field's simple_reductions set is completely " +
        "empty -- no rule for m=1, m=2, m=3, ... being a special case of arbitrary m at all. (One narrow " +
        "complex reduction exists, but only for one specific combination with three other fields at once.) So " +
        "no rule declaring \"1 reduces to P\" exists in either place it could live -- not a wrong rule, an " +
        "absent one. Result: problems that differ ONLY in machine count essentially never get a generalization " +
        "edge in this graph -- e.g. 1||ΣUj has no edge to P||ΣUj, even though m=1 is obviously a special case " +
        "of arbitrary m. Not a hand-authored graph (edges genuinely are computed from declared rules, per the " +
        "\"why so few edges\" question earlier) -- just a dimension The Scheduling Zoo's own reduction data barely covers.",
    },
    {
      title: "We added a reduction rule to fill that gap",
      body: SZ_MACHINE_COUNT_RULE_NOTE,
    },
    {
      title: "Setup times under a single server (S1): The Scheduling Zoo's reduction rule points the wrong way -- corrected here",
      body: SZ_S1_SETUP_NOTE,
    },
    {
      title: "Two of The Scheduling Zoo's form conditions corrected when checking new problems",
      body:
        "The Problem Map Designer only offers to add a new problem when it is well-formed by The Scheduling " +
        "Zoo's own problem-builder form in notation.xml: one value per field, and every field and value only " +
        "where its \"requires\" condition holds. Running all 719 problems of the corpus through those conditions " +
        "rejected 95 of them, for two reasons. First, the unit and equal processing times pij=1 and pij=p require " +
        "\"R or J or O\", leaving out F, although 76 and 18 flow-shop problems use them and notation.xml's own " +
        "flow-shop explanation writes processing times as pij. Second, its evaluator splits a condition on spaces " +
        "only, so \"(P\" in \"advanced and (P or Q or 1)\" is read as an unknown word and pj∈{1,2} is never offered. " +
        "We read the first as \"R or J or O or F\" and space out the parentheses; with both, all 719 problems are " +
        "well-formed. Suggested upstream fix: add \"or F\" to those two conditions and write " +
        "\"advanced and ( P or Q or 1 )\".",
    },
    {
      title: "Multiprocessor tasks (fixj) on parallel machines: The Scheduling Zoo's reduction rule only holds for shops -- corrected here",
      body: SZ_FIXJ_SHOP_NOTE,
    },
  ];

  // One-line hover summary for an edge: which field(s) it relaxes, using
  // schedzoo's own field names (see edge.diffs, computed in
  // convert_for_pzoo.py). The full per-field explanation text is reserved
  // for the click-through panel (openSchedulingZooEdgePanel) -- a hover
  // tooltip has to stay short.
  function szEdgeSummary(edge, flagged) {
    const prefix = flagged ? "⚠ FLAGGED (click for details) — " : edge.addedByUs ? "✚ ADDED BY US (click for details) — " : "";
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
  const SZ_EDGE_COLORS = [MAP_EDGE_COLOR, SZ_EDGE_FLAGGED_COLOR];
  function szEdgeStroke(edge, flagged) {
    // Arrows added by a rule of ours look like every other arrow; their
    // panel still says which rule added them.
    return flagged ? SZ_EDGE_FLAGGED_COLOR : MAP_EDGE_COLOR;
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

  // Words people use for what the notation abbreviates, so the search box
  // works for someone who doesn't know Graham notation or this site's
  // filters: "preemptive", "setup", "makespan", "tardy". Matched as word
  // PREFIXES ("preempt" finds preemptive problems), never from the middle of
  // a word, so "preemptive" doesn't also find the non-preemptive ones.
  const SZ_MACHINE_ENV_LABELS = {
    1: "1 — single machine", P: "P — parallel identical machines", Q: "Q — uniform/related machines",
    R: "R — unrelated machines", O: "O — open shop", F: "F — flow shop", J: "J — job shop",
  };
  const SZ_OBJECTIVE_WORDS = {
    Cmax: "makespan maximum completion time",
    Cmin: "minimum completion time",
    "ΣCj": "total sum completion time",
    "ΣwjCj": "total sum weighted completion time",
    Lmax: "maximum lateness",
    "ΣUj": "number of tardy late jobs throughput",
    "ΣwjUj": "weighted number of tardy late jobs throughput",
    "ΣTj": "total sum tardiness",
    "ΣwjTj": "total sum weighted tardiness",
    "ΣFj": "total sum flow time",
    "ΣwjFj": "total sum weighted flow time",
    Fmax: "maximum flow time",
    "max wjFj": "maximum weighted flow time",
  };
  const SZ_PREEMPTION_WORDS = {
    pmtn: "preemption preemptive",
    restarts: "preemption restarts",
    "": "non-preemptive nonpreemptive",
  };
  // Added to a problem's words for each beta field it sets, next to
  // schedzoo's field name and this site's label for it (SZ_SETTING_LABELS).
  const SZ_SETTING_WORDS = {
    server: "setup setups",
    "setup times": "setup setups",
    "precedence relation": "constraints",
    "release time": "release dates",
    batching: "batch batches",
    "machine sets": "multipurpose eligibility eligible dedicated",
    "job size": "multiprocessor tasks",
    "due date": "due dates",
    deadline: "deadlines",
    "rejection cost": "reject",
    "transportation delays": "transport",
    recirculation: "flexible",
  };
  // Multi-word phrases rewritten before the query is split into words. The
  // machine environments become their alpha letter, so "job shop" means J
  // rather than "mentions jobs, in any shop"; "non preemptive" stays one
  // word so it can't turn into "non" AND "preemptive".
  const SZ_QUERY_PHRASES = [
    [/\bsingle[\s-]*machines?\b/g, " 1 "],
    [/\bparallel\s+identical\s+machines?\b|\bidentical\s+(parallel\s+)?machines?\b|\bparallel\s+machines?\b/g, " p "],
    [/\bunrelated\s+machines?\b/g, " r "],
    [/\b(uniform|related)\s+machines?\b/g, " q "],
    [/\bopen[\s-]*shops?\b/g, " o "],
    [/\bflow[\s-]*shops?\b/g, " f "],
    [/\bjob[\s-]*shops?\b/g, " j "],
    [/\bnon[\s-]*preempt/g, " non-preempt"],
    [/\b(unit|equal)[\s-]+(processing|setup|time|communication)/g, " $1-$2"],
  ];
  // A machine-environment token: 1, P, P2, Pm, F3, J, ... Matched against
  // the problem's alpha field only -- otherwise "1" would also find every
  // p_j=1 problem.
  const SZ_ALPHA_TOKEN = /^(1|[pqrofj](\d+|m|∞)?)$/;

  function szNodeWords(node) {
    if (node._words === undefined) {
      const parts = [
        SZ_MACHINE_ENV_LABELS[node.machineEnv] || "",
        SZ_OBJECTIVE_WORDS[node.objective] || "",
        SZ_PREEMPTION_WORDS[node.preemption || ""] || "",
      ];
      Object.keys(node.settings || {}).forEach((f) => {
        const v = node.settings[f];
        parts.push(f, SZ_SETTING_LABELS[f] || "", SZ_SETTING_WORDS[f] || "");
        // "unit"/"equal" on their own, and fused with the field they qualify
        // ("unit-processing"), so "unit processing" doesn't also find a
        // problem with unit time lags and arbitrary processing times.
        const head = f.split(" ")[0];
        if (/=1$/.test(v)) parts.push("unit", "unit-" + head);
        else if (/=[a-zA-Z]$/.test(v)) parts.push("equal common", "equal-" + head);
      });
      node._words = parts.join(" ").toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
    }
    return node._words;
  }
  function szNodeAlpha(node) {
    return String(node.notation || "").split("|")[0].split(";")[0].toLowerCase();
  }
  function szAlphaTokenMatches(node, t) {
    const alpha = szNodeAlpha(node);
    return t === "1" ? alpha === "1" : alpha.startsWith(t);
  }

  // Parsed once per query string, not once per problem.
  let szParsedQuery = { q: null, tokens: [] };
  function szQueryTokens(q) {
    if (szParsedQuery.q !== q) {
      let text = q.toLowerCase();
      SZ_QUERY_PHRASES.forEach(([re, rep]) => { text = text.replace(re, rep); });
      const tokens = text.split(/[\s,;]+/).filter(Boolean).map((t) => ({
        t,
        alpha: SZ_ALPHA_TOKEN.test(t),
        forms: szSearchForms(t).filter(Boolean),
        word: t.length >= 3 && /[a-z]/.test(t),
      }));
      szParsedQuery = { q, tokens };
    }
    return szParsedQuery.tokens;
  }

  // Two ways to search, because typed notation and typed words need
  // different matching:
  //
  // A query WITHOUT "|" is a list of words, and every one of them has to
  // match, in any order: "1 rj Uj", "preemptive setup", "flow shop Cmax".
  // A word matches when it is the problem's machine environment (1, P2, F,
  // or a phrase like "open shop"), occurs anywhere in its notation in any
  // spelling (see szSearchForms, so "sum" finds Σ), or starts one of its
  // plain-language words (see szNodeWords).
  //
  // A query WITH "|" is notation typed slot by slot: its alpha must match
  // the problem's alpha, its gamma the gamma, and every ";"- or
  // space-separated beta token must occur somewhere in the beta, in any
  // order -- "1|rj|Uj" is single machine, release dates, some U_j
  // objective, even though the actual problems read "1|rj;pmtn|ΣUj" etc.
  function szNodeMatchesQuery(node, q) {
    if (!q) return true;
    if (q.indexOf("|") !== -1) return szNodeMatchesSlots(node, q);
    const tokens = szQueryTokens(q);
    if (!tokens.length) return true;
    const hay = szNodeSearchHaystack(node);
    return tokens.every((tok) => {
      if (tok.alpha) return szAlphaTokenMatches(node, tok.t);
      if (tok.forms.some((f) => hay.includes(f))) return true;
      return tok.word && szNodeWords(node).some((w) => w.startsWith(tok.t));
    });
  }
  function szNodeMatchesSlots(node, q) {
    const qSlots = q.split("|");
    const nSlots = String(node.notation || "").split("|");
    if (qSlots.length > nSlots.length) return false;
    for (let i = 0; i < qSlots.length; i++) {
      if (!qSlots[i].trim()) continue;
      const nodeForms = szSearchForms(nSlots[i] || "");
      const tokens = qSlots[i].toLowerCase().split(/[\s;]+/).filter(Boolean);
      const ok = tokens.every((t) =>
        i === 0 && SZ_ALPHA_TOKEN.test(t) ? szAlphaTokenMatches(node, t) : szFormsContain(nodeForms, t));
      if (!ok) return false;
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
  // problems it would sink into "Rare"; so it gets its own pinned group.
  // `match` is what the group's own "+"/"-" means (online / not online);
  // `values` are the finer switches listed inside it.
  const SZ_SETTING_VALUE_GROUPS = [
    {
      key: "online",
      label: "Online",
      match: { field: "release time", value: "online-r_j" },
      values: [
        // restarts is filed under "preemption" by schedzoo, but all four of
        // its problems are online -- it is the online model's own
        // preemption variant, so it is listed here rather than under
        // Preemption.
        { field: "preemption", value: "restarts" },
      ],
    },
  ];

  // (field, value) pairs never listed as a selectable value under their own
  // field, because the group's "+" already says the same thing.
  const SZ_HIDDEN_SETTING_VALUES = [
    { field: "precedence relation", value: "prec" },
    // Both belong to Online instead: online-r_j IS Online's own switch, and
    // restarts is listed inside it. Their own fields keep counting them (a
    // problem with online-r_j does have release dates, and restarts is a
    // kind of preemption), they just aren't offered twice as switches.
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
    // and may draw them from more than one field: Online is online-r_j (a
    // release-time value, its `match`) with restarts (a preemption value)
    // listed inside it -- a coherent family even though schedzoo files the
    // two under different fields.
    SZ_SETTING_VALUE_GROUPS.forEach((m) => {
      const values = m.values
        .map((mv) => (byFieldAll[mv.field] || []).filter((v) => v.value === mv.value)[0])
        .filter(Boolean);
      if (!values.length && !m.match) return;
      groups.push({
        key: m.key,
        fields: Array.from(new Set((m.match ? [m.match.field] : []).concat(values.map((v) => v.field)))),
        isValueGroup: true,
        match: m.match || null,
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

  // A value group's own match (Online's online-r_j), when it has one, read
  // back off the rendered group the same way.
  function szGroupMatchRef(groupEl) {
    return groupEl.dataset.matchField ? { field: groupEl.dataset.matchField, value: groupEl.dataset.matchValue } : null;
  }

  function szGroupMatches(node, g) {
    if (g.match) return szSettingValue(node, g.match.field) === g.match.value;
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
      // Unless the group has its own match (Online): then its single value
      // (restarts) is a narrower question than the group's switch.
      const expandable = nested || g.values.length > 1 || (!!g.match && g.values.length > 0);
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
        (g.match ? ' data-match-field="' + escapeHtml(g.match.field) + '" data-match-value="' + escapeHtml(g.match.value) + '"' : "") +
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

  // Which dropdown is open, where it is scrolled to and which of its groups
  // are expanded -- so a re-render can put it back exactly as it was.
  function captureDropdownUi(root) {
    const panel = root.querySelector(".ms-panel:not([hidden])");
    if (!panel) return null;
    const keyOf = (el) => { const g = el.parentElement.closest(".ms-group"); return g ? g.dataset.key : ""; };
    return {
      id: panel.id,
      scroll: panel.scrollTop,
      groups: Array.from(panel.querySelectorAll(".ms-group")).filter((g) => {
        const body = g.querySelector(":scope > .ms-group-values");
        return body && !body.hidden;
      }).map((g) => g.dataset.key),
      rares: Array.from(panel.querySelectorAll(".ms-rare")).filter((r) => !r.querySelector(":scope > .ms-rare-body").hidden).map(keyOf),
    };
  }
  function restoreDropdownUi(root, snap) {
    if (!snap) return;
    const panel = root.querySelector("#" + cssEscape(snap.id));
    if (!panel) return;
    panel.hidden = false;
    panel.querySelectorAll(".ms-group").forEach((g) => {
      const body = g.querySelector(":scope > .ms-group-values");
      if (!body || !snap.groups.includes(g.dataset.key)) return;
      body.hidden = false;
      const caret = g.querySelector(":scope > .ms-group-head .ms-caret");
      if (caret) caret.setAttribute("aria-expanded", "true");
    });
    panel.querySelectorAll(".ms-rare").forEach((r) => {
      const g = r.parentElement.closest(".ms-group");
      if (!snap.rares.includes(g ? g.dataset.key : "")) return;
      r.querySelector(":scope > .ms-rare-body").hidden = false;
      const caret = r.querySelector(":scope > .ms-rare-caret");
      if (caret) caret.setAttribute("aria-expanded", "true");
    });
    panel.scrollTop = snap.scroll;
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
            match: szGroupMatchRef(g),
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
        match: szGroupMatchRef(g),
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
          vs.forEach((v) => parts.push((v.dataset.state === "out" ? "−" : "") + v.querySelector(".ms-option-label").firstChild.textContent.trim()));
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
    // Closes only when its own button is clicked again (or another
    // dropdown is opened) -- not on outside clicks or while switching values.
    panel.addEventListener("click", (e) => e.stopPropagation());

    function setState(el, state) {
      if (el.dataset.state === state) return;
      el.dataset.state = state;
      const parent = el.classList.contains("ms-group") ? el : el.closest(".ms-group");
      const isPrecedence = parent && parent.dataset.fields.split("|").includes("precedence relation");
      if (isPrecedence && el.classList.contains("ms-group") && state !== "neutral") {
        parent.querySelectorAll(".ms-value[data-field='precedence relation']").forEach((value) => { value.dataset.state = "neutral"; });
      } else if (isPrecedence && el.classList.contains("ms-value") && state !== "neutral") {
        parent.dataset.state = "neutral";
      }
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
    // Closes only when its own button is clicked again (or another
    // dropdown is opened) -- not on outside clicks or while switching values.
    panel.addEventListener("click", (e) => e.stopPropagation());

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

  // One field of Graham's alpha|beta|gamma, for the overview's introduction.
  function szGrahamField(symbol, name) {
    return '<span class="sz-graham-field"><span class="sz-graham-sym">' + symbol + "</span>" +
      '<span class="sz-graham-name">' + name + "</span></span>";
  }

  // More than this and a saved map is unreadable (and slow to lay out).
  const SZ_SAVE_MAP_MAX = 150;

  function renderSchedulingZoo() {
    if (!DATA_SZ) {
      els.viewSchedulingZoo.innerHTML = '<div class="map-page"><p class="design-intro">Loading…</p></div>';
      loadSzData()
        .then(() => renderSchedulingZoo())
        .catch((err) => {
          els.viewSchedulingZoo.innerHTML =
            '<div class="map-page">' +
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
        // are sound (see the data notes below).
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
    const { machineEnvOptions, objectiveOptions } = szFilterOptions();

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

    const dropdownUi = captureDropdownUi(els.viewSchedulingZoo);
    els.viewSchedulingZoo.innerHTML =
      '<div class="map-page">' +
      '<div class="sz-intro">' +
      "<p>Problems are written in Graham's three-field notation:</p>" +
      '<p class="sz-graham" role="img" aria-label="alpha: machine environment, beta: settings, gamma: objective">' +
      szGrahamField("α", "machine environment") + '<span class="sz-graham-bar">|</span>' +
      szGrahamField("β", "settings") + '<span class="sz-graham-bar">|</span>' +
      szGrahamField("γ", "objective") + "</p>" +
      "<p>For example <code>1|rj;pmtn|ΣCj</code> is a single machine, with release dates and preemption, " +
      "minimizing total completion time. The filter bar below has the same three fields: type notation or plain " +
      "words into the search box (<code>1 rj Uj</code>, <code>preemptive</code>, <code>flow shop</code>), or open a " +
      "field and switch values to <b>+</b> require or <b>−</b> exclude. Matches stay highlighted as you go; " +
      "<b>Apply filter</b> redraws the map with only them and <b>Show all</b> brings everything back.</p>" +
      (SZ_FLAGGED_EDGES.length
        ? '<p class="sz-arrow-key">' +
          '<span class="sz-line-swatch" style="border-top-color:' + MAP_EDGE_COLOR + '"></span>reductions' +
          '<span class="sz-line-swatch sz-line-dashed" style="border-top-color:' + SZ_EDGE_FLAGGED_COLOR +
          '"></span>flagged as inconsistent (' + SZ_FLAGGED_EDGES.length + ")</p>"
        : "") +
      "</div>" +
      '<div class="sz-filters">' +
      '<input type="text" id="sz-filter" class="sz-filter" placeholder="Search, e.g. 1 rj Uj, preemptive, setup, flow shop…">' +
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
      '<button type="button" class="sz-save-map-btn" title="Save the problems shown here as a new problem map">⊕ Save as a New Problem Map</button>' +
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
      '<div class="map-legend">' + szClassLegendHtml + "</div>" +
      // How to read the map and what can be done with it, under the legend.
      '<div class="map-hint sz-map-help"><span class="map-hint-icon">i</span>' +
      '<p><b class="sz-def">Nodes</b> are problems -- click one for its citations and parameterized results. ' +
      '<b class="sz-def">Arrows</b> run from a problem to a special case of it: every instance of the problem an ' +
      "arrow points to is also an instance of the one it starts from. Click one to see which field differs.</p>" +
      '<p><b class="sz-def">Colors</b> show classical complexity. Hardness travels against the arrows, so a problem ' +
      "with no classical result of its own takes the hardness of any special case of it that is proven hard.</p>" +
      '<p><b class="sz-def">Drag</b> a node off the diagram ' +
      'to hide it from this view -- the data is unchanged. <b class="sz-def">Undo / Redo / Restore hidden</b> ' +
      'brings it back. <b class="sz-def">Apply filter</b> redraws the map with only the problems matching the ' +
      'filters; <b class="sz-def">Show all</b> returns to the full map.</p></div>' +
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

    // Saves the problems currently on the diagram -- after Apply filter, and
    // minus any dragged off -- as a new map, laid out afresh, and opens it
    // in the designer.
    const saveMapBtn = els.viewSchedulingZoo.querySelector(".sz-save-map-btn");
    saveMapBtn.addEventListener("click", () => {
      const ids = nodes.map((n) => n.id).filter((id) => !SZ_HIDDEN_IDS.has(id));
      if (ids.length > SZ_SAVE_MAP_MAX) {
        saveMapBtn.textContent = ids.length + " problems -- apply a filter first (max " + SZ_SAVE_MAP_MAX + ")";
        setTimeout(() => { saveMapBtn.textContent = "⊕ Save as a New Problem Map"; }, 2600);
        return;
      }
      resetDesignerHidden();
      storyProblemIds = ids;
      designerUserEdges = [];
      designerArrowMode = null;
      storyPositions = {};
      designerSelectedId = null;
      designerMapId = null;
      designerMapTitle = "From the Scheduling Zoo map (" + ids.length + " problem" + (ids.length === 1 ? "" : "s") + ")";
      autoArrangeDesigner();
      const r = saveDesignerMap({ keepUrl: true });
      if (!r.ok) { saveMapBtn.textContent = r.message; return; }
      location.hash = "#/design/" + encodeURIComponent(r.map.id);
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
    restoreDropdownUi(els.viewSchedulingZoo, dropdownUi);
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
        ? "from a reduction rule <b>this site added</b> (not The Scheduling Zoo's own data -- see the note below; every note is under Known data anomalies in the <a href=\"#/docs/docs-anomalies\">Documentation</a>)"
        : "from <a href=\"https://schedulingzoo.lip6.fr/\" target=\"_blank\" rel=\"noopener\">schedulingzoo.lip6.fr</a>'s own reduction graph (their notation.xml &lt;reduction&gt; declarations)") +
      " -- this arrow means every " + escapeHtml(to.notation) +
      " instance can be viewed as a " + escapeHtml(from.notation) + " instance with the same answer.</p>" +
      (flagged
        ? '<div class="detail-field" style="border-left:3px solid #cf4444;padding-left:0.7rem">' +
          "<h4 style='color:#cf4444'>⚠ Flagged as inconsistent</h4><p style='margin:0'>" + escapeHtml(flagged.note) + "</p></div>"
        : "") +
      (edge.addedByUs
        ? '<div class="detail-field" style="border-left:3px solid var(--border);padding-left:0.7rem">' +
          "<h4>✚ Added by this site</h4><p style='margin:0'>" + escapeHtml(szAddedEdgeNote(edge)) + "</p></div>"
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
    const resultLi = szResultLi;
    const lower = n.classical.filter((r) => r.kind === "lower");
    const upper = n.classical.filter((r) => r.kind === "upper");
    const forest = buildParamForest(szAllParams(n));
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
      "not independently verified by this site; classification above is this site's own reading of The Scheduling Zoo's " +
      "cited text, not a category The Scheduling Zoo assigns itself.</p>" +
      (machineEnvExpl ? '<p style="color:var(--muted);font-size:0.85rem"><b>' + escapeHtml(n.machineEnv) +
        "</b> — " + escapeHtml(machineEnvExpl) + " (The Scheduling Zoo's own wording)</p>" : "") +
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

  // The map designer is deliberately a user-curated story: unlike the
  // restriction explorer below, it starts with no problem nodes at all.
  let storyProblemIds = [];
  let storySearchText = "";
  let storyPositions = {};
  let storyDrag = null;
  let designerSelectedId = null;
  let designerMapId = null; // the saved map being edited, or null for an unsaved one
  let designerUserEdges = []; // arrows added by hand: { from, to } (from generalizes to)
  let designerArrowMode = null; // while adding an arrow: { from: id or null }
  let designerArrowNotice = ""; // one-line result of the last arrow added
  let designerMapTitle = "";
  let designerDraftNodes = {};
  let designerFilterState = {
    machineEnv: { include: new Set(), exclude: new Set() },
    objective: { include: new Set(), exclude: new Set() },
    settings: { groups: [], values: {} },
  };

  function designerFiltersActive() {
    return designerFilterState.machineEnv.include.size || designerFilterState.machineEnv.exclude.size ||
      designerFilterState.objective.include.size || designerFilterState.objective.exclude.size ||
      designerFilterState.settings.groups.length || Object.keys(designerFilterState.settings.values).length;
  }

  function designerFilteredNodes() {
    return DATA_SZ.nodes.filter((node) => storyProblemMatches(node) &&
      msSelectionAccepts(designerFilterState.machineEnv, node.machineEnv || "") &&
      msSelectionAccepts(designerFilterState.objective, canonicalSzObjective(node.objective)) &&
      szNodeMatchesSettings(node, designerFilterState.settings));
  }

  function designerApplyFilterRemoval() {
    const allowed = new Set(designerFilteredNodes().map((node) => node.id));
    const excluded = storyProblemIds.filter((id) => !allowed.has(id));
    if (!excluded.length) return;
    storyProblemIds = storyProblemIds.filter((id) => allowed.has(id));
    excluded.forEach((id) => delete storyPositions[id]);
    if (excluded.includes(designerSelectedId)) designerSelectedId = storyProblemIds[0] || null;
  }

  function storyNodeById(id) {
    return (DATA_SZ && DATA_SZ.nodes.find((node) => node.id === id)) || designerDraftNodes[id] || null;
  }

  function normalizedNotationPart(value) {
    return String(value || "")
      .replace(/\\sum\s*/g, "Σ")
      .replace(/\\?w_?\{?j\}?/g, "wj")
      .replace(/\\?U_?\{?j\}?/g, "Uj")
      .replace(/([a-zA-Z])_\{?([a-zA-Z0-9]+)\}?/g, "$1$2")
      .replace(/[{}\\]/g, "")
      .replace(/\s+/g, "")
      .replace(/,/g, ";");
  }

  function notationSignature(node) {
    const slots = normalizedNotationPart(node.notation).split("|");
    return [slots[0] || "", (slots.slice(1, -1)[0] || "").split(";").filter(Boolean).sort().join(";"), slots[slots.length - 1] || ""].join("|");
  }

  function canonicalStoryId(id) {
    const node = storyNodeById(id);
    if (!node || !DATA_SZ) return id;
    const signature = notationSignature(node);
    const equivalent = DATA_SZ.nodes.filter((candidate) => notationSignature(candidate) === signature).sort((a, b) => a.id.localeCompare(b.id));
    return equivalent.length ? equivalent[0].id : id;
  }

  // ---- Which problems may be drafted. A new problem is only offered when the
  // filters describe exactly one complete, well-formed problem, judged by
  // The Scheduling Zoo's own problem-builder form (DATA_SZ.notationForm,
  // exported from notation.xml): one radio choice per field, so one value
  // per field -- "pj=p" and "pj=1" can't both hold -- and a field or value
  // is only allowed while its `requires` condition holds, in form order.
  // The same form fixes the order the name is written in, so two orderings
  // of the same settings are the same problem.

  // A port of index.php's eval_bool_expr: and / or / not with parentheses;
  // an atom is true when it is a chosen value or a field with a non-empty
  // value, and multi-word atoms ("release time") are read by joining
  // consecutive words. "no" is read as "not" (index.php doesn't, which
  // makes its "no number of machines" condition always false).
  function szEvalRequires(expr, chosenValues, chosenFields) {
    if (!expr) return true;
    const priority = [";", "(", ")", "or", "and", "not"];
    const vals = [], ops = [];
    let last = "";
    (expr + " ;").split(" ").forEach((raw) => {
      const tok = raw === "no" ? "not" : raw;
      const prio = priority.indexOf(tok);
      if (prio !== -1) {
        while (tok !== "(" && ops.length && priority.indexOf(ops[ops.length - 1]) >= prio) {
          const op = ops.pop(), right = vals.pop();
          if (op === "not") vals.push(!right);
          else { const left = vals.pop(); vals.push(op === "and" ? left && right : left || right); }
        }
        if (tok === ")") ops.pop();
        else ops.push(tok);
        last = "";
      } else if (tok) {
        let atom = tok;
        if (last) { atom = last + " " + tok; vals.pop(); }
        vals.push(chosenValues.has(atom) || !!chosenFields[atom]);
        last = atom;
      }
    });
    return vals.pop();
  }

  const SZ_FIELD_NAMES = { type: "Machine environment", "Objective function": "Objective" };
  function szFieldName(field) {
    return SZ_FIELD_NAMES[field] || SZ_SETTING_LABELS[field] || field;
  }
  function szFormField(field) {
    return (DATA_SZ.notationForm || []).find((f) => f.field === field);
  }
  function szChoiceLabel(field, value) {
    const f = szFormField(field);
    const c = f && f.choices.find((x) => x.value === value);
    return c ? c.label : value;
  }

  // The filters as a problem: { ok, notation, assignment } when they describe
  // one complete, well-formed problem, otherwise { ok: false, reason }.
  function designerDraftProblem() {
    const st = designerFilterState;
    if (!DATA_SZ.notationForm) return { ok: false, reason: "" };
    const env = Array.from(st.machineEnv.include), obj = Array.from(st.objective.include);
    if (env.length !== 1 || obj.length !== 1) {
      return { ok: false, reason: "To add a new problem, switch exactly one machine environment and exactly one objective to +." };
    }
    const assignment = { type: env[0] };
    const objField = szFormField("Objective function");
    const objChoice = objField.choices.find((c) => c.label === obj[0]);
    if (!objChoice) return { ok: false, reason: "Unknown objective " + obj[0] + "." };
    assignment["Objective function"] = objChoice.value;

    const assign = (field, value) => {
      if (assignment[field] !== undefined && assignment[field] !== value) {
        return "\"" + szChoiceLabel(field, assignment[field]) + "\" and \"" + szChoiceLabel(field, value) + "\" are both " +
          szFieldName(field) + " values -- a problem has one value per field.";
      }
      assignment[field] = value;
      return null;
    };
    const sel = st.settings || { groups: [], values: {} };
    // Specific values first: each switched to + is that field's value.
    for (const field of Object.keys(sel.values || {})) {
      const inc = Array.from(sel.values[field].include);
      for (const v of inc) { const err = assign(field, v); if (err) return { ok: false, reason: err }; }
    }
    // Then a group switched to + on its own, when it names one value.
    for (const g of sel.groups || []) {
      if (g.state !== "in") continue;
      if (g.match) { const err = assign(g.match.field, g.match.value); if (err) return { ok: false, reason: err }; continue; }
      if (g.fields.some((f) => assignment[f])) continue;
      // A group's + names the values listed under it: "Release dates" is
      // rj (online-rj belongs to Online), "Preemption" is pmtn (restarts
      // belongs to Online), and "Precedence" is prec, the group itself.
      const field = g.fields[0];
      if (g.fields.length === 1 && SZ_GROUP_PLUS_VALUE[field]) { assignment[field] = SZ_GROUP_PLUS_VALUE[field]; continue; }
      const ownedElsewhere = new Set();
      SZ_SETTING_VALUE_GROUPS.forEach((vg) => (vg.match ? [vg.match] : []).concat(vg.values).forEach((x) => {
        if (x.field === field) ownedElsewhere.add(x.value);
      }));
      const options = g.fields.length === 1 && szFormField(field)
        ? szFormField(field).choices.filter((c) => c.value !== "" && !ownedElsewhere.has(c.value) && (!c.requires ||
            szEvalRequires(c.requires, new Set(Object.values(assignment).concat("advanced")), assignment)))
        : [];
      if (options.length !== 1) {
        return { ok: false, reason: "\"" + (g.label || szFieldName(g.fields[0])) + "\" is switched to + without saying which one -- open it and pick a value." };
      }
      assignment[g.fields[0]] = options[0].value;
    }
    // Exclusions only have to agree with what is chosen.
    for (const g of sel.groups || []) {
      if (g.state !== "out") continue;
      const hit = g.match ? assignment[g.match.field] === g.match.value : g.fields.some((f) => assignment[f]);
      if (hit) return { ok: false, reason: "The filters both require and exclude " + (g.label || szFieldName(g.fields[0])) + "." };
    }
    for (const field of Object.keys(sel.values || {})) {
      if (sel.values[field].exclude.has(assignment[field])) {
        return { ok: false, reason: "The filters both require and exclude \"" + szChoiceLabel(field, assignment[field]) + "\"." };
      }
    }

    // Walk the form in order, as The Scheduling Zoo's builder does.
    const chosenValues = new Set(["advanced"]), chosenFields = { interface: "advanced" };
    const slots = { alpha: "", beta: [], gamma: "" };
    for (const f of DATA_SZ.notationForm) {
      const v = assignment[f.field] || "";
      if (!szEvalRequires(f.requires, chosenValues, chosenFields)) {
        if (v) return { ok: false, reason: szFieldName(f.field) + " isn't available here (The Scheduling Zoo requires: " + f.requires.replace(/^advanced and /, "") + ")." };
        continue;
      }
      const choice = f.choices.find((c) => c.value === v);
      if (!choice) return { ok: false, reason: "\"" + v + "\" is not a " + szFieldName(f.field) + " value." };
      if (!szEvalRequires(choice.requires, chosenValues, chosenFields)) {
        return { ok: false, reason: "\"" + choice.label + "\" isn't allowed here (The Scheduling Zoo requires: " + choice.requires.replace(/^advanced and /, "") + ")." };
      }
      chosenFields[f.field] = v;
      chosenValues.add(v);
      if (!v) continue;
      if (f.slot === "alpha") slots.alpha += (slots.alpha && f.separation ? ";" : "") + choice.label;
      else if (f.slot === "beta") slots.beta.push(choice.label);
      else slots.gamma = choice.label;
    }
    const notation = slots.alpha + "|" + slots.beta.join(";") + "|" + slots.gamma;
    const existing = DATA_SZ.nodes.find((n) => notationSignature(n) === notationSignature({ notation: notation }));
    if (existing) return { ok: false, existing: existing, notation: notation, reason: "" };
    return { ok: true, notation: notation, assignment: assignment };
  }

  // Values that ARE their group's +, hidden as a separate row for that reason
  // (see SZ_HIDDEN_SETTING_VALUES).
  const SZ_GROUP_PLUS_VALUE = { "precedence relation": "prec" };

  function szDraftVector(assignment) {
    const v = {};
    Object.keys(assignment).forEach((f) => { if (assignment[f]) v[f] = assignment[f]; });
    if (v.type === "1") { v.type = "P"; v["number of machines"] = "1"; }
    return v;
  }

  function addDesignerDraft() {
    const draft = designerDraftProblem();
    if (!draft.ok) return;
    const a = draft.assignment, settings = {};
    Object.keys(a).forEach((field) => {
      if (!["type", "Objective function", "preemption"].includes(field) && a[field]) settings[field] = a[field];
    });
    const id = "designer-draft-" + draft.notation.replace(/[^a-zA-Z0-9]+/g, "-");
    designerDraftNodes[id] = {
      id: id, notation: draft.notation, classicalClass: "unclaimed", machineEnv: a.type,
      // same shape as a corpus problem's vector: single machine is type P
      // with one machine, as The Scheduling Zoo's parser stores it
      vector: szDraftVector(a),
      objective: szChoiceLabel("Objective function", a["Objective function"]), settings: settings,
      preemption: a.preemption || "", classical: [], params: [], draft: true,
    };
    addStoryProblem(id);
  }

  function smartStoryPosition(id) {
    const nodeW = 220, nodeH = 44, gap = 34;
    const related = designerRelationPairs().filter((edge) => {
      return edge.from === id && storyProblemIds.includes(edge.to) || edge.to === id && storyProblemIds.includes(edge.from);
    });
    if (!related.length) {
      for (let row = 0; row < 12; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          const candidate = { left: 30 + col * (nodeW + gap), top: 30 + row * (nodeH + gap) };
          const occupied = storyProblemIds.some((existingId) => {
            const existing = storyPositions[existingId];
            return existing && Math.abs(existing.left - candidate.left) < nodeW && Math.abs(existing.top - candidate.top) < nodeH;
          });
          if (!occupied) return candidate;
        }
      }
      return { left: 30, top: 30 + storyProblemIds.length * (nodeH + gap) };
    }
    const anchors = related.map((edge) => {
      const existingId = edge.from === id ? edge.to : edge.from;
      const anchor = storyPositions[existingId] || { left: 370, top: 190 };
      return {
        left: anchor.left,
        top: anchor.top + (edge.from === id ? -(nodeH + gap) : nodeH + gap),
      };
    });
    const base = {
      left: anchors.reduce((sum, item) => sum + item.left, 0) / anchors.length,
      top: anchors.reduce((sum, item) => sum + item.top, 0) / anchors.length,
    };
    const offsets = [{ x: 0, y: 0 }];
    for (let ring = 1; ring < 12; ring += 1) {
      offsets.push({ x: ring * (nodeW + gap), y: 0 }, { x: -ring * (nodeW + gap), y: 0 }, { x: 0, y: ring * (nodeH + gap) }, { x: 0, y: -ring * (nodeH + gap) });
    }
    for (const offset of offsets) {
      const position = { left: Math.max(20, base.left + offset.x), top: Math.max(20, base.top + offset.y) };
      const occupied = storyProblemIds.some((existingId) => {
        const existing = storyPositions[existingId];
        return existing && Math.abs(existing.left - position.left) < nodeW && Math.abs(existing.top - position.top) < nodeH;
      });
      if (!occupied) return position;
    }
    return { left: Math.max(20, base.left), top: Math.max(20, base.top + 12 * (nodeH + gap)) };
  }

  function addStoryProblem(id, position) {
    id = canonicalStoryId(id);
    if (!storyNodeById(id) || storyProblemIds.includes(id)) return;
    const autoPosition = position || smartStoryPosition(id);
    storyProblemIds.push(id);
    designerSelectedId = id;
    storyPositions[id] = autoPosition;
    renderDesign();
  }

  function storyProblemMatches(p) {
    const query = storySearchText.trim().toLowerCase();
    if (!query) return true;
    return szNodeMatchesQuery(p, query);
  }

  function storyEdges() {
    const selected = new Set(storyProblemIds);
    const edges = [];
    (DATA_SZ ? DATA_SZ.edges : []).forEach((edge) => {
      if (selected.has(edge.from) && selected.has(edge.to)) edges.push(edge);
    });
    return edges;
  }

  function renderStoryDesigner() {
    const selected = new Set(storyProblemIds);
    const candidates = (DATA_SZ ? DATA_SZ.nodes : []).filter(storyProblemMatches).slice(0, 80);
    const resultHtml = !storySearchText.trim()
      ? ""
      : candidates.length
      ? candidates.map((p) => {
        const already = selected.has(p.id);
        const cc = classicalClassById(SZ_EFFECTIVE[p.id] || p.classicalClass);
        const color = cc ? cc.color : "#868e96";
        const text = cc && cc.fill ? fillTextColor(cc) : "#fff";
        return '<button type="button" class="story-result" draggable="' + (!already) + '" data-story-problem="' + escapeHtml(p.id) + '"' +
          (already ? ' disabled' : '') + ' style="background:' + color + ';border-color:' + color + ';color:' + text + '">' + escapeHtml(p.notation) + '</button>';
      }).join("")
      : '<div class="story-empty">No problems match that search.</div>';

    const nodeW = 220, nodeH = 64;
    const positions = storyPositions;
    const width = 1000;
    const height = Math.max(480, ...storyProblemIds.map((id) => (positions[id] ? positions[id].top + nodeH + 35 : 0)));
    const lines = storyEdges().map((edge) => {
      const from = positions[edge.from], to = positions[edge.to];
      if (!from || !to) return "";
      const tip = pullBackToRect(from.left + nodeW / 2, from.top + nodeH / 2, to.left + nodeW / 2, to.top + nodeH / 2, nodeW / 2, nodeH / 2, 5);
      const tail = pullBackToRect(to.left + nodeW / 2, to.top + nodeH / 2, from.left + nodeW / 2, from.top + nodeH / 2, nodeW / 2, nodeH / 2, 5);
      return '<line x1="' + tail.x + '" y1="' + tail.y + '" x2="' + tip.x + '" y2="' + tip.y + '" marker-end="url(#story-arrow)" />';
    }).join("");
    const nodes = storyProblemIds.map((id) => {
      const p = storyNodeById(id), pos = positions[id];
      const cc = classicalClassById(SZ_EFFECTIVE[id] || p.classicalClass);
      const color = cc ? cc.color : "#868e96";
      const text = cc && cc.fill ? fillTextColor(cc) : "#fff";
      return '<div class="story-node" data-story-node="' + escapeHtml(id) + '" style="left:' + pos.left + 'px;top:' + pos.top + 'px;width:' + nodeW + 'px;height:' + nodeH + 'px;background:' + color + ';border-color:' + color + ';color:' + text + '">' + escapeHtml(p.notation) + '</div>';
    }).join("");

    return '<section class="story-designer">' +
      '<div class="story-search-wrap"><input class="story-search sz-filter" type="search" placeholder="Search problems to add" value="' + escapeHtml(storySearchText) + '" aria-label="Search problems to add"><div class="story-results" role="listbox"' + (storySearchText.trim() ? '' : ' hidden') + '>' + resultHtml + '</div></div>' +
      '<div class="story-canvas-wrap" data-story-dropzone><div class="story-canvas" style="width:' + width + 'px;height:' + height + 'px">' +
      '<svg class="story-edge-svg" width="' + width + '" height="' + height + '"><defs><marker id="story-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>' + lines + '</svg>' + nodes +
      '</div></div>' +
      '<button type="button" class="reset-btn" id="story-clear">Clear added problems</button>' +
      '</section>';
  }

  const DESIGNER_MAP_ID = "problem-map-designer";

  function resetDesignerHidden() {
    MAP_HIDDEN_IDS[DESIGNER_MAP_ID] = new Set();
    MAP_HIDDEN_STACK[DESIGNER_MAP_ID] = [];
    MAP_HIDDEN_REDO_STACK[DESIGNER_MAP_ID] = [];
  }

  // Loads a saved map (or "new": an empty one) into the designer.
  function openDesignerMap(mapId) {
    resetDesignerHidden();
    designerSelectedId = null;
    designerArrowMode = null;
    designerArrowNotice = "";
    if (mapId === "new") {
      storyProblemIds = [];
      storyPositions = {};
      designerUserEdges = [];
      designerMapId = null;
      designerMapTitle = "";
      return;
    }
    const m = loadSavedMaps().find((x) => x.id === mapId);
    if (!m) { designerMapId = null; designerMapTitle = ""; storyProblemIds = []; storyPositions = {}; designerUserEdges = []; return; }
    Object.assign(designerDraftNodes, m.drafts || {});
    storyProblemIds = (m.problemIds || []).filter((id) => storyNodeById(id));
    storyPositions = {};
    storyProblemIds.forEach((id) => { storyPositions[id] = (m.positions || {})[id] || { left: 30, top: 30 }; });
    const onMap = new Set(storyProblemIds);
    designerUserEdges = (m.userEdges || []).filter((e) => onMap.has(e.from) && onMap.has(e.to));
    designerMapId = m.id;
    designerMapTitle = m.title || "";
  }

  // Saves the designer's map -- every problem on it that isn't hidden --
  // under its current title, as a new map or over the one being edited.
  function saveDesignerMap(options) {
    const keepUrl = options && options.keepUrl;
    const hidden = MAP_HIDDEN_IDS[DESIGNER_MAP_ID] || new Set();
    const ids = storyProblemIds.filter((id) => !hidden.has(id));
    if (!ids.length) return { ok: false, message: "Add at least one problem first." };
    const now = new Date().toISOString();
    const list = loadSavedMaps();
    const existing = designerMapId ? list.find((x) => x.id === designerMapId) : null;
    const map = {
      id: existing ? existing.id : "map-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: designerMapTitle.trim() || "Untitled problem map",
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      problemIds: ids,
      userEdges: designerUserEdges.filter((e) => ids.includes(e.from) && ids.includes(e.to)),
      positions: {},
      drafts: {},
      notations: ids.map((id) => storyNodeById(id).notation),
    };
    ids.forEach((id) => {
      map.positions[id] = storyPositions[id];
      if (designerDraftNodes[id]) map.drafts[id] = designerDraftNodes[id];
    });
    const next = existing ? list.map((x) => (x.id === map.id ? map : x)) : list.concat(map);
    if (!storeSavedMaps(next)) return { ok: false, message: "Couldn't save: this browser doesn't allow local storage." };
    designerMapId = map.id;
    designerMapTitle = map.title;
    // Keep the address pointing at this map without re-running the route
    // (unless the caller is about to navigate there itself).
    if (!keepUrl) history.replaceState(null, "", "#/design/" + encodeURIComponent(map.id));
    return { ok: true, map: map, created: !existing };
  }

  // ---- adding arrows by hand
  // An arrow A → B claims B is a special case of A. It conflicts with The
  // Scheduling Zoo's results when that can't be true unless P = NP: A is in
  // P while B is NP-hard, or A is solvable in pseudo-polynomial time while B
  // is strongly NP-hard.
  const SZ_REPORT_ISSUE_URL = "https://github.com/xtof-durr/schedulingzoo/issues/new";
  // `edge` is { from, to } plus what the user said about the reduction (see
  // SZ_REDUCTION_KINDS): the pseudo-polynomial check only applies when it
  // keeps numbers polynomial, the field-rule check only when it is (or may
  // be) a restriction.
  function designerArrowConflict(edge) {
    const fromId = edge.from, toId = edge.to;
    const a = storyNodeById(fromId), b = storyNodeById(toId);
    if (!a || !b || !SZ_EFFECTIVE) return null;
    const ca = SZ_EFFECTIVE[fromId] || a.classicalClass, cb = SZ_EFFECTIVE[toId] || b.classicalClass;
    const hard = ["weakly-NP-hard", "NP-hard-unresolved", "strongly-NP-hard"];
    if (ca === "P" && hard.includes(cb)) {
      return { general: a, specific: b, generalClass: ca, specificClass: cb,
        why: "an algorithm for " + a.notation + " would then solve the NP-hard " + b.notation + " in polynomial time" };
    }
    if (ca === "weakly-NP-hard" && cb === "strongly-NP-hard" && edge.numbers !== "blowup") {
      return { general: a, specific: b, generalClass: ca, specificClass: cb,
        why: "the pseudo-polynomial algorithm for " + a.notation + " would then solve the strongly NP-hard " + b.notation + " in pseudo-polynomial time" };
    }
    // Otherwise, field by field against the reduction rules: a special case
    // can narrow a field but never widen it. A field whose rules only say the
    // two values are unrelated (or say nothing) is not counted -- the rules
    // are incomplete, so silence is not a contradiction.
    if (edge.kind && !["restriction", "padding", "unsure"].includes(edge.kind)) return null;
    const va = szProblemVector(a), vb = szProblemVector(b);
    if (!va || !vb) return null;
    const fields = Object.keys(DATA_SZ.fieldReductions || {})
      .filter((f) => szFieldRelation(f, vb[f] || "", va[f] || "") === "wider")
      .map((f) => ({ field: f, general: va[f] || "", specific: vb[f] || "" }));
    return fields.length ? { kind: "rules", general: a, specific: b, fields: fields } : null;
  }

  // A problem's raw field values (The Scheduling Zoo's own), for drafts too.
  function szProblemVector(node) {
    return node.vector || null;
  }

  // How `value` relates to `than` in one field, by the reduction rules:
  // "same", "narrower" (value is a special case of than), "wider" (than is a
  // special case of value), or "unknown".
  let SZ_FIELD_ORDER = null;
  function szFieldRelation(field, value, than) {
    if (value === than) return "same";
    if (!SZ_FIELD_ORDER || SZ_FIELD_ORDER.data !== DATA_SZ) {
      SZ_FIELD_ORDER = { data: DATA_SZ, pairs: {} };
      Object.keys(DATA_SZ.fieldReductions || {}).forEach((f) => {
        SZ_FIELD_ORDER.pairs[f] = new Set(DATA_SZ.fieldReductions[f].map((pair) => pair[0] + "\u0001" + pair[1]));
      });
    }
    const pairs = SZ_FIELD_ORDER.pairs[field];
    if (!pairs) return "unknown";
    if (pairs.has(value + "\u0001" + than)) return "narrower";
    if (pairs.has(than + "\u0001" + value)) return "wider";
    return "unknown";
  }

  function szValueLabel(field, value) {
    if (!value) return "none";
    return field === "number of machines" && value === "1" ? "1" : szChoiceLabel(field, value);
  }
  function szWiderFieldLi(f) {
    return "<li><b>" + escapeHtml(szFieldName(f.field)) + "</b>: " + escapeHtml(szValueLabel(f.field, f.specific)) +
      " is more general than " + escapeHtml(szValueLabel(f.field, f.general)) + "</li>";
  }

  function designerArrowPick(id) {
    if (!designerArrowMode.from) {
      designerArrowMode.from = id;
      renderDesign();
      return;
    }
    const from = designerArrowMode.from;
    if (id === from) { designerArrowMode.from = null; renderDesign(); return; }
    designerArrowMode = null;
    const a = storyNodeById(from), b = storyNodeById(id);
    if (designerUserEdges.some((e) => e.from === from && e.to === id)) {
      designerArrowNotice = "That arrow is already on the map.";
      renderDesign();
      return;
    }
    renderDesign();
    showDesignerReductionDialog({ from: from, to: id }, -1);
  }

  // ---- describing a hand-drawn reduction
  // Kinds follow Documentation > Arrow rule types.
  const SZ_REDUCTION_KINDS = [
    { id: "restriction", label: "Value restriction", hint: "Every instance of the special case already is an instance of the general problem -- a field is narrowed, nothing is rewritten." },
    { id: "padding", label: "Padding or defaults", hint: "A trivial rewrite makes it one: weights set to 1, release or due dates set to 0, an idle machine added." },
    { id: "encoding", label: "Encoding reduction", hint: "Instances are genuinely transformed to simulate a feature the general problem lacks, e.g. p_ij = ∞ to encode machine sets." },
    { id: "objective", label: "Objective or threshold", hint: "The objective is rewritten, or the answer is only preserved at one threshold (Lmax ≤ 0 iff ΣTj = 0)." },
    { id: "other", label: "Another polynomial-time reduction", hint: "Any other many-one reduction." },
    { id: "unsure", label: "Not sure", hint: "" },
  ];
  const SZ_REDUCTION_NUMBERS = [
    { id: "polynomial", label: "Keeps numbers polynomially bounded", hint: "Strong NP-hardness carries over." },
    { id: "blowup", label: "May blow numbers up", hint: "Only (weak) NP-hardness carries over." },
    { id: "unsure", label: "Not sure", hint: "" },
  ];
  const SZ_REDUCTION_PARAMS = [
    { id: "all", label: "Safe for every parameter", hint: "Each parameter keeps its value, or stays bounded by a function of it -- as with a plain restriction." },
    { id: "some", label: "Safe only for these parameters", hint: "" },
    { id: "none", label: "Not parameter-safe", hint: "Parameterized hardness does not carry over." },
    { id: "unsure", label: "Not sure", hint: "" },
  ];

  function szReductionSummary(edge) {
    const pick = (list, id) => (list.find((x) => x.id === id) || {}).label;
    if (!edge.kind) return "no description";
    const parts = [pick(SZ_REDUCTION_KINDS, edge.kind)];
    if (edge.numbers && edge.numbers !== "unsure") parts.push(edge.numbers === "polynomial" ? "numbers stay polynomial" : "numbers may blow up");
    if (edge.params === "all") parts.push("parameter-safe");
    else if (edge.params === "some") parts.push("parameter-safe for " + ((edge.safeParams || []).join(", ") || "no parameter chosen"));
    else if (edge.params === "none") parts.push("not parameter-safe");
    return parts.join(" · ");
  }

  // The single parameters results are stated for in The Scheduling Zoo
  // (m, pmax, #p, ...), most used first.
  function szParameterTokens() {
    const counts = {};
    DATA_SZ.nodes.forEach((n) => n.params.forEach((r) => paramLabelTokens(r.param).forEach((t) => { counts[t] = (counts[t] || 0) + 1; })));
    return Object.keys(counts).sort((x, y) => counts[y] - counts[x] || x.localeCompare(y));
  }

  // A best guess to start from: when the two problems differ only by fields
  // the rules call narrower, it looks like a plain restriction.
  function szGuessReductionKind(fromId, toId) {
    const va = szProblemVector(storyNodeById(fromId)), vb = szProblemVector(storyNodeById(toId));
    if (!va || !vb) return "unsure";
    const fields = Object.keys(Object.assign({}, va, vb));
    const rel = fields.map((f) => szFieldRelation(f, vb[f] || "", va[f] || ""));
    return rel.every((r) => r === "same" || r === "narrower") && rel.includes("narrower") ? "restriction" : "unsure";
  }

  // `index` -1 adds a new arrow; otherwise it edits designerUserEdges[index].
  function showDesignerReductionDialog(edge, index) {
    const a = storyNodeById(edge.from), b = storyNodeById(edge.to);
    const editing = index >= 0;
    const kind = edge.kind || szGuessReductionKind(edge.from, edge.to);
    const plain = kind === "restriction";
    const state = {
      kind: kind,
      numbers: edge.numbers || (plain ? "polynomial" : "unsure"),
      params: edge.params || (plain ? "all" : "unsure"),
      safeParams: new Set(edge.safeParams || []),
      note: edge.note || "",
    };
    const radios = (name, list, current) => list.map((o) =>
      '<label class="designer-reduction-option"><input type="radio" name="' + name + '" value="' + o.id + '"' + (o.id === current ? " checked" : "") + ">" +
      "<span><b>" + escapeHtml(o.label) + "</b>" + (o.hint ? "<small>" + escapeHtml(o.hint) + "</small>" : "") + "</span></label>").join("");
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<form class="designer-dialog designer-reduction-dialog" role="dialog" aria-modal="true" aria-labelledby="designer-reduction-title">' +
      '<h3 id="designer-reduction-title">You claim that <span class="designer-reduction-problem">' + escapeHtml(b.notation) +
      '</span> reduces to <span class="designer-reduction-problem">' + escapeHtml(a.notation) + "</span>. The reduction is:</h3>" +
      '<fieldset><legend>Kind <a href="#/docs/docs-arrow-rules" target="_blank" rel="noopener">what these mean</a></legend>' + radios("kind", SZ_REDUCTION_KINDS, state.kind) + "</fieldset>" +
      "<fieldset><legend>Numbers</legend>" + radios("numbers", SZ_REDUCTION_NUMBERS, state.numbers) + "</fieldset>" +
      "<fieldset><legend>Parameters</legend>" + radios("params", SZ_REDUCTION_PARAMS, state.params) +
      '<div class="designer-reduction-params">' + szParameterTokens().map((t) =>
        '<label class="chip' + (state.safeParams.has(t) ? " active" : "") + '"><input type="checkbox" value="' + escapeHtml(t) + '"' +
        (state.safeParams.has(t) ? " checked" : "") + ">" + escapeHtml(t) + "</label>").join("") + "</div></fieldset>" +
      '<label class="designer-reduction-note">Source or note <small>(optional)</small>' +
      '<input type="text" class="sz-filter" name="note" placeholder="e.g. Lemma 3 of …, or a one-line idea of the reduction" value="' + escapeHtml(state.note) + '"></label>' +
      '<div class="designer-dialog-actions">' +
      (editing ? '<button type="button" class="map-history-btn designer-reduction-remove">Remove arrow</button>' : "") +
      '<button type="button" class="map-history-btn" data-dialog="cancel">Cancel</button>' +
      '<button type="submit" class="map-history-btn designer-dialog-report">' + (editing ? "Save changes" : "Add arrow") + "</button>" +
      "</div></form>";
    const form = backdrop.querySelector("form");
    const paramBox = form.querySelector(".designer-reduction-params");
    const syncParams = () => {
      const some = form.params.value === "some";
      paramBox.classList.toggle("disabled", !some);
      paramBox.querySelectorAll("input").forEach((i) => { i.disabled = !some; });
    };
    syncParams();
    // Choosing "Value restriction" fills in what a restriction implies; the
    // other answers stay editable.
    form.querySelectorAll('input[name="kind"]').forEach((i) => i.addEventListener("change", () => {
      if (i.value === "restriction" && i.checked) {
        form.numbers.value = "polynomial";
        form.params.value = "all";
        syncParams();
      }
    }));
    form.querySelectorAll('input[name="params"]').forEach((i) => i.addEventListener("change", syncParams));
    paramBox.querySelectorAll("input").forEach((i) => i.addEventListener("change", () => i.parentElement.classList.toggle("active", i.checked)));
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    form.querySelector('[data-dialog="cancel"]').addEventListener("click", close);
    const remove = form.querySelector(".designer-reduction-remove");
    if (remove) remove.addEventListener("click", () => {
      designerUserEdges.splice(index, 1);
      designerArrowNotice = "";
      close();
      renderDesign();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const next = {
        from: edge.from, to: edge.to,
        kind: form.kind.value, numbers: form.numbers.value, params: form.params.value,
        safeParams: form.params.value === "some" ? Array.from(paramBox.querySelectorAll("input:checked")).map((i) => i.value) : [],
        note: form.note.value.trim(),
      };
      close();
      let at = index;
      if (editing) designerUserEdges[index] = next;
      else { designerUserEdges.push(next); at = designerUserEdges.length - 1; }
      const implied = DATA_SZ.nodes.some((n) => n.id === next.from) && szDescendants(next.from).has(next.to);
      const reverse = DATA_SZ.nodes.some((n) => n.id === next.to) && szDescendants(next.to).has(next.from);
      designerArrowNotice = (editing ? "Updated " : "Added ") + a.notation + " → " + b.notation + " (" + szReductionSummary(next) + ")." +
        (implied ? " The Scheduling Zoo's reductions already imply it." : "") +
        (reverse ? " The Scheduling Zoo records the opposite direction, so together they would make the two problems equivalent." : "");
      renderDesign();
      const conflict = designerArrowConflict(next);
      if (conflict) showDesignerConflictDialog(conflict, at);
    });
    document.body.appendChild(backdrop);
    form.querySelector('input[name="kind"]:checked').focus();
  }

  function szClassLabel(classId) {
    const cc = classicalClassById(classId);
    return classId === "unclaimed" || !cc ? "open" : cc.label;
  }

  // The claim behind a problem's class, in words, for the dialog and report.
  function szClassEvidence(node) {
    const direct = node.classicalClass && node.classicalClass !== "unclaimed";
    if (!direct) return "not cited directly -- inherited as " + szClassLabel(SZ_EFFECTIVE[node.id]) + " from a special case of it";
    const kind = node.classicalClass === "P" ? "upper" : "lower";
    return (node.classical || []).filter((r) => r.kind === kind).slice(0, 3)
      .map((r) => r.bound + " (" + [r.author, r.year].filter(Boolean).join(", ") + (r.title ? ": " + r.title : "") + ")")
      .join("; ");
  }

  // One problem in the conflict dialog: its notation, class and cited bound
  // in the class's own color (green for P, red for strongly NP-hard, ...).
  function szConflictResultLi(node, classId) {
    const cc = classicalClassById(classId);
    const evidence = szClassEvidence(node);
    const cut = evidence.indexOf(" (");
    const claim = cut === -1 ? evidence : evidence.slice(0, cut);
    const source = cut === -1 ? "" : evidence.slice(cut);
    return '<li><span class="designer-dialog-claim" style="color:' + (cc ? cc.color : "var(--fg)") + '"><b>' +
      escapeHtml(node.notation) + "</b>: " + escapeHtml(szClassLabel(classId)) + " -- " + escapeHtml(claim) + "</span>" +
      '<span class="designer-dialog-source">' + escapeHtml(source) + "</span></li>";
  }

  function designerReportUrl(c) {
    const title = "Possible inconsistency: " + c.specific.notation + " as a special case of " + c.general.notation;
    const body = c.kind === "rules" ? [
      "While building a problem map on The Parameterized Scheduling Zoo, I drew the reduction",
      "",
      "    " + c.general.notation + "  →  " + c.specific.notation,
      "",
      "(every " + c.specific.notation + " instance is also an instance of " + c.general.notation + "). The reduction rules in notation.xml say the opposite in these fields:",
      "",
    ].concat(c.fields.map((f) => "- " + szFieldName(f.field) + ": " + szValueLabel(f.field, f.specific) + " is more general than " + szValueLabel(f.field, f.general)))
      .concat(["", "So either the reduction is wrong, or one of these rules is."]).join("\n") : [
      "While building a problem map on The Parameterized Scheduling Zoo, I drew the reduction",
      "",
      "    " + c.general.notation + "  →  " + c.specific.notation,
      "",
      "(every " + c.specific.notation + " instance is also an instance of " + c.general.notation + "). It conflicts with the results recorded here, since " + c.why + ":",
      "",
      "- " + c.general.notation + ": " + szClassLabel(c.generalClass) + " -- " + szClassEvidence(c.general),
      "- " + c.specific.notation + ": " + szClassLabel(c.specificClass) + " -- " + szClassEvidence(c.specific),
      "",
      "So either the reduction is wrong, or one of these results is.",
    ].join("\n");
    return SZ_REPORT_ISSUE_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body.slice(0, 6000));
  }

  function showDesignerConflictDialog(c, edgeIndex) {
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<div class="designer-dialog" role="dialog" aria-modal="true" aria-labelledby="designer-dialog-title">' +
      '<h3 id="designer-dialog-title">Your reduction conflicts with the data of The Scheduling Zoo. Want to report a problem?</h3>' +
      "<p>The arrow <b>" + escapeHtml(c.general.notation) + " → " + escapeHtml(c.specific.notation) + "</b> says every " +
      escapeHtml(c.specific.notation) + " instance is also an instance of " + escapeHtml(c.general.notation) + ". " +
      (c.kind === "rules"
        ? "But by The Scheduling Zoo's reduction rules, " + escapeHtml(c.specific.notation) + " is the more general one in " +
          (c.fields.length === 1 ? "this field" : "these fields") + ":</p>" +
          '<ul class="designer-dialog-results">' + c.fields.map(szWiderFieldLi).join("") + "</ul>" +
          "<p>So either this reduction is flawed -- a special case can narrow a field, never widen it -- or one of " +
          "these rules is wrong, or the arrow stands for a genuine encoding between the two problems rather than a " +
          "restriction. "
        : "But " + escapeHtml(c.why) + ":</p>" +
          '<ul class="designer-dialog-results">' + szConflictResultLi(c.general, c.generalClass) + szConflictResultLi(c.specific, c.specificClass) + "</ul>" +
          "<p>So either this reduction is flawed, or one of these published results is in error -- or you have just " +
          "proved P = NP. ") +
      "Reporting opens a pre-filled issue on The Scheduling Zoo's GitHub page; nothing is sent until you submit it there.</p>" +
      '<div class="designer-dialog-actions">' +
      '<a class="map-history-btn designer-dialog-report" target="_blank" rel="noopener" href="' + escapeHtml(designerReportUrl(c)) + '">Report a problem</a>' +
      '<button type="button" class="map-history-btn" data-dialog="remove">Remove arrow</button>' +
      '<button type="button" class="map-history-btn" data-dialog="keep">Keep arrow</button>' +
      "</div></div>";
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector(".designer-dialog-report").addEventListener("click", close);
    backdrop.querySelector('[data-dialog="keep"]').addEventListener("click", close);
    backdrop.querySelector('[data-dialog="remove"]').addEventListener("click", () => {
      designerUserEdges.splice(edgeIndex, 1);
      designerArrowNotice = "";
      close();
      renderDesign();
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector(".designer-dialog-report").focus();
  }

  function designerMapBarHtml() {
    return '<div class="designer-map-bar">' +
      '<input type="text" class="sz-filter designer-map-title" placeholder="Untitled problem map" aria-label="Map title" value="' +
      escapeHtml(designerMapTitle) + '">' +
      '<button type="button" class="map-history-btn designer-save-map-btn">Save problem map</button>' +
      '<span class="designer-save-status" role="status"></span></div>';
  }

  function enableDesignerMapBar() {
    const view = els.viewDesign;
    const title = view.querySelector(".designer-map-title");
    const status = view.querySelector(".designer-save-status");
    title.addEventListener("input", () => { designerMapTitle = title.value; status.textContent = ""; });
    view.querySelector(".designer-save-map-btn").addEventListener("click", () => {
      const r = saveDesignerMap();
      status.innerHTML = r.ok
        ? (r.created ? "Saved" : "Updated") + ' in <a href="#/zoo-maps">Problem Maps</a>'
        : escapeHtml(r.message);
      title.value = designerMapTitle;
    });
  }
  function designerRelationControls() {
    const node = storyNodeById(designerSelectedId);
    if (!node) return '<div class="designer-relations"><span class="designer-relations-empty">Select a node to generalize, specialize, or inspect it.</span></div>';
    const general = DATA_SZ.edges.filter((edge) => edge.to === node.id).map((edge) => DATA_SZ.nodes.find((item) => item.id === edge.from)).filter(Boolean);
    const specific = DATA_SZ.edges.filter((edge) => edge.from === node.id).map((edge) => DATA_SZ.nodes.find((item) => item.id === edge.to)).filter(Boolean);
    const button = (item, kind) => '<button type="button" class="designer-relation-btn" data-designer-relation="' + escapeHtml(item.id) + '"><span>' + escapeHtml(item.notation) + '</span><small>' + kind + '</small></button>';
    return '<div class="designer-relations"><div class="designer-relations-title">Selected: ' + escapeHtml(node.notation) + '</div>' +
      (node.draft ? '<span class="designer-draft-label">Draft node</span>' : '<button type="button" class="reset-btn designer-details-btn" id="designer-details">Open details</button>') +
      '<div class="designer-relations-group"><b>Generalize</b>' + (general.length ? general.map((item) => button(item, "generalization")).join("") : '<span class="designer-relations-empty">No direct generalization in the adjusted graph.</span>') + '</div>' +
      '<div class="designer-relations-group"><b>Specialize</b>' + (specific.length ? specific.map((item) => button(item, "specialization")).join("") : '<span class="designer-relations-empty">No direct specialization in the adjusted graph.</span>') + '</div></div>';
  }

  function enableDesignerRelations() {
    const view = els.viewDesign;
    view.querySelectorAll("[data-designer-relation]").forEach((button) => button.addEventListener("click", () => addStoryProblem(button.dataset.designerRelation)));
    const details = view.querySelector("#designer-details");
    if (details) details.addEventListener("click", () => openSchedulingZooPanel(designerSelectedId));
  }

  function designerNodePositions(nodeW, nodeH) {
    const positions = {};
    storyProblemIds.forEach((id) => {
      const p = storyPositions[id];
      if (p) positions[id] = { left: p.left, top: p.top, cx: p.left + nodeW / 2, cy: p.top + nodeH / 2 };
    });
    return positions;
  }

  function designerMapEdges() {
    const hidden = MAP_HIDDEN_IDS[DESIGNER_MAP_ID] || new Set();
    const visible = storyProblemIds.filter((id) => !hidden.has(id));
    const outgoing = {};
    designerRelationPairs().forEach((edge) => { (outgoing[edge.from] = outgoing[edge.from] || []).push(edge.to); });
    const reach = {};
    const reachOf = (id) => {
      if (!reach[id]) {
        const seen = new Set(), stack = (outgoing[id] || []).slice();
        while (stack.length) {
          const x = stack.pop();
          if (!seen.has(x)) { seen.add(x); (outgoing[x] || []).forEach((y) => stack.push(y)); }
        }
        reach[id] = seen;
      }
      return reach[id];
    };
    const full = [];
    visible.forEach((from) => visible.forEach((to) => {
      if (from !== to && reachOf(from).has(to)) full.push({ from: from, to: to });
    }));
    return full.filter((edge) => !visible.some((middle) => middle !== edge.from && middle !== edge.to && reachOf(edge.from).has(middle) && reachOf(middle).has(edge.to)));
  }

  let designerRelationCache = { key: null, pairs: null };
  function designerRelationPairs() {
    const cacheKey = DATA_SZ.edges.length + "|" + storyProblemIds.filter((id) => designerDraftNodes[id]).sort().join(",");
    if (designerRelationCache.key === cacheKey) return designerRelationCache.pairs;
    const pairs = (DATA_SZ.edges || []).map((edge) => ({ from: edge.from, to: edge.to }));
    const nodeById = new Map((DATA_SZ.nodes || []).map((node) => [node.id, node]));
    storyProblemIds.forEach((id) => { const node = storyNodeById(id); if (node) nodeById.set(id, node); });
    const nodes = Array.from(nodeById.values());
    const precedenceRelations = [
      ["prec", "chains"], ["prec", "outtree"], ["prec", "intree"], ["prec", "tree"],
      ["outtree", "chains"], ["intree", "chains"], ["tree", "chains"],
    ];
    nodes.forEach((from) => nodes.forEach((to) => {
      if (from.id === to.id) return;
      const a = String(from.notation || "").split("|");
      const b = String(to.notation || "").split("|");
      if (a.length !== 3 || b.length !== 3 || a[0] !== b[0] || a[2] !== b[2]) return;
      const general = new Set(a[1].split(/[;|]+/).filter(Boolean));
      const specific = new Set(b[1].split(/[;|]+/).filter(Boolean));
      const generalWithoutProcessing = new Set(Array.from(general).filter((value) => value !== "pj=p"));
      const specificWithoutProcessing = new Set(Array.from(specific).filter((value) => value !== "pj=1"));
      if (general.has("pj=p") && specific.has("pj=1") && Array.from(generalWithoutProcessing).every((value) => specificWithoutProcessing.has(value))) {
        pairs.push({ from: from.id, to: to.id });
      }
      const generalShape = Array.from(general).find((value) => precedenceRelations.some((relation) => relation[0] === value));
      const specificShape = Array.from(specific).find((value) => precedenceRelations.some((relation) => relation[1] === value));
      const sameOtherFields = Array.from(general).filter((value) => value !== generalShape).every((value) => specific.has(value));
      if (generalShape && specificShape && sameOtherFields && precedenceRelations.some((relation) => relation[0] === generalShape && relation[1] === specificShape)) {
        pairs.push({ from: from.id, to: to.id });
      }
    }));
    designerRelationCache = { key: cacheKey, pairs: pairs };
    return pairs;
  }

  function renderDesignerMap() {
    const nodeH = MAP_NODE_H_DEFAULT;
    const nodeW = Math.max(150, ...storyProblemIds.map((id) => measureTextWidthPx(storyNodeById(id).notation, MAP_NODE_FONT_SIZE_REM * 16) + 24));
    const positions = designerNodePositions(nodeW, nodeH);
    const hidden = MAP_HIDDEN_IDS[DESIGNER_MAP_ID] || new Set();
    const visibleIds = storyProblemIds.filter((id) => !hidden.has(id));
    const width = Math.max(900, ...Object.values(positions).map((p) => p.left + nodeW + MAP_MARGIN));
    const height = Math.max(480, ...Object.values(positions).map((p) => p.top + nodeH + MAP_MARGIN));
    const marker = (id, style) => '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="' + STEALTH_ARROW_PATH + '" style="' + style + '" /></marker>';
    const arrowDef = "<defs>" + marker("designer-map-arrow", "fill:" + MAP_EDGE_COLOR) + marker("designer-user-arrow", "fill:var(--accent)") +
      marker("designer-conflict-arrow", "fill:" + SZ_EDGE_FLAGGED_COLOR) + "</defs>";
    const lines = designerMapEdges().map((edge) => {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b) return "";
      const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, nodeW / 2, nodeH / 2, 5);
      return '<line data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '" x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y + '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="2" marker-end="url(#designer-map-arrow)" />';
    }).join("") +
    // Arrows added by hand: dashed, in the accent color, or red when they
    // conflict with The Scheduling Zoo's results. Click one to remove it.
    designerUserEdges.map((edge, i) => {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b || hidden.has(edge.from) || hidden.has(edge.to)) return "";
      const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, nodeW / 2, nodeH / 2, 5);
      const conflict = !!designerArrowConflict(edge);
      const ends = 'data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '" x1="' + a.cx + '" y1="' + a.cy + '" x2="' + tip.x + '" y2="' + tip.y + '"';
      return '<g class="designer-user-edge" data-user-edge="' + i + '"><title>' + escapeHtml("Added by you: " + szReductionSummary(edge) + (conflict ? " -- conflicts with The Scheduling Zoo's data" : "") + ". Click to edit or remove.") + '</title>' +
        '<line class="designer-user-edge-hit" ' + ends + ' />' +
        '<line ' + ends + ' style="stroke:' + (conflict ? SZ_EDGE_FLAGGED_COLOR : "var(--accent)") + '" stroke-width="2.4" stroke-dasharray="7,4" marker-end="url(#' +
        (conflict ? "designer-conflict-arrow" : "designer-user-arrow") + ')" /></g>';
    }).join("");
    const nodes = visibleIds.map((id) => {
      const p = storyNodeById(id);
      const cc = classicalClassById(SZ_EFFECTIVE[id] || p.classicalClass);
      const pos = positions[id];
      const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
      const text = cc && cc.fill ? fillTextColor(cc) : null;
      return '<a class="map-node' + (cc && !cc.fill ? " outline" : "") + (designerArrowMode ? (designerArrowMode.from === id ? " arrow-origin" : "") : (id === designerSelectedId ? " designer-selected" : "")) + '" data-problem-id="' + escapeHtml(id) + '" href="javascript:void(0)" style="left:' + pos.left + 'px;top:' + pos.top + 'px;width:' + nodeW + 'px;height:' + nodeH + 'px;background:' + bg + ';border-color:' + (cc ? cc.color : "#868e96") + ';border-style:' + (cc ? (cc.border || "solid") : "solid") + (text ? ';color:' + text : "") + ';font-size:' + MAP_NODE_FONT_SIZE_REM + 'rem">' + escapeHtml(p.notation) + '</a>';
    }).join("");
    const controls = '<div class="map-history-controls">' +
      '<button type="button" class="map-undo-btn map-history-btn" disabled title="Undo the last hidden node">↶ Undo</button>' +
      '<button type="button" class="map-redo-btn map-history-btn" disabled title="Redo the last hidden node">↷ Redo</button>' +
      '<button type="button" class="map-reset-hidden-btn map-history-btn" disabled title="Restore hidden nodes">↺ Restore hidden</button>' +
      '<button type="button" class="designer-clear-btn map-history-btn" title="Remove every problem from the designer">Clear map</button>' +
      '<button type="button" class="designer-add-arrow-btn map-history-btn" aria-pressed="' + (designerArrowMode ? "true" : "false") +
      '" title="Add an arrow: click the more general problem, then its special case" aria-label="Add arrow">→+</button></div>' +
      '<button type="button" class="tikz-export-btn" title="Copy this diagram as TikZ code">⧉ TikZ</button>' +
      '<button type="button" class="auto-arrange-btn" title="Recompute node positions">⇄ Auto-arrange</button>';
    // While picking an arrow's ends, the instruction floats at the top of the
    // window; afterwards, the result of adding it sits under the map.
    const arrowHint = designerArrowMode ? "" : designerArrowNotice;
    const arrowToast = designerArrowMode
      ? '<div class="designer-arrow-toast" role="status"><b>' +
        (designerArrowMode.from ? "Choose Destination Problem" : "Choose Origin Problem") + "</b>" +
        '<span>' + (designerArrowMode.from ? "the special case the arrow points to" : "the more general problem the arrow starts from") +
        " · Esc to cancel</span></div>"
      : "";
    return '<div class="map-diagram designer-map-diagram' + (designerArrowMode ? " arrow-mode" : "") + '">' + controls + '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + width + 'px;height:' + height + 'px"><svg class="map-edge-svg" width="' + width + '" height="' + height + '">' + arrowDef + lines + '</svg>' + nodes + '</div></div></div>' +
      (arrowHint ? '<p class="designer-arrow-hint" role="status">' + escapeHtml(arrowHint) + "</p>" : "") + arrowToast +
      '<p class="map-hint"><span class="map-hint-icon">i</span> Drag nodes to arrange them. Drag a node past the diagram edge to hide it; Undo, Redo, or Restore hidden brings it back.</p>';
  }

  function autoArrangeDesigner() {
    const nodeW = Math.max(150, ...storyProblemIds.map((id) => measureTextWidthPx(storyNodeById(id).notation, MAP_NODE_FONT_SIZE_REM * 16) + 24));
    const colW = nodeW + 40, rowH = MAP_NODE_H_DEFAULT + 50;
    const cols = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(storyProblemIds.length * 1.5))));
    const { slots } = designerGraphSlots(storyProblemIds, designerMapEdges(), cols, 0);
    storyProblemIds.forEach((id) => {
      storyPositions[id] = { left: MAP_MARGIN + slots[id].col * colW, top: MAP_MARGIN + slots[id].row * rowH };
    });
  }

  function enableDesignerMap() {
    const view = els.viewDesign;
    const canvas = view.querySelector(".map-canvas");
    const nodeW = Math.max(150, ...storyProblemIds.map((id) => measureTextWidthPx(storyNodeById(id).notation, MAP_NODE_FONT_SIZE_REM * 16) + 24));
    enableMapNodeDragging(canvas, nodeW, MAP_NODE_H_DEFAULT, DESIGNER_MAP_ID, view, (id) => {
      if (designerArrowMode) { designerArrowPick(id); return; }
      designerSelectedId = id;
      renderDesign();
    }, () => !!designerArrowMode);
    view.querySelector(".designer-add-arrow-btn").addEventListener("click", () => {
      designerArrowMode = designerArrowMode ? null : { from: null };
      designerArrowNotice = "";
      renderDesign();
    });
    view.querySelectorAll("[data-user-edge]").forEach((g) => g.addEventListener("click", () => {
      const edge = designerUserEdges[+g.dataset.userEdge];
      if (edge) showDesignerReductionDialog(edge, +g.dataset.userEdge);
    }));
    if (!window.designerArrowEscReady) {
      window.designerArrowEscReady = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && designerArrowMode && !els.viewDesign.hidden && !document.querySelector(".designer-dialog-backdrop")) {
          designerArrowMode = null;
          renderDesign();
        }
      });
    }
    setTimeout(() => fitMapCanvasToWidth(view), 0);
    view.querySelector(".auto-arrange-btn").addEventListener("click", () => { autoArrangeDesigner(); renderDesign(); });
    view.querySelector(".designer-clear-btn").addEventListener("click", () => { storyProblemIds = []; storyPositions = {}; designerUserEdges = []; designerArrowMode = null; designerArrowNotice = ""; designerSelectedId = null; MAP_HIDDEN_IDS[DESIGNER_MAP_ID] = new Set(); MAP_HIDDEN_STACK[DESIGNER_MAP_ID] = []; MAP_HIDDEN_REDO_STACK[DESIGNER_MAP_ID] = []; renderDesign(); });
    view.querySelector(".map-undo-btn").addEventListener("click", () => mapUndoHide(DESIGNER_MAP_ID, view));
    view.querySelector(".map-redo-btn").addEventListener("click", () => mapRedoHide(DESIGNER_MAP_ID, view));
    view.querySelector(".map-reset-hidden-btn").addEventListener("click", () => mapResetHidden(DESIGNER_MAP_ID, view));
    view.querySelector(".tikz-export-btn").addEventListener("click", () => {
      const livePositions = {};
      canvas.querySelectorAll(".map-node:not(.node-hidden)").forEach((node) => {
        const left = parseFloat(node.style.left), top = parseFloat(node.style.top);
        livePositions[node.dataset.problemId] = { left, top, cx: left + nodeW / 2, cy: top + MAP_NODE_H_DEFAULT / 2, w: nodeW, h: MAP_NODE_H_DEFAULT };
      });
      const selectedNodes = storyProblemIds.map((id) => storyNodeById(id));
      copyTextToClipboard(szMapToTikzCode(selectedNodes, designerMapEdges().concat(designerUserEdges), livePositions, SZ_EFFECTIVE));
    });
  }

  // Every problem reachable along the arrows from `id`, so the results graph
  // can connect two matches even when the problem between them isn't one.
  let SZ_DESCENDANTS = null;
  function szDescendants(id) {
    if (!SZ_DESCENDANTS || SZ_DESCENDANTS.data !== DATA_SZ) {
      const out = {};
      DATA_SZ.edges.forEach((e) => { (out[e.from] = out[e.from] || []).push(e.to); });
      SZ_DESCENDANTS = { data: DATA_SZ, out: out, memo: {} };
    }
    const c = SZ_DESCENDANTS;
    if (!c.memo[id]) {
      const seen = new Set(), stack = (c.out[id] || []).slice();
      while (stack.length) {
        const x = stack.pop();
        if (!seen.has(x)) { seen.add(x); (c.out[x] || []).forEach((y) => stack.push(y)); }
      }
      c.memo[id] = seen;
    }
    return c.memo[id];
  }

  // Grid slots {row, col} for a small graph drawn `cols` cells wide, with the
  // first `reserved` cells of the top row's right end kept free. Each group
  // of connected problems is laid out as its own block -- layered from the
  // most general down, a problem with no parent here pulled down to just
  // above its nearest child, and every box in the column nearest its
  // neighbours -- and the blocks are packed left to right, row by row, with
  // unconnected problems filling the rows after them.
  function designerGraphSlots(ids, edges, cols, reserved) {
    const parentsOf = {}, childrenOf = {};
    ids.forEach((id) => { parentsOf[id] = []; childrenOf[id] = []; });
    edges.forEach((e) => { parentsOf[e.to].push(e.from); childrenOf[e.from].push(e.to); });

    const groupOf = {}, groups = [];
    ids.forEach((start) => {
      if (groupOf[start] !== undefined || (!parentsOf[start].length && !childrenOf[start].length)) return;
      const members = [], stack = [start];
      groupOf[start] = groups.length;
      while (stack.length) {
        const x = stack.pop();
        members.push(x);
        parentsOf[x].concat(childrenOf[x]).forEach((y) => { if (groupOf[y] === undefined) { groupOf[y] = groups.length; stack.push(y); } });
      }
      groups.push(members);
    });
    const isolated = ids.filter((id) => groupOf[id] === undefined);

    // One block: local rows and columns, at most `width` columns wide.
    const block = (members, width) => {
      const memberEdges = edges.filter((e) => groupOf[e.from] === groupOf[members[0]]);
      const layer = layoutDag(members, memberEdges).row;
      members.forEach((id) => {
        if (!parentsOf[id].length) layer[id] = Math.min(...childrenOf[id].map((c) => layer[c])) - 1;
      });
      const layers = {};
      members.forEach((id) => { (layers[layer[id]] = layers[layer[id]] || []).push(id); });
      const keys = Object.keys(layers).map(Number).sort((x, y) => x - y);
      const w = Math.min(width, Math.max(...keys.map((k) => layers[k].length)));
      let local = {}, height = 0;
      const place = (want) => {
        local = {};
        let row = 0;
        keys.forEach((k) => {
          const items = layers[k];
          for (let i = 0; i < items.length; i += w) {
            const chunk = items.slice(i, i + w);
            const cs = chunk.map((id, j) => want ? Math.min(w - 1, Math.max(0, Math.round(want[id]))) : j + (w - chunk.length) / 2);
            for (let j = 1; j < cs.length; j += 1) cs[j] = Math.max(cs[j], cs[j - 1] + 1);
            for (let j = cs.length - 1; j >= 0; j -= 1) cs[j] = Math.min(cs[j], (j + 1 < cs.length ? cs[j + 1] : w) - 1);
            chunk.forEach((id, j) => { local[id] = { row: row, col: cs[j] }; });
            row += 1;
          }
        });
        height = row;
      };
      const wishes = (neighbours) => {
        const want = {};
        members.forEach((id) => {
          const xs = neighbours(id).map((n) => local[n].col);
          want[id] = xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : local[id].col;
        });
        keys.forEach((k) => layers[k].sort((x, y) => want[x] - want[y] || local[x].col - local[y].col));
        return want;
      };
      place(null);
      for (let sweep = 0; sweep < 4; sweep += 1) {
        place(wishes((id) => parentsOf[id]));
        place(wishes((id) => childrenOf[id]));
      }
      place(wishes((id) => parentsOf[id].concat(childrenOf[id])));
      return { local: local, w: w, h: height };
    };

    const slots = {};
    let shelfTop = 0, shelfH = 0, x = 0;
    const shelfWidth = () => cols - (shelfTop === 0 ? reserved : 0);
    groups
      .slice()
      .sort((g1, g2) => g2.length - g1.length)
      .forEach((members) => {
        let b = block(members, Math.max(1, shelfWidth()));
        if (x > 0 && x + b.w > shelfWidth()) {
          shelfTop += shelfH;
          shelfH = 0;
          x = 0;
          b = block(members, Math.max(1, shelfWidth()));
        }
        members.forEach((id) => { slots[id] = { row: shelfTop + b.local[id].row, col: x + b.local[id].col }; });
        x += b.w;
        shelfH = Math.max(shelfH, b.h);
      });
    let row = groups.length ? shelfTop + shelfH : 0;
    let k = 0;
    while (k < isolated.length) {
      const c = cols - (row === 0 ? reserved : 0);
      if (c <= 0) { row += 1; continue; }
      const chunk = isolated.slice(k, k + c);
      chunk.forEach((id, j) => { slots[id] = { row: row, col: j + (c - chunk.length) / 2 }; });
      k += c;
      row += 1;
    }
    return { slots: slots, rows: Math.max(row, reserved ? 1 : 0) };
  }

  let designerMiniWidth = 0; // last measured width of the results panel
  let designerDropdowns = []; // the live filter controls, for their counts

  // The results panel's contents: matching problems laid out as a graph that
  // fills the panel's width, with the new-problem box (or the reason there
  // is none) at the right end of the top row.
  function designerResultsInnerHtml() {
    const selected = new Set(storyProblemIds);
    const matches = designerFilteredNodes();
    const bySignature = new Map();
    matches.forEach((node) => { if (!bySignature.has(notationSignature(node))) bySignature.set(notationSignature(node), node); });
    const unique = Array.from(bySignature.values());
    const draft = designerFiltersActive() ? designerDraftProblem() : null;

    const width = Math.max(320, designerMiniWidth || els.viewDesign.clientWidth || 960);
    const pad = 16, gapX = 14, nodeH = 42, rowH = nodeH + 34;
    const fontPx = 0.68 * 16;
    const longest = Math.max(0, ...unique.slice(0, 200).map((n) => measureTextWidthPx(n.notation, fontPx)));
    // Boxes are as wide as the longest label needs; the columns spread them
    // over the whole panel.
    const nodeW = Math.min(280, Math.max(80, Math.ceil(longest * 1.06 + 26))); // bold text, padding and border
    const cols = Math.max(1, Math.floor((width - 2 * pad + gapX) / (nodeW + gapX + 12)));
    const cellW = (width - 2 * pad) / cols;
    const cap = cols * 8;
    const shown = unique.slice(0, cap);
    const ids = shown.map((n) => n.id);
    const idSet = new Set(ids);

    // Arrows between shown problems: every reachable pair, minus the ones
    // another shown problem already sits between.
    const reach = {};
    ids.forEach((id) => { reach[id] = new Set(Array.from(szDescendants(id)).filter((x) => idSet.has(x))); });
    const edges = [];
    ids.forEach((from) => reach[from].forEach((to) => {
      if (!ids.some((mid) => mid !== from && mid !== to && reach[from].has(mid) && reach[mid].has(to))) edges.push({ from: from, to: to });
    }));

    const { slots, rows: used } = designerGraphSlots(ids, edges, cols, 0);
    const positions = {};
    ids.forEach((id) => {
      const left = pad + slots[id].col * cellW + (cellW - nodeW) / 2, top = pad + slots[id].row * rowH;
      positions[id] = { left: left, top: top, cx: left + nodeW / 2, cy: top + nodeH / 2 };
    });
    const rows = used;
    const height = pad * 2 + Math.max(1, rows) * rowH - (rowH - nodeH);

    const lines = edges.map((e) => {
      const from = positions[e.from], to = positions[e.to];
      const tail = pullBackToRect(to.cx, to.cy, from.cx, from.cy, nodeW / 2, nodeH / 2, 2);
      const tip = pullBackToRect(from.cx, from.cy, to.cx, to.cy, nodeW / 2, nodeH / 2, 4);
      return '<line x1="' + tail.x + '" y1="' + tail.y + '" x2="' + tip.x + '" y2="' + tip.y + '" marker-end="url(#designer-mini-arrow)" />';
    }).join("");
    const exactId = draft && draft.existing ? draft.existing.id : null;
    const nodes = shown.map((p) => {
      const cc = classicalClassById(SZ_EFFECTIVE[p.id] || p.classicalClass);
      const bg = cc && cc.fill ? cc.color : "var(--panel-bg)";
      const already = selected.has(p.id);
      const pos = positions[p.id];
      return '<button type="button" class="designer-mini-node' + (already ? " added" : "") +
        (exactId && notationSignature(p) === notationSignature(draft.existing) ? " exact-fit" : "") +
        '" draggable="' + (!already) + '" data-story-problem="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.notation) +
        '" style="left:' + pos.left + "px;top:" + pos.top + "px;width:" + nodeW + "px;height:" + nodeH + "px;background:" + bg +
        ";border-color:" + (cc ? cc.color : "#868e96") + ";color:" + (cc && cc.fill ? fillTextColor(cc) : "var(--fg)") + '">' +
        escapeHtml(p.notation) + "</button>";
    }).join("");
    if (!shown.length) return '<div class="story-empty">No problems match that search.</div>';
    return '<div class="designer-mini-graph" style="width:100%;height:' + height + 'px">' +
      '<svg width="' + width + '" height="' + height + '"><defs><marker id="designer-mini-arrow" viewBox="0 0 10 10" refX="8" refY="5" ' +
      'markerWidth="7" markerHeight="7" orient="auto"><path d="' + STEALTH_ARROW_PATH + '" /></marker></defs>' + lines + "</svg>" +
      nodes + "</div>" +
      (unique.length > shown.length
        ? '<div class="story-empty">Showing ' + shown.length + " of " + unique.length + " matching problems -- narrow the search to see the rest.</div>"
        : "");
  }

  function renderDesignerSearch() {
    const opts = szFilterOptions();
    const active = designerFiltersActive() || storySearchText.trim();
    return '<div class="designer-search-tools">' +
      '<div class="story-search-wrap"><input class="story-search sz-filter" type="search" placeholder="Search, e.g. 1 rj Uj, preemptive, flow shop…" value="' + escapeHtml(storySearchText) + '" aria-label="Search problems to add"></div>' +
      '<div class="designer-filter-row">' +
      buildMsDropdownHtml("designer-ms-machine-env", "Machine Environment", opts.machineEnvOptions, designerFilterState.machineEnv) +
      '<span class="sz-field-sep">|</span>' +
      buildSzSettingsHtml("designer-settings", szSettingGroups(), designerFilterState.settings) +
      '<span class="sz-field-sep">|</span>' +
      buildMsDropdownHtml("designer-ms-objective", "Objective", opts.objectiveOptions, designerFilterState.objective) +
      '<button type="button" id="designer-add-problem" class="map-history-btn designer-add-btn" disabled>+ Add problem</button>' +
      '<button type="button" id="designer-reset-filters" class="map-history-btn" title="Clear the text search and every designer filter">↺ Reset filters</button>' +
      "</div>" +
      '<div class="story-results" role="listbox"' + (active ? "" : " hidden") + "></div></div>";
  }

  // Redraws only the results panel -- the filter controls stay exactly as
  // they are, open dropdown included.
  function refreshDesignerResults() {
    const panel = els.viewDesign.querySelector(".story-results");
    if (!panel || !DATA_SZ) return;
    const active = designerFiltersActive() || storySearchText.trim();
    panel.hidden = !active;
    if (!active) { panel.innerHTML = ""; return; }
    if (panel.clientWidth) designerMiniWidth = panel.clientWidth;
    panel.innerHTML = designerResultsInnerHtml();
    // The panel's width is only known once it is on the page; if the
    // guess used above was off, lay it out again at the real width.
    if (panel.clientWidth && Math.abs(panel.clientWidth - designerMiniWidth) > 2) {
      designerMiniWidth = panel.clientWidth;
      panel.innerHTML = designerResultsInnerHtml();
    }
    const matched = new Set(designerFilteredNodes().map((n) => n.id));
    designerDropdowns.forEach((d) => d.refreshCounts(matched));
    refreshDesignerAddButton();
  }

  // The "Add problem" button in the filter row: enabled only when the filters
  // describe one complete, well-formed problem that isn't already there; its
  // tooltip says what it would add, or why it can't.
  function refreshDesignerAddButton() {
    const btn = els.viewDesign.querySelector("#designer-add-problem");
    if (!btn || !DATA_SZ) return;
    const draft = designerFiltersActive() ? designerDraftProblem() : null;
    const onMap = draft && draft.ok && storyProblemIds.includes("designer-draft-" + draft.notation.replace(/[^a-zA-Z0-9]+/g, "-"));
    btn.disabled = !draft || !draft.ok || onMap;
    btn.textContent = draft && draft.ok ? "+ Add " + draft.notation : "+ Add problem";
    btn.title = !draft
      ? "Set the filters to one complete problem to add it to the map."
      : draft.existing
      ? draft.existing.notation + " is already in The Scheduling Zoo -- it's highlighted below."
      : onMap
      ? draft.notation + " is already on the map."
      : draft.ok
      ? "Add " + draft.notation + ", which isn't in The Scheduling Zoo, to the map."
      : draft.reason;
  }

  function enableDesignerSearch() {
    const view = els.viewDesign, input = view.querySelector(".story-search");
    const results = view.querySelector(".story-results");
    designerDropdowns = [
      wireMsDropdown("designer-ms-machine-env", view, "Machine Environment", (selection) => { designerFilterState.machineEnv = selection; refreshDesignerResults(); }, (node) => node.machineEnv || ""),
      wireMsDropdown("designer-ms-objective", view, "Objective", (selection) => { designerFilterState.objective = selection; refreshDesignerResults(); }, (node) => canonicalSzObjective(node.objective)),
      wireSzSettingsDropdown("designer-settings", view, (selection) => { designerFilterState.settings = selection; refreshDesignerResults(); }),
    ];
    input.addEventListener("input", () => { storySearchText = input.value; refreshDesignerResults(); });
    view.querySelector("#designer-add-problem").addEventListener("click", addDesignerDraft);
    view.querySelector("#designer-reset-filters").addEventListener("click", () => {
      storySearchText = "";
      designerFilterState = {
        machineEnv: { include: new Set(), exclude: new Set() },
        objective: { include: new Set(), exclude: new Set() },
        settings: { groups: [], values: {} },
      };
      renderDesign();
    });
    // Delegated, so redrawing the panel's contents needs no rewiring.
    results.addEventListener("click", (event) => {
      if (event.target.closest("[data-designer-draft]")) { addDesignerDraft(); return; }
      const item = event.target.closest("[data-story-problem]");
      if (item) addStoryProblem(item.dataset.storyProblem);
    });
    results.addEventListener("dragstart", (event) => {
      const item = event.target.closest("[data-story-problem], [data-designer-draft]");
      if (item) event.dataTransfer.setData("text/plain", item.dataset.storyProblem || "designer-draft-preview");
    });
    results.addEventListener("dragover", (event) => event.preventDefault());
    const wrap = view.querySelector(".map-canvas-wrap");
    wrap.addEventListener("dragover", (event) => { event.preventDefault(); wrap.classList.add("drop-target"); });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("drop-target"));
    wrap.addEventListener("drop", (event) => { event.preventDefault(); wrap.classList.remove("drop-target"); const id = event.dataTransfer.getData("text/plain"); if (id === "designer-draft-preview") { addDesignerDraft(); return; } const rect = wrap.querySelector(".map-canvas").getBoundingClientRect(); addStoryProblem(id, { left: Math.max(10, event.clientX - rect.left - 75), top: Math.max(10, event.clientY - rect.top - 22) }); });
    refreshDesignerResults();
  }

  function enableStoryDesigner() {
    const root = els.viewDesign.querySelector(".story-designer");
    if (!root) return;
    const input = root.querySelector(".story-search");
    input.addEventListener("input", () => {
      storySearchText = input.value;
      renderDesign();
      const nextInput = els.viewDesign.querySelector(".story-search");
      nextInput.focus();
      nextInput.setSelectionRange(storySearchText.length, storySearchText.length);
    });
    root.querySelectorAll("[data-story-problem]").forEach((item) => {
      item.addEventListener("click", () => addStoryProblem(item.dataset.storyProblem));
      item.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", item.dataset.storyProblem));
    });
    root.querySelectorAll("[data-story-node]").forEach((node) => {
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        storyDrag = { id: node.dataset.storyNode, startX: event.clientX, startY: event.clientY, left: storyPositions[node.dataset.storyNode].left, top: storyPositions[node.dataset.storyNode].top, moved: false };
      });
    });
    const dropzone = root.querySelector("[data-story-dropzone]");
    dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("drop-target"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drop-target"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("drop-target");
      const canvas = dropzone.querySelector(".story-canvas");
      const rect = canvas.getBoundingClientRect();
      addStoryProblem(event.dataTransfer.getData("text/plain"), { left: Math.max(10, event.clientX - rect.left - 110), top: Math.max(10, event.clientY - rect.top - 32) });
    });
    const clear = root.querySelector("#story-clear");
    if (clear) clear.addEventListener("click", () => { storyProblemIds = []; storyPositions = {}; renderDesign(); });
    if (!window.storyDesignerDragReady) {
      window.storyDesignerDragReady = true;
      document.addEventListener("pointermove", (event) => {
        if (!storyDrag) return;
        const dx = event.clientX - storyDrag.startX, dy = event.clientY - storyDrag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) storyDrag.moved = true;
        if (storyDrag.moved) {
          const position = { left: Math.max(10, storyDrag.left + dx), top: Math.max(10, storyDrag.top + dy) };
          storyPositions[storyDrag.id] = position;
          const node = els.viewDesign.querySelector('[data-story-node="' + cssEscape(storyDrag.id) + '"]');
          if (node) { node.style.left = position.left + "px"; node.style.top = position.top + "px"; }
        }
      });
      document.addEventListener("pointerup", () => {
        if (storyDrag && storyDrag.moved) renderDesign();
        storyDrag = null;
      });
    }
  }

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
    if (!DATA_SZ) {
      els.viewDesign.innerHTML = '<div class="design-page"><h2 class="page-title">Problem Map Designer</h2><p class="design-intro">Loading Scheduling Zoo problems…</p></div>';
      loadSzData().then(() => {
        if (!SZ_EFFECTIVE) SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges);
        renderDesign();
      });
      return;
    }
    if (!SZ_EFFECTIVE) SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges);
    const dropdownUi = captureDropdownUi(els.viewDesign);
    els.viewDesign.innerHTML = '<div class="design-page"><h2 class="page-title">Problem Map Designer</h2>' + designerMapBarHtml() + renderDesignerMap() + designerRelationControls() + renderDesignerSearch() + '</div>';
    enableDesignerMapBar();
    enableDesignerMap();
    enableDesignerRelations();
    enableDesignerSearch();
    restoreDropdownUi(els.viewDesign, dropdownUi);
    return;

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
      '<h2 class="page-title">Problem Map Designer</h2>' +
      renderStoryDesigner() +
      '<h3 class="design-subheading">Restriction explorer</h3>' +
      '<p class="design-intro">Explore a restriction lattice by adding or removing dimensions. Every option you click adds a new node to this graph instead of replacing the current one; this only shows results inherited from problems already in the dataset.</p>' +
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

    enableStoryDesigner();
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

  function mapUpdateHistoryButtons(mapId, viewEl) {
    viewEl = viewEl || els.viewMap;
    const undoBtn = viewEl.querySelector(".map-undo-btn");
    const redoBtn = viewEl.querySelector(".map-redo-btn");
    const resetBtn = viewEl.querySelector(".map-reset-hidden-btn");
    if (undoBtn) undoBtn.disabled = !(MAP_HIDDEN_STACK[mapId] || []).length;
    if (redoBtn) redoBtn.disabled = !(MAP_HIDDEN_REDO_STACK[mapId] || []).length;
    const hidden = MAP_HIDDEN_IDS[mapId];
    if (resetBtn) resetBtn.disabled = !(hidden && hidden.size);
  }

  function mapUndoHide(mapId, viewEl) {
    viewEl = viewEl || els.viewMap;
    const stack = MAP_HIDDEN_STACK[mapId];
    if (!stack || !stack.length) return;
    const problemId = stack.pop();
    if (MAP_HIDDEN_IDS[mapId]) MAP_HIDDEN_IDS[mapId].delete(problemId);
    (MAP_HIDDEN_REDO_STACK[mapId] || (MAP_HIDDEN_REDO_STACK[mapId] = [])).push(problemId);
    setMapNodeHidden(viewEl.querySelector(".map-canvas"), problemId, false);
    mapUpdateHistoryButtons(mapId, viewEl);
  }

  function mapRedoHide(mapId, viewEl) {
    viewEl = viewEl || els.viewMap;
    const redoStack = MAP_HIDDEN_REDO_STACK[mapId];
    if (!redoStack || !redoStack.length) return;
    const problemId = redoStack.pop();
    (MAP_HIDDEN_IDS[mapId] || (MAP_HIDDEN_IDS[mapId] = new Set())).add(problemId);
    (MAP_HIDDEN_STACK[mapId] || (MAP_HIDDEN_STACK[mapId] = [])).push(problemId);
    setMapNodeHidden(viewEl.querySelector(".map-canvas"), problemId, true);
    mapUpdateHistoryButtons(mapId, viewEl);
  }

  // Restores every node hidden on this map at once, in place (same as
  // undo/redo -- no re-render, so nothing else's position moves) -- unlike
  // repeatedly clicking Undo, this also clears the redo stack, matching
  // what "Reset" implies (start over, not "keep stepping back").
  function mapResetHidden(mapId, viewEl) {
    viewEl = viewEl || els.viewMap;
    const stack = MAP_HIDDEN_STACK[mapId];
    if (!stack || !stack.length) return;
    const canvas = viewEl.querySelector(".map-canvas");
    stack.forEach((problemId) => setMapNodeHidden(canvas, problemId, false));
    delete MAP_HIDDEN_IDS[mapId];
    MAP_HIDDEN_STACK[mapId] = [];
    MAP_HIDDEN_REDO_STACK[mapId] = [];
    mapUpdateHistoryButtons(mapId, viewEl);
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
    // The wrap is border-box, so its height has to cover its own padding
    // and border as well as the scaled canvas -- leaving them out cut the
    // bottom ~50px of the diagram off.
    const verticalChrome =
      parseFloat(wrapCs.paddingTop) + parseFloat(wrapCs.paddingBottom) +
      parseFloat(wrapCs.borderTopWidth) + parseFloat(wrapCs.borderBottomWidth);
    const budget = viewEl.clientWidth - chrome;
    const scale = budget > 0 ? Math.min(1, budget / naturalWidth) : 1;
    canvas.dataset.scale = scale;
    if (scale < 1) {
      canvas.style.transformOrigin = "top left";
      canvas.style.transform = "scale(" + scale + ")";
      wrap.style.height = naturalHeight * scale + verticalChrome + "px";
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

  // One set of document-level drag listeners per map: re-rendering a map
  // (the designer does on every change) replaces them instead of piling up.
  const MAP_DRAG_LISTENERS = {};
  // `dragDisabled`, when given and true, makes a press a plain click -- the
  // designer uses it while picking the ends of a new arrow.
  function enableMapNodeDragging(canvas, nodeW, nodeH, mapId, viewEl, onSelect, dragDisabled) {
    viewEl = viewEl || els.viewMap;
    if (!canvas) return;
    if (MAP_DRAG_LISTENERS[mapId]) MAP_DRAG_LISTENERS[mapId].abort();
    const listeners = new AbortController();
    MAP_DRAG_LISTENERS[mapId] = listeners;
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
        if (dragDisabled && dragDisabled()) return;
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
        if (onSelect) onSelect(el.dataset.problemId);
        else openProblemPanel(el.dataset.problemId);
      });
    });

    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      // The canvas may be visually shrunk (see fitMapCanvasToWidth) via a
      // CSS transform -- divide screen-pixel deltas by that scale so a node
      // still tracks the cursor 1:1 instead of moving in canvas-space px.
      const scale = parseFloat(canvas.dataset.scale) || 1;
      const dx = (e.clientX - drag.startX) / scale, dy = (e.clientY - drag.startY) / scale;
      // Measured in screen pixels, not canvas units: on a map shrunk to fit,
      // 3 canvas units is about 1 screen pixel, so the wobble of an ordinary
      // click counted as a drag and the click was swallowed.
      if (Math.abs(e.clientX - drag.startX) > 5 || Math.abs(e.clientY - drag.startY) > 5) drag.moved = true;
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
    }, { signal: listeners.signal });

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
        mapUpdateHistoryButtons(mapId, viewEl);
        drag.el.classList.remove("delete-armed");
        drag = null;
        return;
      }
      if (drag && drag.moved && mapId === DESIGNER_MAP_ID) {
        storyPositions[drag.id] = { left: parseFloat(drag.el.style.left), top: parseFloat(drag.el.style.top) };
      }
      // Cleared on the next tick, after the browser's own click event (which
      // fires right after pointerup) has had a chance to read drag.moved.
      setTimeout(() => { drag = null; }, 0);
    }, { signal: listeners.signal });
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
      // Measured in screen pixels, not canvas units: on a map shrunk to fit,
      // 3 canvas units is about 1 screen pixel, so the wobble of an ordinary
      // click counted as a drag and the click was swallowed.
      if (Math.abs(e.clientX - drag.startX) > 5 || Math.abs(e.clientY - drag.startY) > 5) drag.moved = true;
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

})();
