(function () {
  "use strict";

  let DATA = null;

  const els = {
    detailPanel: document.getElementById("detail-panel"),
    detailContent: document.getElementById("detail-content"),
    detailClose: document.getElementById("detail-close"),
    detailOverlay: document.getElementById("detail-overlay"),
    detailMinimize: document.getElementById("detail-minimize"),
    detailDock: document.getElementById("detail-dock"),
    detailDockRestore: document.getElementById("detail-dock-restore"),
    detailDockClose: document.getElementById("detail-dock-close"),
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
  let SZ_EFFECTIVE = null; // lazily computed once DATA_SZ is loaded -- see computeEffectiveClassesForSz, and szEffectiveClasses() below
  let SZ_EFFECTIVE_CORPUS = null; // the same, with the reader's own claims left out
  // Problems whose class moved only because of a claim -- not claimed
  // themselves, but downstream (or upstream) of one that was.
  let SZ_USER_AFFECTED = new Set();
  let SZ_FOCUS_IDS = null; // Set of ids to restrict the overview to (declutter), or null for the full graph
  // The overview's "lens": null, "params" or "approx". A lens does not
  // filter -- every node stays where it is -- it lights up the nodes that
  // carry that kind of result and dims the rest, so a reader can see at a
  // glance where their speciality has and has not been applied. Kept
  // across re-renders like the filters, and applied without one (see
  // szApplyLens), since it only toggles classes.
  let SZ_LENS = null;
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
  // Nodes picked out with shift-click, to drag (or drag out) as a group.
  // Cleared whenever the map is re-rendered, since the elements it names
  // are replaced.
  let SZ_SELECTED_IDS = new Set();
  // While the reader is drawing an arrow by hand on the overview:
  // { from: id or null }, null when not drawing. Cleared by a re-render.
  let SZ_ARROW_MODE = null;
  // The same two-click gesture inside a problem panel's parameter diagram:
  // { nodeId, notation, from: label | null } while an arrow is being drawn.
  let SZ_PT_ARROW = null;
  let SZ_ARROW_NOTICE = ""; // one line about the arrow last added or edited
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

  // True only for the first route() of a page load. A reload of an unsaved
  // #/design/new gets its work back; clicking through to a new map from
  // inside the running page is a request for a blank one.
  let ROUTED_ONCE = false;

  function route() {
    const freshLoad = !ROUTED_ONCE;
    ROUTED_ONCE = true;
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
      els.viewDesign.innerHTML = '<div class="design-page"><a class="wiki-back" href="#/zoo-maps">&larr; Back to problem maps</a><h2 class="page-title">Problem Map Designer</h2><p class="design-intro">Loading…</p></div>';
      loadSzData().then(() => { openDesignerMap(mapId, { resume: freshLoad }); renderDesign(); });
      // The designer is part of the Problem Maps section rather than a
      // section of its own, so that is the nav item that lights up.
      matched = "/zoo-maps";
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
      matched = path === "/design" ? "/zoo-maps" : path;
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
  // The background a class paints with. An "inset" fill (the upper-bound-
  // only classes: at most pseudo-polynomial, at most XP) is the colour in
  // the middle inside a band of the surrounding background, `ring` px wide
  // -- an algorithm in the middle, the open question around it. Two
  // background layers, no gradient: the colour as a rectangle shrunk by the
  // band on every side, over the background.
  function classBg(cls, fallback, ring) {
    if (!cls || !cls.fill) return fallback;
    if (cls.fill === "inset") {
      const t = 2 * (ring || 3) + "px";
      return "linear-gradient(" + cls.color + ", " + cls.color + ") center / calc(100% - " + t + ") calc(100% - " + t + ") no-repeat, " + fallback;
    }
    return cls.color;
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
      ? "background:" + (cls.fill ? classBg(cls, "transparent", 3) : cls.color) + ";color:" + fillTextColor(cls) + ";border:" + border
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
  const SZ_MACHINE_ENV_ORDER = ["1", "P", "Q", "R", "O", "F", "FF(1,m)", "J"];

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

  // What the two lenses look for, in two tiers. "own": the problem has a
  // result of that kind cited on it. "implied": none of its own, but one
  // reaches it along the arrows -- hardness and inapproximability up from a
  // special case, algorithms down from a generalization (inheritedParams /
  // inheritedApprox, computed in convert_for_pzoo.py along the
  // parameter-safe arrows only). "Parameterized" is any bracketed result;
  // "Approximation" is any classical line the Approximation category's own
  // patterns recognise (see SZ_RESULT_CATEGORIES) -- the same reading the
  // documentation's result table is built from, so the two can never
  // disagree about what counts.
  function szNodeParamsTier(n) {
    if ((n.params || []).length) return "own";
    if ((n.inheritedParams || []).length) return "implied";
    return null;
  }
  // Approximable means an algorithm exists: a POSITIVE approximation result
  // (a scheme, a ratio achieved). An inapproximability bound alone -- F||Cmax
  // with its "ratio ≥ 5/4" and nothing else -- does not make a problem
  // approximable, so it does not light; the bound still shows in the panel
  // and still travels up the arrows.
  function szNodeApproxTier(n) {
    // An online problem's ratio is a competitive ratio -- the same instances
    // with less information, measured against the offline optimum -- not an
    // approximation ratio under P != NP, whatever a citation happens to
    // call it. Different axis, so never lit here.
    if (n.classicalClass === "online") return null;
    const cat = SZ_RESULT_CATEGORIES.find((c) => c.name === "Approximation");
    const isApprox = (r) => r.kind === "upper" && cat.values.some((v) => v.re.test(r.bound || ""));
    if ((n.classical || []).some(isApprox)) return "own";
    if ((n.inheritedApprox || []).some((r) => r.kind === "upper")) return "implied";
    return null;
  }
  function szNodeHasParams(n) { return szNodeParamsTier(n) !== null; }
  function szNodeHasApprox(n) { return szNodeApproxTier(n) !== null; }
  // "104 +37": cited, then reached along the arrows.
  function szLensCountHtml(nodes, tierOf) {
    const own = nodes.filter((n) => tierOf(n) === "own").length;
    const implied = nodes.filter((n) => tierOf(n) === "implied").length;
    return '<span class="sz-lens-count">' + own + (implied ? ' <span class="sz-lens-implied">+' + implied + "</span>" : "") + "</span>";
  }
  // Applies SZ_LENS to the rendered overview in place: a data attribute on
  // the diagram does the lighting and dimming through CSS, and the two
  // buttons show which lens is on. No re-render, so nothing the reader has
  // dragged or hidden moves.
  function szApplyLens() {
    const diagram = els.viewSchedulingZoo.querySelector(".map-diagram");
    if (!diagram) return;
    // The diagram, and the problem panel if one is open (it may be: the
    // lens buttons stay reachable behind it).
    [diagram, els.detailContent.querySelector(".sz-panel")].forEach((el) => {
      if (!el) return;
      if (SZ_LENS) el.setAttribute("data-lens", SZ_LENS);
      else el.removeAttribute("data-lens");
    });
    diagram.querySelectorAll(".sz-lens-btn").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.lens === SZ_LENS ? "true" : "false");
    });
  }
  function szNotationOf(id) {
    const n = DATA_SZ.nodes.find((x) => x.id === id);
    return n ? n.notation : id;
  }

  function szCitationHtml(r) {
    // A result carried here from another parameter of the same problem
    // (szParamDerivedResults): say what brought it, then the line as it is
    // for the parameter it was stated for.
    if (r.carriedBy) {
      const hard = PARAM_HARDNESS.includes(r.complexityClass);
      const lead = r.carriedBy.kind === "arrow"
        ? "<b>Along your arrow</b> " + escapeHtml(r.carriedBy.from + " → " + r.carriedBy.to) + ": "
        : "<b>By containment</b>: ";
      const why = hard
        ? "hardness for " + escapeHtml(r.derivedFrom) + " holds for " + escapeHtml(r.param) +
          (r.carriedBy.kind === "arrow" ? "" : ", which bounds less")
        : "an algorithm for " + escapeHtml(r.derivedFrom) + " holds for " + escapeHtml(r.param) +
          (r.carriedBy.kind === "arrow" ? "" : ", which bounds more");
      return "<p style='margin:0 0 0.2rem'>" + lead + why + ".</p>" +
        szCitationHtml(Object.assign({}, r, { carriedBy: null, param: r.derivedFrom }));
    }
    // Two directions: hardness (and inapproximability) comes UP from a
    // special case, algorithms (FPT, XP, approximation) come DOWN from a
    // more general problem -- see the inheritance passes in
    // convert_for_pzoo.py. A parameterized result names its parameter; an
    // approximation one has none, and its arrows are the ones that keep the
    // objective value identical.
    if (r.inheritedFrom) {
      const down = r.direction === "down";
      // "X, which is FPT for m" -- but a bound that opens with a condition
      // ("under ETH there is no PTAS ...") needs "for which".
      const which = /^(is|has|can|admits|cannot|does)\b/i.test(r.bound || "") ? ", which " : ", for which ";
      return "<p style='margin:0 0 0.2rem'><b>Inherited</b> from " + (down ? "the more general " : "its special case ") +
        escapeHtml(szNotationOf(r.inheritedFrom)) + which + escapeHtml(r.bound) +
        (r.param ? " for " + escapeHtml(r.param) : "") + ".</p>" +
        "<p style='margin:0 0 0.2rem;color:var(--muted);font-size:0.85rem'>Along " +
        escapeHtml(r.via.map(szNotationOf).join(" → ")) + ": " +
        (r.param ? "every arrow keeps " + escapeHtml(r.param) + " bounded" : "every arrow keeps the objective value as it is") +
        ".</p>" +
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
    szEffectiveClasses();
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
      szAllParams(n).concat(szParamDerivedResults(szAllParams(n))).forEach((r) => {
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
      (c.opacity ? mixWithPanelBg(c.color, c.opacity) : classBg(c, "transparent", 2)) +
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
                const inP = szEffectiveClasses()[n.id] === "P";
                const best = inP ? "FPT" : bestParamComplexityClass(rs);
                const pc = best ? classById(best) : null;
                // • when the class shown comes only from an inherited result
                const inheritedOnly = !!best && bestParamComplexityClass(rs.filter((r) => !r.inheritedFrom)) !== best;
                return '<td class="result-cell"><button type="button" class="badge" data-sz-id="' + escapeHtml(n.id) +
                  '" data-param="' + escapeHtml(l) + '" style="' +
                  (pc ? classPillStyle(pc, !inP && szParamAlsoXp(rs) ? { xpBound: true } : null) : "background:transparent;color:var(--muted);border:2px dashed #868e96") +
                  '" title="' + escapeHtml(rs.length + " cited result" + (rs.length === 1 ? "" : "s") + " -- click for details") +
                  // The title alone would become the accessible name, which
                  // never says the class the cell is showing.
                  '" aria-label="' + escapeHtml((pc ? pc.label : "Unclassified result") + (!inP && szParamAlsoXp(rs) ? " and in XP" : "") + " for " + l + ", " +
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
    const rs = szAllParams(n).concat(szParamDerivedResults(szAllParams(n))).filter((r) => canonicalParamLabel(r.param) === label);
    const best = szEffectiveClasses()[n.id] === "P" ? "FPT" : bestParamComplexityClass(rs);
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
      classBg(cc, "var(--panel-bg)") +
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
    // .detail-panel side padding (1.1rem*2=35px) + .param-tree-wrap's own
    // padding (0.5rem*2=16px) + its 1px border on each side, so the SVG
    // never needs its own horizontal scrollbar inside the widened panel.
    const PANEL_PADDING = 36 + 16 + 4;
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
    els.detailDock.hidden = true;
  }
  // Minimize: the panel folds into a small tab at the bottom right that
  // names the problem, so the map is usable again and the problem is one
  // click away. The panel's content is kept as it is (scroll position,
  // open cards). Opening any panel -- this one again, or another problem
  // -- takes the tab away; that is watched on the panel's hidden attribute
  // so no opener needs to know about the tab.
  function minimizeDetail() {
    const heading = els.detailContent.querySelector("h1, h2, h3");
    els.detailDockRestore.textContent = heading ? heading.textContent.trim() : "Problem";
    els.detailPanel.hidden = true;
    els.detailOverlay.hidden = true;
    els.detailDock.hidden = false;
  }
  function restoreDetail() {
    els.detailDock.hidden = true;
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
  }
  new MutationObserver(() => { if (!els.detailPanel.hidden) els.detailDock.hidden = true; })
    .observe(els.detailPanel, { attributes: true, attributeFilter: ["hidden"] });
  els.detailClose.addEventListener("click", closeDetail);
  els.detailMinimize.addEventListener("click", minimizeDetail);
  els.detailDockRestore.addEventListener("click", restoreDetail);
  els.detailDockClose.addEventListener("click", closeDetail);
  els.detailOverlay.addEventListener("click", minimizeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.detailPanel.hidden) minimizeDetail();
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
  // What the corpus's result statements actually SAY, grouped and counted
  // from the data rather than listed by hand: The Scheduling Zoo has no
  // result taxonomy to read off (see szResultKindsHtml), so the only honest
  // way to describe what is in there is to measure it, and to keep
  // measuring it as the corpus grows.
  //
  // Two levels: a category (what the statement is a claim ABOUT), and,
  // inside it, the vocabulary -- the phrasings that actually occur, each
  // with what this site makes of it. `scope` says which half of the corpus
  // a category is counted over: "classical" for statements about a problem
  // (no bracket), "parameterized" for statements about a problem-and-
  // parameter pair (written X [k]), "any" for the categories that occur in
  // both. Within a category the values are meant to be exhaustive, so a
  // statement matching none of them is counted as "other wording" rather
  // than quietly dropped.
  const SZ_RESULT_CATEGORIES = [
    {
      name: "Classical complexity",
      scope: "classical",
      about: "the problem on its own",
      becomes: "the problem's class, and so its colour on every map",
      lead: "These are the only statements that decide a problem's colour. Two of them together say more than " +
        "either alone: NP-hard with a pseudo-polynomial algorithm is weakly NP-hard, NP-hard without one leaves " +
        "the weak/strong question open, and a problem with none of these phrases is open.",
      otherMeans: "not a claim about classical complexity at all -- the approximation, competitive-ratio and " +
        "other results in the groups below, which are cited on a problem without settling its class",
      values: [
        { label: "is in P", re: /^is (in )?P\b(?!seudo)/, means: "P" },
        { label: "is solvable in <running time>", re: /\b(is |can be )?(solved|solvable) (in|by)\b[^.]*(O\(|polynomial time\b)/i,
          means: "P — an exact algorithm with a stated polynomial running time is the same claim, phrased differently" },
        { label: "is in Ppseudo", re: /^is (in )?Ppseudo\b/, means: "pseudo-polynomial; with an NP-hardness result, weakly NP-hard" },
        { label: "is NP-hard / is NP-complete", re: /\bis\s+NP-(hard|complete)\b/i, means: "NP-hard, pseudo-poly open, unless a Ppseudo result makes it weakly NP-hard" },
        { label: "is strongly NP-hard", re: /strongly NP-(hard|complete)/i, means: "strongly NP-hard — the strongest, and it wins over everything else cited" },
      ],
    },
    {
      name: "Parameterized complexity",
      scope: "parameterized",
      about: "a PAIR: one problem together with one set of parameters, written X [k] or X [k1;k2]",
      becomes: "the class of that parameter's row in the problem's panel — never the problem's own colour",
      lead: "Every statement here is about a pair. The same problem can be FPT in one parameter and W[1]-hard in " +
        "another, so none of these says anything about the problem alone: 1|rj|ΣwjUj is FPT in #p+#d+#r and " +
        "W[1]-hard in #p, both at once. The parameters are the measures bounded together — m machines, pmax the " +
        "largest processing time, #p distinct processing times, #d due dates, #r release dates, pw(I) pathwidth.",
      values: [
        { label: "is fixed parameter tractable", re: /fixed parameter tractable|\bFPT\b/i, means: "FPT" },
        { label: "is in P", re: /^is (in )?P\b(?!seudo)/, means: "XP — polynomial for each fixed value of the parameter, which is not FPT" },
        { label: "is in Ppseudo", re: /^is (in )?Ppseudo\b/, means: "XP, same reading" },
        { label: "is W[1]-hard / is W[2]-hard", re: /W\[\d/, means: "W[1]- or W[2]-hard (also written \"strongly W[1]-hard\", or \"W[1]-hard even if #w=1\")" },
        { label: "is NP-hard, is para-NP-complete, or \"does not admit a fixed parameter algorithm unless FPT=para-NP\"",
          re: /para-?NP|\bis\s+NP-(hard|complete)\b|strongly NP-hard/i, means: "para-NP-hard — hard even for a constant value of the parameter" },
      ],
      otherMeans: "stated for the pair, but not in the parameterized vocabulary -- an ETH running-time bound or " +
        "an approximation result about it, shown as text",
    },
    {
      name: "Approximation",
      scope: "any",
      about: "the problem",
      becomes: "text under the problem's results — it is a real result, but not a claim about which class the problem is in",
      lead: "Both directions occur: what can be achieved, and what cannot be (under P ≠ NP).",
      values: [
        { label: "has a PTAS / EPTAS / FPTAS", re: /PTAS/, means: "an approximation scheme" },
        { label: "has a polynomial-time r-approximation", re: /(polynomial[- ]time|has an?)[^.]*\bapproximation\b/i, means: "a ratio achieved, sometimes with the method named (LP rounding, α-points)" },
        { label: "approximation ratio ≤ r / ≥ r, deterministic or randomized", re: /approximation ratio/i, means: "a bound on the best ratio, stated either way" },
        { label: "is APX-hard", re: /APX-hard/i, means: "no PTAS unless P = NP" },
        { label: "cannot be approximated below ratio r unless P=NP", re: /cannot be approximated|inapprox/i, means: "an explicit inapproximability threshold" },
        { label: "there is no r-approximation in time … under ETH", re: /\bno\b[^.]*\bapproximation\b/i, means: "a lower bound on the running time of any approximation, conditional on ETH" },
      ],
    },
    {
      name: "Online algorithms, competitive ratio",
      scope: "any",
      about: "the problem — but only where the release-time field is online-rj, which makes it an online problem",
      becomes: "text under the problem's results",
      lead: "An online problem's jobs are revealed at their release times, so the question is not running time but " +
        "how far from optimal an algorithm must be. Bounds come in both directions and in both models, and some " +
        "results buy performance with extra speed rather than with a better ratio.",
      values: [
        { label: "has competitive ratio at most c", re: /competitive ratio (at most|≤)/i, means: "an algorithm achieving c" },
        { label: "competitive ratio at least c / ≥ c", re: /competitive ratio (at least|≥|ge)/i, means: "no algorithm can do better than c" },
        { label: "deterministic … / randomized …", re: /(deterministic|randomized)[^.]*competitive/i, means: "the two models are stated separately; randomization usually helps" },
        { label: "is c-competitive", re: /\bis [^.]*-competitive|competitive algorithm/i, means: "the same claim written around a named algorithm" },
        { label: "(1+ε)-speed, O(1/ε)-competitive", re: /speed/i, means: "resource augmentation: the same ratio bought with faster machines" },
      ],
    },
    {
      name: "Conditional lower bounds",
      scope: "any",
      about: "the problem, or a problem-and-parameter pair",
      becomes: "text under the problem's results",
      lead: "Lower bounds that hold under a stronger assumption than P ≠ NP, which is what makes them able to rule " +
        "out a specific running time rather than just polynomial time. Every one of them in this corpus is " +
        "stated under ETH; none uses SETH.",
      values: [
        { label: "has no 2^o(n)·T^o(m)-time algorithm (under ETH)", re: /\bETH\b|exponential time hypothesis/i, means: "a running-time lower bound under the Exponential Time Hypothesis" },
        { label: "no PTAS in time … under ETH", re: /(ETH|exponential time hypothesis)[^.]*(PTAS|approximation)|(PTAS|approximation)[^.]*(ETH|exponential time hypothesis)/i, means: "the same idea applied to approximation schemes" },
        // SETH is the other assumption results like these are usually
        // stated under; nothing in this corpus uses it, so the row only
        // appears if something ever does.
        { label: "… under SETH", re: /SETH/, means: "the Strong Exponential Time Hypothesis" },
      ],
    },
    {
      name: "Practical solvers",
      scope: "any",
      about: "the problem",
      becomes: "text under the problem's results",
      lead: "Not complexity claims at all: what has been made to work on real instances. They are kept because they " +
        "are what the literature says about problems where the theory stops at \"strongly NP-hard\".",
      values: [
        { label: "can be solved by a branch-and-bound algorithm", re: /branch-and-bound/i, means: "exact, exponential in the worst case" },
        { label: "column generation / arc-flow", re: /column generation|arc-flow/i, means: "exact mathematical-programming approaches" },
        { label: "particle swarm, ant colony, …", re: /swarm|ant.colony|genetic|tabu|heuristic/i, means: "metaheuristics — no guarantee claimed" },
      ],
    },
    {
      name: "Other remarks",
      scope: "any",
      about: "the problem, or the literature about it",
      becomes: "text under the problem's results",
      lead: "The long tail: everything the corpus says that is none of the above.",
      values: [
        { label: "… has integrality gap ≥ g", re: /integrality gap/i, means: "how far a relaxation can be from the truth" },
        { label: "proof of […] has a bug", re: /has a bug|is wrong|flaw/i, means: "an editorial note on a cited result, not a result" },
      ],
    },
  ];

  // Every result statement in the corpus, split the way the categories are
  // scoped: a bracket result (n.params) is about a problem-and-parameter
  // pair, everything else (n.classical) about the problem itself.
  function szResultStatements(scope) {
    if (!DATA_SZ) return [];
    const out = [];
    DATA_SZ.nodes.forEach((n) => {
      if (scope !== "parameterized") (n.classical || []).forEach((r) => out.push(r.bound || ""));
      if (scope !== "classical") (n.params || []).forEach((r) => out.push(r.bound || ""));
    });
    return out;
  }

  function szResultKindsHtml() {
    const total = szResultStatements("any").length;
    const section = (cat) => {
      const statements = szResultStatements(cat.scope);
      // A phrasing the corpus never actually uses is left out: this is a
      // description of what is in the data, not of what could be.
      const rows = cat.values.map((v) => ({ v: v, hits: statements.filter((s) => v.re.test(s)) }))
        .filter((r) => !total || r.hits.length);
      // Anything inside this category's scope that none of its values
      // matched, so the table can never quietly under-report. For the two
      // scoped categories that is meaningful (every bracket statement is a
      // parameterized result); for the rest the scope is the whole corpus,
      // so it isn't, and it is left out.
      const claimed = statements.filter((s) => cat.values.some((v) => v.re.test(s)));
      const unmatched = cat.scope === "any" ? 0 : statements.length - claimed.length;
      return "<h5>" + escapeHtml(cat.name) + "</h5>" +
        '<p class="docs-result-about"><b>About:</b> ' + escapeHtml(cat.about) + ". <b>Becomes:</b> " +
        escapeHtml(cat.becomes) + ".</p>" +
        "<p>" + escapeHtml(cat.lead) + "</p>" +
        '<div class="docs-table-wrap"><table class="docs-table">' +
        "<thead><tr><th>Written as</th>" + (total ? "<th>Statements</th>" : "") +
        "<th>What this site makes of it</th></tr></thead><tbody>" +
        rows.map((r) =>
          "<tr><td><code>" + escapeHtml(r.v.label) + "</code></td>" +
          (total ? "<td>" + r.hits.length + "</td>" : "") +
          "<td>" + escapeHtml(r.v.means) + "</td></tr>").join("") +
        (unmatched
          ? "<tr><td><i>other wording</i></td>" + (total ? "<td>" + unmatched + "</td>" : "") +
            "<td>" + escapeHtml(cat.otherMeans || "none of the above matched — left unclassified rather than guessed at") + "</td></tr>"
          : "") +
        "</tbody></table></div>";
    };
    return "<h4>What kinds of result the corpus contains</h4>" +
      "<p>The Scheduling Zoo has <mark><b>no result taxonomy</b></mark>. A result is a line of free text in a BibTeX " +
      "annotation -- <code>$1|online-rj;restarts|ΣCj$ has a deterministic 3/2-competitive algorithm</code> -- " +
      "and the only distinction its parser draws is <b>positive or negative</b>, decided by scanning the " +
      "sentence for <code>NP</code>, <code>hard</code>, <code>&gt;=</code>, <code>\\geq</code>, <code>no</code>, " +
      "<code>cannot</code> or <code>ETH</code>. Everything past that -- strongly versus weakly NP-hard, FPT " +
      "versus XP -- is this site reading the wording.</p>" +
      "<p>So the groups below are not categories The Scheduling Zoo assigns; they are what its " +
      (total ? total + " " : "") + "statements turn out to say when read and counted" +
      (total ? "" : " (open the Scheduling Zoo map once and these counts fill in from the data)") +
      ". The first two are the ones this site turns into a class; the rest it shows as the text they are. " +
      "Counts within a group can overlap, since one sentence can be two things at once -- a lower bound under " +
      "ETH on an approximation ratio is both.</p>" +
      SZ_RESULT_CATEGORIES.map(section).join("");
  }

  function renderDocs() {
    // The result-kind counts are measured from the corpus, so if it hasn't
    // been fetched yet (a cold load straight to #/docs), fetch it and draw
    // the page again -- keeping whatever section the address names.
    if (!DATA_SZ) {
      loadSzData().then(() => {
        if (els.viewDocs.hidden) return;
        renderDocs();
        const at = /^\/docs\/(.+)$/.exec(currentPath());
        const target = at && document.getElementById(decodeURIComponent(at[1]));
        if (target) target.scrollIntoView({ block: "start" });
      }).catch(() => {});
    }
    els.viewDocs.innerHTML =
      '<div class="docs-page">' +
      '<h2 class="page-title">Documentation</h2>' +
      '<p class="design-intro">How to read the graphs on this site -- what an arrow actually claims, ' +
      "and how far that claim reaches -- and how the data from The Scheduling Zoo is read and combined.</p>" +
      '<nav class="docs-toc" aria-label="Contents"></nav>' +

      '<section class="docs-section" id="docs-arrow-rules">' +
      "<h3>Arrow rule types</h3>" +

      "<p>Every arrow on this site points from a <b>general</b> problem to a <b>special case</b> of it, and " +
      "means the same thing in one direction: <mark><b>hardness flows upward</b></mark>, from the special case to the " +
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
      "Parameterized results are inherited only along arrows whose kind is known to keep the parameter " +
      "bounded -- a value restriction, or padding with constant data that doesn't feed the parameter -- and " +
      "this <b>is</b> checked, arrow by arrow, when the data is built (see Inherited results below): hardness " +
      "(W[1], W[2], para-NP) up from a special case, algorithms (FPT, XP) down from a generalization. " +
      "Approximation results travel the same arrows the same two ways. Classical P never transfers along a " +
      "parameterized arrow.</li>" +
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

      szResultKindsHtml() +

      "<h4>How results are classified</h4>" +
      "<p>The Scheduling Zoo itself only marks a result as positive or negative. This site reads the wording of " +
      "each bound instead, recognizing only its standard phrases:</p>" +
      '<ul class="docs-list">' +
      "<li><b>Classical</b> (no bracket): <code>is strongly NP-hard</code> → strongly NP-hard; " +
      "<code>is NP-hard</code> together with <code>is in Ppseudo</code> → pseudo-polynomial time solvable; " +
      "<code>is NP-hard</code> alone → NP-hard, pseudo-poly open; <code>is in P</code> or a stated polynomial " +
      "running time → P. NP-complete counts as NP-hard, hardness wins when both kinds are cited, and a problem " +
      "with none of these phrases is open.</li>" +
      "<li><b>Online</b> (<code>online-rj</code> in the release-time field): its own class, whatever the rest says. " +
      "An online problem is not on the P/NP-hard scale at all &mdash; see below.</li>" +
      "<li><b>Parameterized</b> (bracket): <code>is fixed parameter tractable</code> → FPT; " +
      "<code>is in P</code> or <code>is in Ppseudo</code> → XP, read as solvable for every fixed value of the " +
      "parameter, which does not make it FPT; <code>W[1]-hard</code> / <code>W[2]-hard</code> → W[1]- / " +
      "W[2]-hard; <code>para-NP-hard</code> or <code>is NP-hard</code> → para-NP-hard, i.e. hard even for a " +
      "constant value. Other bounds, such as ETH-based running-time lower bounds or approximation ratios, are " +
      "listed as text without a class.</li>" +
      "<li><b>Several results for one parameter.</b> The strongest is shown: para-NP-hard, then W[2]-hard, " +
      "W[1]-hard, FPT, XP.</li>" +
      "</ul>" +

      "<h4>Online problems are measured on a different axis</h4>" +
      "<p>An online problem &mdash; <code>online-rj</code> in the release-time field, 18 of them here &mdash; has its " +
      "jobs revealed at their release times. What limits an algorithm is then <mark><b>what it does not yet know, not " +
      "how long it may compute</b></mark>, and those are two different scarcities: <b>NP-hardness</b> bounds " +
      "computation while handing you the whole input, a <b>competitive ratio</b> bounds information while granting " +
      "you unlimited computation.</p>" +
      "<p>That makes a competitive ratio <b>unconditional</b>. “No deterministic algorithm beats the golden ratio " +
      "for 1|online-rj;pj=1;dj≤rj+2|ΣwjUj” is an adversary argument: it holds against an algorithm with an " +
      "NP oracle, and nothing in it turns on P ≠ NP. Which is why the corpus states these as plain numbers &mdash; " +
      "2, 3/2, 25/3, φ, Ω(√n) &mdash; rather than as conditional claims.</p>" +
      "<p>“Is it NP-hard?” still has answers for an online problem, but they are about something else: the " +
      "<i>offline</i> version can be NP-hard (usually the interesting question); the algorithm's own per-step " +
      "computation can be NP-hard, which is why the literature separates ratios achieved by polynomial-time online " +
      "algorithms from those needing unbounded computation (every algorithm cited here is efficient); and " +
      "“is there an online algorithm with ratio ≤ c” is a third question this corpus does not record. " +
      "None of those is the problem's own colour, so these 18 carry a class of their own rather than being called " +
      "open &mdash; which is what this site used to do, and it was a misstatement: several of them have a " +
      "<i>tight</i> ratio.</p>" +
      "<p>They also form an <b>island in the arrow graph</b>: The Scheduling Zoo declares no reduction between " +
      "<code>online-rj</code> and an ordinary release date, so no hardness ever flows across the divide. That is " +
      "right, and worth keeping deliberately &mdash; the same instances with less information is neither a special " +
      "case nor a generalization in the sense these arrows mean.</p>" +

      "<h4>What a parameterized result says about the classical one</h4>" +
      "<p>Two of them say something, and they say different things.</p>" +
      '<ul class="docs-list">' +
      "<li><b>para-NP-hardness settles it.</b> para-NP-hard means NP-hard already at a <i>constant</i> value of the " +
      "parameter, so the general problem contains an NP-hard special case and is itself NP-hard. Whether it is " +
      "strongly or weakly so does not follow &mdash; the hardness proof at that constant may or may not need large " +
      "numbers &mdash; so it lands as <mark>NP-hard, pseudo-poly open</mark>, which is exactly what that class is for.</li>" +
      "<li><b>W-hardness does not.</b> <mark>W[1]-hard does not imply NP-hard</mark>: W-hardness is proved by " +
      "fpt-reductions, not polynomial ones. What it does imply is that the problem is <b>not in P</b> unless " +
      "FPT = W[1], because a polynomial-time algorithm would already be an FPT algorithm for every parameter at " +
      "once (take f(k) = 1), and a W[1]-hard problem in FPT would collapse the two classes. \u201CNot in P\u201D is " +
      "weaker than \u201CNP-hard\u201D, though &mdash; a problem can be neither &mdash; so this site leaves such a " +
      "problem\u2019s class open and says so in its panel rather than promoting it. (W[2]-hardness implies " +
      "W[1]-hardness, so the same sentence covers both.)</li>" +
      "</ul>" +

      "<h4>Inherited hardness</h4>" +
      "<p><mark>A problem with no classical result of its own takes the hardness of any special case of it</mark> -- any " +
      "problem its arrows reach -- that is proven hard. Strongly NP-hard carries over as it is; " +
      "pseudo-polynomial carries over only as NP-hard, pseudo-poly open, since its algorithm need not extend to the " +
      "more general problem; P never carries over. A problem's panel says when its class is inherited. " +
      "</p>" +
      "<p>Parameterized <b>hardness</b> (W[1], W[2], para-NP) is carried too, but only along arrows known to keep " +
      "the parameter bounded. An arrow qualifies when every field it changes either reads the same instance with " +
      "a wider value (a set of chains is a precedence order, p<sub>j</sub>=1 is p<sub>j</sub>=p with p=1) or pads " +
      "it with constant data (weights 1, due dates or release dates 0, speeds 1, every machine eligible). Paddings " +
      "exclude the measures built from the padded data: release and due dates set to 0 change the windows behind " +
      "pw(I) and slack<sub>max</sub>, and unrelated machines rescale the processing times behind p<sub>max</sub> " +
      "and #p. Machine counts are carried in the shops (open, flow and job shops) only: a problem with fewer " +
      "machines is the one with more machines whose extra operations take no time, so due dates, weights and " +
      "every count keep their value, provided nothing fixes or surrounds those operations (equal or unit " +
      "processing times, setups, transport delays, a robot or server, batching, time lags). Nothing is carried " +
      "across machine counts of parallel machines, preemption, the online model, or objective changes that " +
      "only hold at one threshold. For example, P|r<sub>j</sub>;p<sub>j</sub>=p|ΣU<sub>j</sub> is W[2]-hard in " +
      "m, and weighting its jobs changes nothing about m, so P|r<sub>j</sub>;p<sub>j</sub>=p|Σw<sub>j</sub>U<sub>j</sub> " +
      "is W[2]-hard in m too. Inherited results are marked in the Search matrix and explained, with the chain of " +
      "arrows, in each problem's panel.</p>" +
      "<p>An arrow you draw yourself (→+) counts as a claim: a class carries along it -- P down to the special " +
      "case, hardness up to the general one -- through whatever is cited at the other end, and what that " +
      "overrides in the literature is reported, per problem, the way a classification's overrides are.</p>" +
      "<p>Positive results go the other way along the very same arrows: an FPT or XP algorithm for a problem is " +
      "one for every special case of it, so 1|r<sub>j</sub>|Σw<sub>j</sub>U<sub>j</sub> being FPT in #p+#d+#r " +
      "makes 1|p<sub>j</sub>=p;r<sub>j</sub>|Σw<sub>j</sub>U<sub>j</sub> FPT in it too. Approximation results " +
      "follow the same two directions -- a scheme or a ratio down to the special cases, APX-hardness or an " +
      "inapproximability bound up to the generalizations -- and only along arrows on which the objective value " +
      "is identical on every schedule, since a ratio means nothing across an objective shift. The lens on the " +
      "Scheduling Zoo map shows both tiers: a full glow for a result cited on the problem, a softer one for a " +
      "result that reaches it this way.</p>" +

      "<h4>Where this site reads the data differently</h4>" +
      "<p>Three reduction rules are <i>added</i> where The Scheduling Zoo's data has none or gates it too " +
      "tightly -- machine counts, equal or unit processing times, and eligibility sets inside unrelated " +
      "machines -- and nothing of theirs is overridden; " +
      "a doi.org prefix is stripped off seven DOIs so their links resolve. Their reduction rules themselves are " +
      "taken exactly as shipped. Each difference is explained, with its evidence, under " +
      '<a href="#/docs/docs-anomalies">Known data anomalies</a> below. The Scheduling Zoo\'s own files are ' +
      "never edited.</p>" +
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

    // A way back up from every heading the Contents lists. Added AFTER the
    // list is built, so the link's own text can't end up inside the entry
    // that names the heading. It scrolls rather than navigating: an href of
    // "#..." would be read as a route, and re-rendering the page to get
    // back to the top of it is a lot of work for a scroll.
    root.querySelectorAll(".docs-section h3, .docs-section h4").forEach((h) => {
      const back = document.createElement("a");
      back.className = "docs-back";
      back.setAttribute("role", "button");
      back.tabIndex = 0;
      back.textContent = "↑ Contents";
      back.title = "Back to the contents";
      // A plain scroll, not scrollIntoView({behavior:"smooth"}): that is
      // silently a no-op in some engines (it does nothing at all in the
      // in-app browser this was tested in), and a link that does nothing is
      // worse than one that jumps. The animation comes from CSS
      // scroll-behavior instead, where the engine supports it.
      const go = () => window.scrollTo(0, Math.max(0, toc.getBoundingClientRect().top + window.scrollY - 12));
      back.addEventListener("click", go);
      back.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      h.appendChild(back);
    });
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
      " Its source files are left exactly as-is. Two things change how we read them: two reduction rules we " +
      "<i>add</i> where their data has none or gates it too tightly -- machine counts, and equal or unit " +
      "processing times -- and a doi.org prefix stripped off seven DOIs so their links resolve. The rest are " +
      "recorded and reported, not worked around. Arrows that exist only because of a rule of ours look like " +
      "any other arrow; clicking one says which rule added it.</p>" +
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
  // Classifications the reader records themselves, for problems or single
  // parameters where this site's corpus has nothing (or where they disagree
  // with it). Kept in this browser only, like saved problem maps, and never
  // mixed into the cited data: a citation is optional here, so every one of
  // these is rendered as the reader's own unverified claim, marked as such.
  const USER_CLASS_KEY = "psz.classifications.v1";
  function loadUserClassifications() {
    try {
      const obj = JSON.parse(localStorage.getItem(USER_CLASS_KEY) || "{}");
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    } catch (e) {
      return {};
    }
  }
  function storeUserClassifications(obj) {
    try {
      localStorage.setItem(USER_CLASS_KEY, JSON.stringify(obj));
    } catch (e) {
      /* private window, or quota: the page still works, the claim just isn't kept */
    }
  }
  // `label` null for the problem's own classical class, otherwise the
  // parameter it belongs to.
  function userClassification(nodeId, label) {
    const entry = loadUserClassifications()[nodeId];
    if (!entry) return null;
    return (label === null || label === undefined ? entry.classical : (entry.params || {})[label]) || null;
  }
  function setUserClassification(nodeId, label, value) {
    const all = loadUserClassifications();
    const entry = all[nodeId] || (all[nodeId] = {});
    if (label === null || label === undefined) {
      if (value) entry.classical = value;
      else delete entry.classical;
    } else {
      const params = entry.params || (entry.params = {});
      if (value) params[label] = value;
      else delete params[label];
    }
    if (!entry.classical && !Object.keys(entry.params || {}).length) delete all[nodeId];
    storeUserClassifications(all);
    // The classical classes are cached across renders and now depend on
    // these, so they have to be recomputed -- a reader's claim travels to
    // every problem that generalizes it (and, when it is P, to every
    // problem it generalizes).
    SZ_EFFECTIVE = null;
    SZ_PARAM_CLAIMS = null;
    designerEffectiveCache = { key: null, classes: null };
  }

  // Every problem's effective classical class, WITH the reader's own
  // classifications folded in and superseding the citations. Computed on
  // demand and cached until a claim invalidates the cache above.
  //
  // Always read the classes through this, never off SZ_EFFECTIVE directly:
  // the variable is null for the whole window between a claim being made
  // and the next thing that happens to recompute it, and a caller reading
  // it raw in that window quietly falls back to each problem's own cited
  // class -- losing the inheritance AND the reader's claim. That is exactly
  // what the problem maps did: a classification made there repainted the
  // map from raw corpus classes, so nothing superseded, nothing inherited,
  // and no arrow ever turned red.
  function szEffectiveClasses() {
    if (!SZ_EFFECTIVE && DATA_SZ) {
      const affected = new Set();
      SZ_EFFECTIVE = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, false,
        { userEdges: loadSzUserEdges(), affectedOut: affected });
      SZ_USER_AFFECTED = affected;
    }
    return SZ_EFFECTIVE || {};
  }

  // Arrows the reader draws by hand on the Scheduling Zoo overview: each one
  // claims that `to` is a special case of `from`, described with the same
  // questionnaire the designer uses (see SZ_REDUCTION_KINDS). Kept in this
  // browser only, like the classifications above.
  //
  // Part of the model, like a classification: the reader's input supersedes
  // the corpus, so a class carries along a hand-drawn arrow -- P down to the
  // special case, hardness up to the general one -- through whatever is
  // cited at the other end (see computeEffectiveClassesForSz). What that
  // overrides in the literature is reported per problem, the same way a
  // classification's overrides are (szOverriddenByClaims). The designer's
  // own arrows work the same way on the map they belong to.
  const SZ_EDGE_KEY = "psz.szEdges.v1";
  let SZ_USER_EDGES = null;
  function loadSzUserEdges() {
    if (SZ_USER_EDGES) return SZ_USER_EDGES;
    try {
      const list = JSON.parse(localStorage.getItem(SZ_EDGE_KEY) || "[]");
      SZ_USER_EDGES = Array.isArray(list) ? list.filter((e) => e && e.from && e.to) : [];
    } catch (e) {
      SZ_USER_EDGES = [];
    }
    return SZ_USER_EDGES;
  }
  function storeSzUserEdges() {
    try {
      localStorage.setItem(SZ_EDGE_KEY, JSON.stringify(SZ_USER_EDGES || []));
    } catch (e) {
      /* private window, or quota: the arrow still shows, it just isn't kept */
    }
    // An arrow moves classes, so the cached ones are stale -- the same
    // invalidation a classification does.
    SZ_EFFECTIVE = null;
    SZ_PARAM_CLAIMS = null;
    designerEffectiveCache = { key: null, classes: null };
  }

  // Arrows the reader draws between PARAMETERS, in a problem panel's
  // parameter diagram: `from` is bounded by a function of `to` -- bounding
  // `to` bounds `from` -- the reading parameterHierarchy's edges have. So
  // an FPT or XP result for `from` holds for `to`, and W-hardness for `to`
  // holds for `from` (m -> m+pmax is the containment case the diagram
  // draws on its own). A statement about the two measures, not about a
  // problem, so it holds on every problem where both appear. Kept in this
  // browser, like every other claim.
  const SZ_PARAM_EDGE_KEY = "psz.paramEdges.v1";
  let SZ_PARAM_EDGES = null;
  function loadSzParamEdges() {
    if (SZ_PARAM_EDGES) return SZ_PARAM_EDGES;
    try {
      const list = JSON.parse(localStorage.getItem(SZ_PARAM_EDGE_KEY) || "[]");
      SZ_PARAM_EDGES = Array.isArray(list) ? list.filter((e) => e && e.from && e.to) : [];
    } catch (e) {
      SZ_PARAM_EDGES = [];
    }
    return SZ_PARAM_EDGES;
  }
  function storeSzParamEdges() {
    try {
      localStorage.setItem(SZ_PARAM_EDGE_KEY, JSON.stringify(SZ_PARAM_EDGES || []));
    } catch (e) {
      /* private window, or quota: the arrow still shows, it just isn't kept */
    }
    SZ_PARAM_CLAIMS = null;
    // The overview's Send / Reset bar counts these arrows, and a panel can
    // add one while the overview is on screen behind it.
    if (!els.viewSchedulingZoo.hidden) szUpdateClaimsBar();
  }

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
  // How wide one band of the diagram may get before it is cut and stacked.
  const SZ_STRIP_W = 2100;   // how wide one block may get before it is cut
  const SZ_NODE_H = 24, SZ_ROW_H = 46, SZ_MARGIN = 30, SZ_COL_GAP = 12;
  const SZ_FONT_PX = 10.5;
  const SZ_MIN_NODE_W = 60, SZ_MAX_NODE_W = 260;

  // Generalization edges in The Scheduling Zoo's own reduction graph that
  // we've spot-checked and found inconsistent with its OWN cited results,
  // and flag rather than correct: red/dashed on the map, listed at the
  // bottom of the view. Each entry's `from`/`to` are raw ids
  // (DATA_SZ.nodes[].id). Empty for now -- the only such edge,
  // P2|fixj|Cmax -> P2||Cmax, came from the fix_j rule, which The Scheduling
  // Zoo has since corrected (schedulingzoo PR #14), so it is no longer in
  // their data to draw.
  const SZ_FLAGGED_EDGES = [];
  function szFlaggedEdgeFor(from, to) {
    return SZ_FLAGGED_EDGES.find((f) => f.from === from && f.to === to);
  }

  // Shared between the green edges' click-through panel and the data note
  // below it -- one source of truth for why OUR_MACHINE_COUNT_RULES (see
  // convert_for_pzoo.py) is sound.
  const SZ_MACHINE_COUNT_RULE_NOTE =
    "The Scheduling Zoo does declare the chain m reduces to m+1 (1->2->3->4->5->arbitrary), but gated: every " +
    "one of those rules fires only when the \"bounded number of machines\", \"processing times\" AND \"preemption\" " +
    "fields are all empty at once, so it never applies to a problem with unit processing times, with equal " +
    "processing times, or with preemption -- most of the corpus. As a plain one-field rule there is none at " +
    "all (see Known data anomalies in the Documentation). So we state it ungated, layered on TOP of The " +
    "Scheduling Zoo's data, never replacing anything they declared. Sound for every objective in this corpus regardless of machine " +
    "environment: for P/Q/R, an m-machine schedule stays valid with an extra machine simply left unused; for " +
    "O/F/J (where machine count = operations per job), pad every job with one zero-duration operation on the " +
    "extra machine -- neither changes any completion time, so the optimum can only get better or stay the same " +
    "with more machines, never worse, for any regular objective (Cmax, sums of completion/tardiness/flow times, " +
    "Lmax, throughput -- all of them). Restricted to fire ONLY when machine count is the sole differing field " +
    "(never combined with any other simultaneous relaxation) -- see the next data note for why. An edge is " +
    "counted as added by this site only when it exists ONLY due to this rule -- checked against The Scheduling Zoo's own " +
    "original rules first, edge by edge, so a pair already implied by their own data is never wrongly claimed " +
    "as ours.";

  // Shared between the processing-times data note and the panel of any edge
  // that exists only because of those rules (OUR_PROCESSING_TIME_RULES in
  // convert_for_pzoo.py).
  const SZ_PROCESSING_TIME_RULE_NOTE =
    "The Scheduling Zoo's \"processing times\" field has rules BETWEEN its restrictions (pj=1 -> pj=p, " +
    "pj=1 -> pj∈{1,2}, pij=1 -> pij=p) but hardly any FROM a restriction to the unrestricted field: only the " +
    "two values that encode something else entirely (pij∈{pj,∞}, the restricted machine model, and pkj=pj) " +
    "reduce to it. So equal or unit processing times were not a special case of arbitrary ones -- Q||Cmax did " +
    "not generalize Q|pj=p|Cmax. The same kind of gap as the machine-count one above, so we fill it the same " +
    "way, in our converter only: pj=p, pj∈{1,2} and pij=p each reduce to arbitrary processing times, which by " +
    "The Scheduling Zoo's own rules also gives pj=1 and pij=1. Sound in every environment and for every " +
    "objective here, with nothing to prove: an instance whose processing times all happen to be equal IS an " +
    "instance with arbitrary processing times -- the restriction is on the input, not on what a schedule may " +
    "do. Result: 205 more relations, 90 more arrows on the map, 24 problems that had no arrow at all now " +
    "connected, and none of the new arrows puts a problem cited P above one cited NP-hard, or a " +
    "pseudo-polynomial one above a strongly NP-hard one -- the check that caught the S1 rule below.";

  // Shared between the data note below and the panel of any edge that exists
  // only because of the rule (OUR_ELIGIBILITY_RULES in convert_for_pzoo.py).
  const SZ_ELIGIBILITY_RULE_NOTE =
    "The Scheduling Zoo has the rule \"M_j;R -> ;R\" -- an unrelated-machines problem with eligibility sets is a " +
    "special case of one without, since pij = ∞ encodes Mj -- and it has P in Q in R. But a rule of that kind " +
    "only fires when every field it does not mention is equal, and P|Mj| differs from R|| in the machine " +
    "environment as well, so the two are never composed: R||Cmax did not generalize P|Mj|Cmax, nor did " +
    "R||ΣwjCj generalize P|Mj|ΣwjCj, nor R||ΣwjZj generalize P|Mj|ΣwjZj. We compose them in our converter only: " +
    "P|Mj| and Q|Mj| each reduce to R||, by giving job j its processing time on every machine in Mj and ∞ " +
    "elsewhere (pj/si for Q). That changes only the processing times, so a parameterized result crosses it " +
    "for every measure except those of the processing times -- the exclusions any move into R already carries. " +
    "Accepted only where machine environment and eligibility sets are the whole difference between two " +
    "problems, never stacked on another relaxation; longer relations follow by transitivity. Result: 4 arrows " +
    "(R||Cmax, R||ΣCj, R||ΣwjCj and R||ΣwjZj onto their eligibility versions), 14 relations by any path, and " +
    "none of them puts a problem cited P above one cited NP-hard, or a pseudo-polynomial one above a strongly " +
    "NP-hard one -- the check that caught the S1 rule.";

  // Which of our notes explains a green (added-by-this-site) edge. Three rules
  // of ours add edges: the two that used to correct The Scheduling Zoo's own
  // rules are upstream now (schedulingzoo PR #14), so no edge is attributed
  // to them any more.
  function szAddedEdgeNote(edge) {
    if (edge.addedBy === "processing-times") return SZ_PROCESSING_TIME_RULE_NOTE;
    if (edge.addedBy === "eligibility") return SZ_ELIGIBILITY_RULE_NOTE;
    return SZ_MACHINE_COUNT_RULE_NOTE;
  }

  // General notes about schedzoo's own data that don't attach to one
  // specific edge (so there's nothing to mark red/dashed on the graph) --
  // typos we've silently compensated for in our classifier, and structural
  // gaps in their reduction graph. Shown alongside SZ_FLAGGED_EDGES at the
  // bottom of this view.
  const SZ_DATA_NOTES = [
    {
      title: "The machine-count reduction chain is gated on three other fields being empty",
      body:
        "Checked both fields that could carry \"a single machine is a special case of m machines\". The \"type\" " +
        "field (alpha: 1/P/Q/R/O/F/J) has rules only among the multi-machine environments themselves " +
        "(P->Q->R, F->J); none mention \"1\", because The Scheduling Zoo's own parser never assigns type=\"1\" to " +
        "a parsed single-machine problem -- it assigns type=\"P\" plus a separate \"number of machines\"=\"1\". " +
        "And that field has no one-field rule at all. What it does have is the full chain " +
        "1->2->3->4->5->arbitrary (and ->∞) written as seven multi-field rules, each conditioned on " +
        "\"not bounded number of machines; not processing times; not preemption\" -- so it fires only for a " +
        "problem that restricts none of those. Any problem with pj=1, pj=p or pmtn is excluded, which is a " +
        "large part of the corpus: 1|pj=1;rj|Cmax gets no edge to P|pj=1;rj|Cmax, though m=1 is plainly a " +
        "special case of arbitrary m, and adding machines cannot hurt a regular objective whatever the " +
        "processing times are. The gate looks like caution rather than a claim -- nothing about preemption or " +
        "equal processing times makes an extra machine unsafe. Suggested upstream fix: state the chain " +
        "ungated, as one-field rules on \"number of machines\".",
    },
    {
      title: "We state that chain ungated",
      body: SZ_MACHINE_COUNT_RULE_NOTE,
    },
    {
      title: "Equal and unit processing times are not declared special cases of arbitrary ones -- rules added here",
      body: SZ_PROCESSING_TIME_RULE_NOTE,
    },
    {
      title: "Seven bibtex entries store a whole URL in the DOI field -- links worked around here",
      body:
        "A bibtex doi field holds the bare identifier, 10.xxxx/yyyy, and 20 of the 27 entries with a DOI have " +
        "it that way. The other seven store \"https://doi.org/10.xxxx/yyyy\" instead, so the usual way of " +
        "building a link -- https://doi.org/ followed by the identifier -- produced " +
        "\"https://doi.org/https://doi.org/10....\", which does not resolve. That was 25 broken citation links " +
        "on this site, on Woeginger 1997, Hanen-Kordon-Alix 2024, Hermelin-Pinedo 2019, Kaul-Mnich-Molter " +
        "2024, Chen-Marx-Zhang 2017, Knop-Koutecký 2017 and Goldman et al. 2000. Our converter now strips a " +
        "doi.org prefix before building the link, so every citation here resolves. Suggested upstream fix: " +
        "store the bare identifier in those seven entries (a URL belongs in the url field).",
    },
    {
      title: "Unrelated machines do not generalize eligible machines",
      body: SZ_ELIGIBILITY_RULE_NOTE +
        " Suggested upstream fix: derive the composed pairs, or state the rule for every environment it applies to.",
    },
    {
      title: "Three papers are entered twice, under two bibtex keys",
      body:
        "Kaul, Mnich & Molter 2024 appears as both \"KaulMnichMolter:24:Single-Machine-Scheduling-...\" and " +
        "\"KaulMnichMolter:24:Single-machine-scheduling-...\" -- the same paper, the keys differing only in " +
        "capitalisation, so The Scheduling Zoo's own duplicate-key check never fires. Each copy carries four " +
        "results, and the overlap shows up on 1|rj|ΣwjUj, where \"is fixed parameter tractable\" is listed " +
        "twice for #p+#d+#r and twice for #p+#w+#r. Hoogeveen & Lenstra 1994 is in twice as " +
        "\"HoogeveenLenstra:94:Three-four\" and \"hoogeveen1994three\", and Davies et al. once as " +
        "\"davies_scheduling_2020\" and once as \"davies_scheduling_2021\". Nothing is read around here: the " +
        "duplicates are shown as they are cited, since two entries for one paper is a question about the " +
        "bibliography, not about the results. Suggested upstream fix: merge each pair.",
    },
    {
      title: "The same parameter set is written in two different orders",
      body:
        "1|rj|ΣwjUj carries results for both \"#d+#p+#r\" and \"#p+#d+#r\", and for both \"#p+#d+#w\" and " +
        "\"#p+#w+#d\" -- the same set of bounded measures, written in a different order, which The Scheduling " +
        "Zoo treats as two different parameters. (Both pairs come from the duplicated Kaul-Mnich-Molter entry " +
        "above.) This site nests parameter results by set containment, so the two spellings land in the same " +
        "place and the panel shows them side by side rather than as unrelated results. Suggested upstream " +
        "fix: with the duplicate entry merged, the orders agree again.",
    },
  ];

  // The four anomalies this site used to read around -- the setup-time
  // chain under S1, the fix_j rule on parallel machines, three conditions
  // of the problem-builder form, and the "in in $P$" typo -- were reported
  // and fixed in The Scheduling Zoo itself (schedulingzoo PR #14, merged).
  // The corrections came out of the converter when the submodule was
  // updated, and regenerating the data from their files as shipped changed
  // nothing but the typo: the same 719 problems and the same 570 arrows,
  // which is the check that their fix and ours agree. Nothing about them is
  // shown on the site any more -- a fixed anomaly is not something a reader
  // has to be told about, and git remembers the rest.

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
    "ΣZj": "ΣwjZj",
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
  // Blue marks a classification the reader made themselves -- see the
  // .user-classified / .user-affected rules in style.css.
  const USER_CLASS_RING = "#3b82f6";
  const SZ_EDGE_COLORS = [MAP_EDGE_COLOR, SZ_EDGE_FLAGGED_COLOR, "#3b82f6"];
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
    "FF(1,m)": "FF(1,m) — two-stage flexible flow shop (1 machine, then m parallel machines)",
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
    // Just-in-time: a job counts only if it completes exactly at its due
    // date. "jit" is how the papers say it; "on time" is deliberately not
    // here, that already means the throughput objectives above.
    "ΣZj": "just-in-time jit number of just-in-time jobs exactly at due date",
    "ΣwjZj": "just-in-time jit weighted number of just-in-time jobs exactly at due date",
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
      if (willOpen) {
        sortByCount();
        placeFilterPanel(toggle, panel);
      }
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
      if (willOpen) {
        sortByCount();
        placeFilterPanel(toggle, panel);
      }
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
  // A generalization can never be easier than the problem it generalizes:
  // solving the general problem solves the special case too. So these two
  // pairings are contradictions rather than new information -- the same rule
  // designerArrowConflict applies to hand-drawn arrows, pulled out here so
  // the map, the arrows and the classify dialog all judge it identically.
  const SZ_HARD_CLASSES = ["weakly-NP-hard", "NP-hard-unresolved", "strongly-NP-hard"];
  function szClassConflict(generalClass, specificClass, generalName, specificName) {
    if (generalClass === "P" && SZ_HARD_CLASSES.includes(specificClass)) {
      return "an algorithm for " + generalName + " would also solve the NP-hard " + specificName + " in polynomial time";
    }
    if ((generalClass === "weakly-NP-hard" || generalClass === "pseudo-open") && specificClass === "strongly-NP-hard") {
      return "the pseudo-polynomial algorithm for " + generalName + " would also solve the strongly NP-hard " +
        specificName + " in pseudo-polynomial time";
    }
    return null;
  }
  // Two classifications of the SAME problem that cannot both hold.
  function szClassesDisagree(a, b) {
    if (!a || !b || a === b || a === "unclaimed" || b === "unclaimed") return false;
    return !!szClassConflict(a, b, "x", "y") || !!szClassConflict(b, a, "x", "y");
  }

  // Problems where the model now says something the corpus's own citations
  // contradict. Since a claim SUPERSEDES the corpus and carries along the
  // arrows, the two ends of an arrow no longer disagree with each other once
  // a claim has propagated -- the disagreement has moved to being between
  // the model and the literature, which is what this reports.
  function szOverriddenByClaims() {
    if (!DATA_SZ) return [];
    szEffectiveClasses();
    if (!SZ_EFFECTIVE_CORPUS) SZ_EFFECTIVE_CORPUS = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, true);
    return DATA_SZ.nodes
      .filter((n) => szClassesDisagree(SZ_EFFECTIVE[n.id], SZ_EFFECTIVE_CORPUS[n.id]))
      .map((n) => ({
        id: n.id,
        notation: n.notation,
        now: SZ_EFFECTIVE[n.id],
        cited: SZ_EFFECTIVE_CORPUS[n.id],
        direct: !!userClassification(n.id, null),
      }));
  }

  // The arrows to paint red: those whose two ends cannot both be true. A
  // general problem being hard while a special case of it is easy is the
  // normal shape of this graph (P||Cmax is strongly NP-hard, its two-machine
  // case P2||Cmax is not) and is NOT a conflict -- only the two pairings in
  // szClassConflict are. Because a claim supersedes the corpus and carries
  // along the arrows, propagation leaves the model consistent, so this is
  // rare by construction: it catches the case where the reader has made two
  // DIRECT claims that contradict each other, neither of which can override
  // the other. Disagreement with the LITERATURE is a different thing, is per
  // problem rather than per arrow, and is what szOverriddenByClaims reports.
  function szConflictingEdges() {
    if (!DATA_SZ) return [];
    szEffectiveClasses();
    const byId = {};
    DATA_SZ.nodes.forEach((n) => { byId[n.id] = n; });
    return DATA_SZ.edges.map((e) => {
      const why = szClassConflict(SZ_EFFECTIVE[e.from], SZ_EFFECTIVE[e.to],
        (byId[e.from] || {}).notation || e.from, (byId[e.to] || {}).notation || e.to);
      return why ? { from: e.from, to: e.to, why: why, fromClass: SZ_EFFECTIVE[e.from], toClass: SZ_EFFECTIVE[e.to] } : null;
    }).filter(Boolean);
  }

  // Same four properties as szNodeStyle, set directly on an existing node --
  // used when a classification changes and the map has to follow without a
  // re-render (which would throw away any dragging the reader has done).
  function applySzNodeStyle(el, classId) {
    const cc = classicalClassById(classId);
    el.style.background = classBg(cc, "var(--panel-bg)", SZ_NODE_RING);
    el.style.borderColor = cc ? cc.color : "#868e96";
    el.style.borderStyle = cc ? cc.border || "solid" : "solid";
    el.style.color = cc && cc.fill ? fillTextColor(cc) : "var(--fg)";
  }
  // The filter bar sits directly above the diagram, so a menu that opens
  // downward covers the very thing being filtered. These open UPWARD, and
  // only fall back to downward when the toggle is too close to the top of
  // the window for the menu to fit above it (where opening up would put it
  // off-screen and out of reach).
  // Menus taller than the space above are SHRUNK to fit rather than flipped
  // down -- they scroll inside already, and the settings menu is both the
  // tallest and the one most worth keeping off the diagram. Flipping down is
  // reserved for the case where there is so little room above that a menu
  // there would be unusable.
  const FILTER_PANEL_MIN_UP = 170;
  function placeFilterPanel(toggle, panel) {
    panel.classList.remove("ms-panel-down");
    panel.style.maxHeight = "";
    const room = toggle.getBoundingClientRect().top - 12;
    if (room < FILTER_PANEL_MIN_UP) {
      panel.classList.add("ms-panel-down");
      return;
    }
    if (panel.scrollHeight > room) panel.style.maxHeight = Math.floor(room) + "px";
  }

  // The band inside an "inset" box is as wide as the box's padding lets it
  // be without touching the text: 4px on the overview's boxes (their
  // horizontal padding), 9px on the designer's and Problem Maps' wider ones.
  const SZ_NODE_RING = 4, MAP_NODE_RING = 9;
  function szNodeStyle(classId) {
    const cc = classicalClassById(classId);
    const bg = classBg(cc, "var(--panel-bg)", SZ_NODE_RING);
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
  // `ignoreUserClaims` gives the corpus's own reading, untouched by anything
  // the reader has classified -- the panel shows the two side by side, so it
  // needs both.
  // `opts.userEdges` are the arrows the reader drew (see SZ_USER_EDGES): they
  // are claims, so they carry a class through whatever is cited at the
  // other end, exactly as a classification does -- P and pseudo-polynomial
  // down to the special case, hardness up to the general one -- and only a
  // direct classification of the reader's own is never overwritten by one.
  // Where an arrow contradicts the literature, the general problem keeps
  // its class and the special case follows it. `opts.affectedOut`, when
  // given, receives every problem a claim or an arrow moved.
  function computeEffectiveClassesForSz(nodes, edges, ignoreUserClaims, opts) {
    opts = opts || {};
    const nodeIds = new Set(nodes.map((n) => n.id));
    const userEdges = ignoreUserClaims ? [] : (opts.userEdges || []).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
    const effective = {};
    const visiting = new Set();
    function resolve(id, cls) {
      if (effective[id] !== undefined) return effective[id];
      let result = cls[id];
      // A problem with only a pseudo-polynomial algorithm of its own still
      // takes hardness from its special cases: with NP-hardness below it,
      // that is exactly weakly NP-hard.
      if ((!result || result === "unclaimed" || result === "pseudo-open") && !visiting.has(id)) {
        visiting.add(id);
        let best = null;
        edges.forEach((e) => {
          if (e.from === id) {
            best = strongerOf(best, inheritedContribution(resolve(e.to, cls)));
          }
        });
        visiting.delete(id);
        if (best) result = result === "pseudo-open" && best === "NP-hard-unresolved" ? "weakly-NP-hard" : best;
      }
      effective[id] = result;
      return result;
    }
    // A classification the reader recorded themselves outranks the corpus,
    // and from there travels exactly like a cited one.
    const own = ignoreUserClaims ? {} : loadUserClassifications();
    const cls = {};
    nodes.forEach((n) => {
      const mine = own[n.id] && own[n.id].classical;
      cls[n.id] = mine ? mine.classId : n.classicalClass;
    });
    nodes.forEach((n) => resolve(n.id, cls));

    // Hardness travels UP (above). P travels DOWN: an instance of a problem
    // solvable in polynomial time is still solvable once restricted, so
    // every special case of a P problem is in P. Only ever fills in a
    // problem that has no classification of its own -- and on the corpus
    // alone it changes nothing (checked: 0 of 719 nodes), because no
    // unclaimed problem there has a generalization in P. It earns its keep
    // once the reader classifies something as P themselves.
    let filled = true;
    while (filled) {
      filled = false;
      edges.forEach((e) => {
        const specific = effective[e.to];
        if (specific && specific !== "unclaimed") return;
        // P carries down as P; a pseudo-polynomial algorithm carries down as
        // one too -- it still runs on the special case. P is the stronger of
        // the two, so a special case already known to be in P keeps that.
        if (effective[e.from] === "P") {
          effective[e.to] = "P";
          filled = true;
        } else if (effective[e.from] === "weakly-NP-hard" || effective[e.from] === "pseudo-open") {
          // Only the algorithm comes down, not the hardness.
          effective[e.to] = "pseudo-open";
          filled = true;
        }
      });
    }

    // Where a claim disagrees with the corpus, the claim wins -- and so does
    // everything that follows from it. The passes above only ever fill in a
    // problem nothing was known about; these ones overwrite a cited class,
    // because that is what "the reader supersedes our data" means: claiming
    // a problem is in P puts every special case of it in P, even one cited
    // as NP-hard, and claiming one is hard makes every problem generalizing
    // it at least that hard, even one cited as P. Only another DIRECT claim
    // is immune. Everything reached this way is recorded so the map can show
    // which problems moved only because of a claim.
    const claimed = new Set(nodes.filter((x) => own[x.id] && own[x.id].classical).map((x) => x.id));
    const fromClaim = new Set(claimed);
    if (claimed.size || userEdges.length) {
      const hardness = { "NP-hard-unresolved": 1, "strongly-NP-hard": 2 };
      let moved = true;
      let guard = 0;
      while (moved && guard <= nodes.length + 2) {
        moved = false;
        guard += 1;
        edges.forEach((e) => {
          // P on a generalization forces P on each of its special cases.
          if (effective[e.from] === "P" && fromClaim.has(e.from) &&
              effective[e.to] !== "P" && !claimed.has(e.to)) {
            effective[e.to] = "P";
            fromClaim.add(e.to);
            moved = true;
          }
          // So does a pseudo-polynomial algorithm -- except onto a special
          // case already in P, which is the better answer of the two.
          if ((effective[e.from] === "weakly-NP-hard" || effective[e.from] === "pseudo-open") && fromClaim.has(e.from) &&
              !["weakly-NP-hard", "pseudo-open", "P"].includes(effective[e.to]) && !claimed.has(e.to)) {
            effective[e.to] = "pseudo-open";
            fromClaim.add(e.to);
            moved = true;
          }
          // Hardness on a special case forces at least as much on each
          // problem that generalizes it.
          const up = inheritedContribution(effective[e.to]);
          if (up && fromClaim.has(e.to) && !claimed.has(e.from)) {
            const current = inheritedContribution(effective[e.from]);
            if ((hardness[up] || 0) > (hardness[current] || 0)) {
              effective[e.from] = up;
              fromClaim.add(e.from);
              moved = true;
            }
          }
        });
        // The reader's own arrows: the same three rules, but the arrow itself
        // is the claim, so they fire from a cited class as readily as from a
        // classified one. An arrow that may blow numbers up does not carry a
        // pseudo-polynomial algorithm down (see SZ_REDUCTION_NUMBERS).
        userEdges.forEach((e) => {
          if (effective[e.from] === "P" && effective[e.to] !== "P" && !claimed.has(e.to)) {
            effective[e.to] = "P";
            fromClaim.add(e.to);
            moved = true;
          }
          if ((effective[e.from] === "weakly-NP-hard" || effective[e.from] === "pseudo-open") && e.numbers !== "blowup" &&
              !["weakly-NP-hard", "pseudo-open", "P"].includes(effective[e.to]) && !claimed.has(e.to)) {
            effective[e.to] = "pseudo-open";
            fromClaim.add(e.to);
            moved = true;
          }
          const up = inheritedContribution(effective[e.to]);
          if (up && !claimed.has(e.from)) {
            const current = inheritedContribution(effective[e.from]);
            if ((hardness[up] || 0) > (hardness[current] || 0)) {
              effective[e.from] = up;
              fromClaim.add(e.from);
              moved = true;
            }
          }
        });
      }
    }
    if (opts.affectedOut) fromClaim.forEach((id) => { if (!claimed.has(id)) opts.affectedOut.add(id); });
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
    // Half-drawn arrows don't survive a redraw either: the origin the reader
    // picked is about to be replaced by a fresh element somewhere else.
    SZ_ARROW_MODE = null;

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
    szEffectiveClasses();
    const szEffective = SZ_EFFECTIVE;

    const widthOf = {};
    warmTextWidths(ids.map((id) => byId[id].notation), fontPx);
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

    // One component, drawn as a layered graph (the classic Sugiyama
    // pipeline, in the small).
    //
    // 1. Rows: the longest path down from the component's roots, so a
    //    problem always sits below everything that generalizes it. Since
    //    hardness is what travels upward in this data (see
    //    inheritedContribution), the hard end of a chain lands at the top
    //    and never underneath its own special cases.
    // 2. Edges that skip rows get a dummy node in each row they cross, so
    //    every edge segment joins neighbouring rows. Dummies reserve a
    //    narrow slot, which is what keeps a long edge from being dragged
    //    across a row of unrelated problems.
    // 3. Order inside a row: barycenter sweeps (each node drifts towards
    //    the average position of what it connects to) followed by
    //    transposition (swap neighbours whenever that removes crossings),
    //    keeping whichever order crossed least.
    // 4. x positions: the settled order, then a few passes pulling each
    //    node towards its neighbours' centre without reordering, which
    //    straightens the long chains.
    const DUMMY_W = 8;
    const TRAY_COLS = 3;
    const PACK_CELL = 10;   // resolution of the packing outline, in pixels
    function layoutComponent(comp, compEdges, wrapAt) {
      const allParents = {}, allChildren = {};
      comp.forEach((id) => { allParents[id] = []; allChildren[id] = []; });
      compEdges.forEach((e) => { allParents[e.to].push(e.from); allChildren[e.from].push(e.to); });

      // ---- leaves go in a tray under their own parent.
      // A problem with one generalization and no special cases of its own
      // adds nothing to the shape of the graph, but ordering it among its
      // row's hundred siblings drags its one arrow right across the
      // drawing. Such leaves are taken out of the layering and parked in a
      // small block directly beneath their parent, which costs vertical
      // space and buys very short arrows.
      const tray = {};     // parent -> its leaves
      const inTray = new Set();
      comp.forEach((id) => {
        if (allChildren[id].length === 0 && allParents[id].length === 1) {
          const parent = allParents[id][0];
          (tray[parent] = tray[parent] || []).push(id);
          inTray.add(id);
        }
      });
      // A parent whose every child is trayed and that has no parent of its
      // own would be left alone in the layering; that is fine, it just
      // becomes a one-row block with its tray underneath.
      const core = comp.filter((id) => !inTray.has(id));
      if (!core.length) { core.push(comp[0]); inTray.delete(comp[0]); delete tray[comp[0]]; }
      const coreSet = new Set(core);
      compEdges = compEdges.filter((e) => coreSet.has(e.from) && coreSet.has(e.to));
      const trayRows = {};   // parent -> rows of leaves under it
      const trayW = {};      // parent -> width its tray needs
      Object.keys(tray).forEach((parent) => {
        if (!coreSet.has(parent)) { tray[parent].forEach((id) => inTray.delete(id)); delete tray[parent]; return; }
        const kids = tray[parent];
        const cols = Math.min(TRAY_COLS, kids.length);
        const rowsNeeded = Math.ceil(kids.length / cols);
        let widest = 0;
        for (let r = 0; r < rowsNeeded; r += 1) {
          const line = kids.slice(r * cols, (r + 1) * cols);
          widest = Math.max(widest, line.reduce((sum, id) => sum + widthOf[id] + colGap, 0) - colGap);
        }
        trayRows[parent] = rowsNeeded;
        trayW[parent] = widest;
      });
      const leftOver = comp.filter((id) => inTray.has(id) && !tray[allParents[id][0]]);
      leftOver.forEach((id) => { core.push(id); coreSet.add(id); inTray.delete(id); });

      const parentsOf = {}, childrenOf = {};
      core.forEach((id) => { parentsOf[id] = []; childrenOf[id] = []; });
      compEdges.forEach((e) => { parentsOf[e.to].push(e.from); childrenOf[e.from].push(e.to); });
      comp = core;

      const depth = layoutDag(comp, compEdges).row;
      comp.forEach((id) => {
        if (!parentsOf[id].length && childrenOf[id].length) {
          depth[id] = Math.min(...childrenOf[id].map((c) => depth[c])) - 1;
        }
      });

      // ---- proper layering: one slot per row for every edge
      const slotW = {};              // slot id -> pixel width
      const minRow = Math.min(...comp.map((id) => depth[id]));
      const maxRow = Math.max(...comp.map((id) => depth[id]));
      // rows[r] = the row's slots, left to right. Every row exists, even if
      // only dummies end up in it.
      const rows = Array.from({ length: maxRow - minRow + 1 }, () => []);
      const rowOf = {};
      comp.forEach((id) => {
        const r = depth[id] - minRow;
        rowOf[id] = r;
        rows[r].push(id);
        slotW[id] = Math.max(widthOf[id], trayW[id] || 0);
      });
      const segsDown = {}, segsUp = {}; // slot -> slots in the row below / above
      const link = (a, b) => {
        (segsDown[a] = segsDown[a] || []).push(b);
        (segsUp[b] = segsUp[b] || []).push(a);
      };
      let dummies = 0;
      compEdges.forEach((e) => {
        let from = e.from;
        for (let r = rowOf[e.from] + 1; r < rowOf[e.to]; r += 1) {
          const d = "\u0000dummy" + (dummies += 1);
          rowOf[d] = r;
          slotW[d] = DUMMY_W;
          rows[r].push(d);
          link(from, d);
          from = d;
        }
        link(from, e.to);
      });

      // ---- crossings between two neighbouring rows, by counting the
      // inversions among their edge segments.
      const indexIn = (r) => {
        const at = new Map();
        rows[r].forEach((id, i) => at.set(id, i));
        return at;
      };
      const crossingsBetween = (r) => {
        if (r < 0 || r + 1 >= rows.length) return 0;
        const upper = indexIn(r), lower = indexIn(r + 1);
        const pairs = [];
        rows[r].forEach((id) => (segsDown[id] || []).forEach((to) => {
          if (lower.has(to)) pairs.push([upper.get(id), lower.get(to)]);
        }));
        pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        let n = 0;
        for (let i = 0; i < pairs.length; i += 1) {
          for (let j = i + 1; j < pairs.length; j += 1) {
            if (pairs[i][1] > pairs[j][1]) n += 1;
          }
        }
        return n;
      };
      const totalCrossings = () => {
        let sum = 0;
        for (let r = 0; r + 1 < rows.length; r += 1) sum += crossingsBetween(r);
        return sum;
      };

      const snapshot = () => rows.map((items) => items.slice());
      const restore = (snap) => snap.forEach((items, r) => { rows[r] = items.slice(); });

      const barycenter = (r, neighbours) => {
        const other = indexIn(r + (neighbours === segsUp ? -1 : 1));
        const at = indexIn(r);
        const want = new Map();
        rows[r].forEach((id) => {
          const ns = (neighbours[id] || []).filter((n) => other.has(n));
          want.set(id, ns.length ? ns.reduce((sum, n) => sum + other.get(n), 0) / ns.length : at.get(id));
        });
        rows[r].sort((a, b) => want.get(a) - want.get(b) || at.get(a) - at.get(b));
      };
      // Swap neighbours while that removes crossings with the rows around.
      const transpose = () => {
        let improved = true;
        let guard = 0;
        while (improved && guard < 12) {
          improved = false;
          guard += 1;
          for (let r = 0; r < rows.length; r += 1) {
            for (let i = 0; i + 1 < rows[r].length; i += 1) {
              const before = crossingsBetween(r - 1) + crossingsBetween(r);
              const items = rows[r];
              const tmp = items[i]; items[i] = items[i + 1]; items[i + 1] = tmp;
              const after = crossingsBetween(r - 1) + crossingsBetween(r);
              if (after < before) improved = true;
              else { items[i + 1] = items[i]; items[i] = tmp; }
            }
          }
        }
      };

      let best = snapshot(), bestCost = totalCrossings();
      for (let pass = 0; pass < 8; pass += 1) {
        for (let r = 1; r < rows.length; r += 1) barycenter(r, segsUp);
        for (let r = rows.length - 2; r >= 0; r -= 1) barycenter(r, segsDown);
        transpose();
        const cost = totalCrossings();
        if (cost < bestCost) { bestCost = cost; best = snapshot(); }
      }
      restore(best);

      // ---- x positions: pack each row left to right, then pull nodes
      // towards their neighbours without changing the order.
      const x = {};
      // Compact width of each row, and of the component: no row may grow
      // past this, which is what stops the pulls below from stretching the
      // drawing sideways pass after pass.
      const rowWidth = rows.map((items) =>
        items.reduce((sum, id) => sum + slotW[id] + colGap, 0) - colGap);
      const compWidth = Math.max(0, ...rowWidth);

      // Place one row: each slot at the position it wants where there is
      // room, in order, with a gap, clamped into [0, compWidth] and pulled
      // back left wherever the row has slack.
      const placeRow = (r, want) => {
        const items = rows[r];
        if (!items.length) return;
        const at = [];
        let cursor = 0;
        items.forEach((id, i) => {
          const wish = want && want.has(id) ? want.get(id) : (x[id] !== undefined ? x[id] : cursor);
          at[i] = Math.max(wish, cursor);
          cursor = at[i] + slotW[id] + colGap;
        });
        let limit = compWidth;
        for (let i = items.length - 1; i >= 0; i -= 1) {
          at[i] = Math.min(at[i], limit - slotW[items[i]]);
          limit = at[i] - colGap;
        }
        cursor = 0;
        items.forEach((id, i) => {
          at[i] = Math.max(at[i], cursor);
          cursor = at[i] + slotW[id] + colGap;
        });
        items.forEach((id, i) => { x[id] = at[i]; });
      };
      // Start every row centred in the component, then let the pulls move
      // slots around inside that width.
      rows.forEach((items, r) => {
        let cursor = (compWidth - rowWidth[r]) / 2;
        items.forEach((id) => { x[id] = cursor; cursor += slotW[id] + colGap; });
      });
      const centreOf = (id) => x[id] + slotW[id] / 2;
      const pull = (r, neighbours) => {
        const want = new Map();
        rows[r].forEach((id) => {
          const ns = (neighbours[id] || []).filter((n) => x[n] !== undefined);
          if (!ns.length) return;
          const mid = ns.reduce((sum, n) => sum + centreOf(n), 0) / ns.length;
          want.set(id, Math.max(0, mid - slotW[id] / 2));
        });
        placeRow(r, want);
      };
      for (let pass = 0; pass < 4; pass += 1) {
        for (let r = 1; r < rows.length; r += 1) pull(r, segsUp);
        for (let r = rows.length - 2; r >= 0; r -= 1) pull(r, segsDown);
      }

      // ---- wrapping: a row wider than SZ_STRIP_W continues on further
      // lines of its own row, and the next row starts below all of them.
      // Every arrow still runs downwards -- which is why the diagram is
      // narrowed this way rather than by cutting it into side-by-side
      // pieces, where the arrows between the pieces would have to climb.
      const lines = [];               // one entry per drawn line of nodes
      rows.forEach((items, r) => {
        let line = [], lineW = 0;
        items.forEach((id) => {
          const need = slotW[id] + (line.length ? colGap : 0);
          if (line.length && lineW + need > wrapAt) {
            lines.push({ row: r, items: line, wrapped: true });
            line = []; lineW = 0;
          }
          line.push(id);
          lineW += line.length === 1 ? slotW[id] : need;
        });
        lines.push({ row: r, items: line, wrapped: lines.length && lines[lines.length - 1].row === r });
      });
      // Lay each line out left to right, keeping the settled order, and
      // leave room under every node that carries a tray. No extra gutters
      // in here: spacing a row out pushes its far end away from whatever it
      // connects to, and measured over the whole map that cost 18% more
      // crossings. The arrow-less block at the bottom gets them instead,
      // where spacing is free.
      const placed = [];
      let y = 0;
      // Centre every line in the block, so a short row sits under the middle
      // of the row above it rather than hugging the left edge.
      const lineWidth = lines.map((line) =>
        line.items.reduce((sum, id) => sum + slotW[id] + colGap, 0) - colGap);
      const blockWidth = Math.max(0, ...lineWidth);
      lines.forEach((line, li) => {
        let cursor = (blockWidth - lineWidth[li]) / 2;
        const deepestTray = Math.max(0, ...line.items.map((id) => trayRows[id] || 0));
        line.items.forEach((id) => {
          const slotMid = cursor + slotW[id] / 2;
          if (widthOf[id] === undefined) { cursor += slotW[id] + colGap; return; }  // a dummy: it only holds space
          pos[id] = { left: slotMid - widthOf[id] / 2, top: y, w: widthOf[id], h: nodeH };
          placed.push(id);
          const kids = tray[id] || [];
          const cols = Math.min(TRAY_COLS, kids.length);
          for (let tr = 0; tr * cols < kids.length; tr += 1) {
            const kidLine = kids.slice(tr * cols, (tr + 1) * cols);
            const kidW = kidLine.reduce((sum, kid) => sum + widthOf[kid] + colGap, 0) - colGap;
            let kidX = slotMid - kidW / 2;
            kidLine.forEach((kid) => {
              pos[kid] = { left: kidX, top: y + (tr + 1) * rowH, w: widthOf[kid], h: nodeH };
              placed.push(kid);
              kidX += widthOf[kid] + colGap;
            });
          }
          cursor += slotW[id] + colGap;
        });
        y += rowH + deepestTray * rowH;
      });
      const right = Math.max(...placed.map((id) => pos[id].left + pos[id].w));
      const left = Math.min(...placed.map((id) => pos[id].left));
      const bottom = Math.max(...placed.map((id) => pos[id].top));
      placed.forEach((id) => { pos[id].left -= left; });
      // The block's outline, column by column: where its problems start and
      // end vertically. A layered drawing is full of notches -- a row of two
      // problems next to a row of fourteen -- and the packer uses this to
      // slide other blocks into them instead of treating the block as one
      // solid rectangle.
      // A margin of empty columns on each side so blocks packed next to one
      // another keep a gap rather than touching.
      const pad = Math.ceil(compGap / PACK_CELL);
      const columns = Math.max(1, Math.ceil((right - left) / PACK_CELL)) + 2 * pad;
      const profile = { top: new Array(columns).fill(Infinity), bottom: new Array(columns).fill(-Infinity), pad: pad };
      placed.forEach((id) => {
        const from = Math.max(0, pad + Math.floor(pos[id].left / PACK_CELL));
        const to = Math.min(columns - 1, pad + Math.ceil((pos[id].left + pos[id].w) / PACK_CELL));
        for (let c = from; c <= to; c += 1) {
          profile.top[c] = Math.min(profile.top[c], pos[id].top);
          profile.bottom[c] = Math.max(profile.bottom[c], pos[id].top + nodeH);
        }
      });
      return { comp: placed, width: right - left, height: bottom + nodeH, profile: profile };
    }

    // A component that would still be wider than SZ_STRIP_W is split into
    // clusters first, and each cluster drawn as its own block. The split is
    // by the graph, not by the picture: clusters grow around a seed, always
    // taking whichever neighbouring problem is tied to the cluster by the
    // most arrows, so the arrows that end up between blocks are the few
    // that were loosest to begin with. Cutting the drawing at a fixed width
    // instead severed 49 of one component's 198 arrows.
    function partitionComponent(comp, compEdges, parts) {
      const adj = {};
      comp.forEach((id) => { adj[id] = []; });
      compEdges.forEach((e) => { adj[e.from].push(e.to); adj[e.to].push(e.from); });
      const target = Math.ceil(comp.length / parts);
      const left = new Set(comp);
      const clusters = [];
      while (left.size) {
        let seed = null, fewest = Infinity;
        left.forEach((id) => {
          const d = adj[id].filter((n) => left.has(n)).length;
          if (d < fewest) { fewest = d; seed = id; }
        });
        const cluster = [];
        const ties = new Map();   // candidate -> arrows already into the cluster
        const take = (id) => {
          cluster.push(id);
          left.delete(id);
          ties.delete(id);
          adj[id].forEach((n) => { if (left.has(n)) ties.set(n, (ties.get(n) || 0) + 1); });
        };
        take(seed);
        while (cluster.length < target && ties.size) {
          let pick = null, best = -1;
          ties.forEach((count, id) => { if (count > best) { best = count; pick = id; } });
          take(pick);
        }
        clusters.push(cluster);
      }
      return clusters;
    }

    // Problems with no reduction edge at all (161 of 719 today) carry no
    // structure to draw, so they are not packed among the components as
    // one-node boxes -- that is what scattered them through the mosaic.
    // They go in one block underneath, in rows ordered hardest first.
    const CLASS_TOP_DOWN = ["strongly-NP-hard", "NP-hard-unresolved", "weakly-NP-hard", "P", "online", "unclaimed"];
    const lone = [];
    const boxes = [];
    const edgesWithin = (group) => {
      const set = new Set(group);
      return edgesAll.filter((e) => set.has(e.from) && set.has(e.to));
    };
    components.forEach((comp, group) => {
      if (comp.length === 1) { lone.push(comp[0]); return; }
      const compEdges = edgesWithin(comp);
      const box = layoutComponent(comp, compEdges, Infinity);
      if (box.width <= SZ_STRIP_W || comp.length < 12) {
        boxes.push(Object.assign(box, { group: group, seq: 0 }));
        return;
      }
      // Too wide: cut the component into blocks that stack. The cut starts
      // from clusters grown by connectivity, then every problem is pushed
      // down to at least the block of its most junior generalization. That
      // second step is what guarantees a block only ever receives arrows
      // from blocks above it, so no arrow in the finished diagram points
      // upwards.
      const clusters = partitionComponent(comp, compEdges, Math.ceil(box.width / SZ_STRIP_W));
      const band = {};
      clusters.forEach((cluster, i) => cluster.forEach((id) => { band[id] = i; }));
      const parentsIn = {};
      comp.forEach((id) => { parentsIn[id] = []; });
      compEdges.forEach((e) => parentsIn[e.to].push(e.from));
      const compDepth = layoutDag(comp, compEdges).row;
      const depthOrder = comp.slice().sort((a, b) => compDepth[a] - compDepth[b]);
      depthOrder.forEach((id) => {
        parentsIn[id].forEach((p) => { band[id] = Math.max(band[id], band[p]); });
      });
      const bandsUsed = Array.from(new Set(Object.values(band))).sort((a, b) => a - b);
      // Merge neighbouring bands back together while they still fit the
      // width. Pushing problems down to their generalization's band often
      // empties a band down to one or two problems, and a stack of those
      // reads as a pillar: one problem per row with blank space beside it.
      // Merging neighbours keeps the stacking order, so arrows still point
      // down.
      const merged = [];
      bandsUsed.forEach((b) => {
        const members = comp.filter((id) => band[id] === b);
        if (!members.length) return;
        const last = merged[merged.length - 1];
        if (last) {
          const together = last.concat(members);
          if (layoutComponent(together, edgesWithin(together), Infinity).width <= SZ_STRIP_W) {
            merged[merged.length - 1] = together;
            return;
          }
        }
        merged.push(members);
      });
      merged.forEach((members, seq) => {
        let bandBox = layoutComponent(members, edgesWithin(members), Infinity);
        // Only if a band is still too wide on its own do its rows wrap --
        // wrapping keeps every arrow pointing down too, it just costs
        // crossings, so it is the last resort.
        if (bandBox.width > SZ_STRIP_W) bandBox = layoutComponent(members, edgesWithin(members), SZ_STRIP_W);
        boxes.push(Object.assign(bandBox, { group: group, seq: seq }));
      });
    });

    // Shelf-pack the components, tallest first so shelves waste less room,
    // and aim for a canvas about twice as wide as it is tall.
    // Pack tallest first so shelves waste less room, but never split up the
    // blocks that came from one component: they travel together, in order.
    const groupHeight = {};
    boxes.forEach((b) => { groupHeight[b.group] = Math.max(groupHeight[b.group] || 0, b.height); });
    // Online problems are a family of their own -- the same instances with
    // less information, which is neither a restriction nor a generalization
    // of anything else here, so they share no arrow with the rest of the
    // map. That makes them the most MOVABLE thing on it -- nothing
    // constrains where they sit -- so they are merged into one block and
    // fitted into a hole the arrow-bound components left behind, after
    // everything else has been placed and centred. See the online block's
    // own pass further down.
    const isOnline = (id) => /online/.test((byId[id] && byId[id].vector && byId[id].vector["release time"]) || "");
    boxes.forEach((b) => { b.online = b.comp.filter(isOnline).length * 2 > b.comp.length ? 1 : 0; });
    const onlineBoxes = boxes.filter((b) => b.online);
    const offlineBoxes = boxes.filter((b) => !b.online);
    offlineBoxes.sort((a, b) =>
      groupHeight[b.group] - groupHeight[a.group] || a.group - b.group || a.seq - b.seq);

    // The whole online family is merged into ONE block: its own chains
    // tiled side by side, with its arrow-less problems filling the last
    // rows. Packed as a single unit it stays together -- scattering these
    // across the canvas as separate blocks loses the one thing their
    // colour is telling the reader -- while still being placed by the
    // ordinary packer, so it drops into whatever hole it fits rather than
    // reserving space for itself.
    //
    // Built to a given WIDTH, because the right shape depends on the shape
    // of the gaps left in the map: a fixed roughly-square target made a
    // tall tower, and a skyline is mostly wide shallow notches. The
    // candidates are tried against the packed skyline below and the one
    // that costs the least height wins.
    const loneOnline = lone.filter(isOnline);
    onlineBoxes.sort((a, b) => b.height - a.height || b.width - a.width);
    // The members' positions inside their own component blocks, kept so
    // each candidate shape can be built from the same starting point --
    // otherwise every rebuild would stack another offset on the last.
    const onlineSeed = {};
    onlineBoxes.forEach((b) => b.comp.forEach((id) => {
      onlineSeed[id] = { left: pos[id].left, top: pos[id].top, w: pos[id].w, h: pos[id].h };
    }));
    loneOnline.forEach((id) => { onlineSeed[id] = { left: 0, top: 0, w: widthOf[id], h: nodeH }; });
    const buildOnlineBlock = (target) => {
      if (!onlineBoxes.length && !loneOnline.length) return null;
      Object.keys(onlineSeed).forEach((id) => { pos[id] = Object.assign({}, onlineSeed[id]); });
      const members = [];
      let x = 0, y = 0, rowTall = 0;
      // A problem with no arrows has never been through layoutComponent,
      // so it has no pos entry yet -- it would otherwise be placed
      // straight onto the shelf.
      const put = (id, left, top) => {
        pos[id] = pos[id] || { left: 0, top: 0, w: widthOf[id], h: nodeH };
        pos[id].left = left;
        pos[id].top = top;
        members.push(id);
      };
      onlineBoxes.forEach((box) => {
        if (x && x + box.width > target) { x = 0; y += rowTall + compGap; rowTall = 0; }
        box.comp.forEach((id) => put(id, pos[id].left + x, pos[id].top + y));
        x += box.width + compGap;
        rowTall = Math.max(rowTall, box.height);
      });
      if (members.length) { y += rowTall + compGap; x = 0; }
      loneOnline.slice().sort((a, b) => widthOf[b] - widthOf[a] || a.localeCompare(b)).forEach((id) => {
        if (x && x + widthOf[id] > target) { x = 0; y += rowH; }
        put(id, x, y);
        x += widthOf[id] + colGap;
      });
      if (!members.length) return null;
      const left = Math.min(...members.map((id) => pos[id].left));
      const right = Math.max(...members.map((id) => pos[id].left + pos[id].w));
      const bottom = Math.max(...members.map((id) => pos[id].top + pos[id].h));
      members.forEach((id) => { pos[id].left -= left; });
      const pad = Math.ceil(compGap / PACK_CELL);
      const columns = Math.max(1, Math.ceil((right - left) / PACK_CELL)) + 2 * pad;
      const profile = { top: new Array(columns).fill(Infinity), bottom: new Array(columns).fill(-Infinity), pad: pad };
      members.forEach((id) => {
        const from = Math.max(0, pad + Math.floor(pos[id].left / PACK_CELL));
        const to = Math.min(columns - 1, pad + Math.ceil((pos[id].left + pos[id].w) / PACK_CELL));
        for (let c = from; c <= to; c += 1) {
          profile.top[c] = Math.min(profile.top[c], pos[id].top);
          profile.bottom[c] = Math.max(profile.bottom[c], pos[id].top + nodeH);
        }
      });
      return { comp: members, width: right - left, height: bottom, profile: profile, group: -1, seq: 0 };
    };
    const totalArea = boxes.reduce((s, b) => s + b.width * b.height, 0) +
      lone.reduce((s, id) => s + (widthOf[id] + colGap) * rowH, 0);
    // Wide enough to hold the widest component, otherwise roughly square-ish
    // (a bit wider than tall, which reads better on a screen) and never so
    // wide that the whole diagram becomes one long band.
    const widestBox = Math.max(0, ...boxes.map((b) => b.width));
    const targetWidth = Math.max(1200, widestBox, Math.min(SZ_STRIP_W + 300, Math.sqrt(totalArea * 1.1)));
    // Pack the blocks against a skyline rather than in shelves: each block
    // drops into the highest free spot that fits it. A tall narrow chain --
    // a component that is one problem per row -- then gets short blocks
    // tucked in beside it instead of leaving a column of blank canvas.
    const cells = Math.max(1, Math.ceil(targetWidth / PACK_CELL));
    const skyline = new Float64Array(cells);
    const groupFloor = {};   // a component's later blocks stay below its earlier ones
    let usedWidth = 0, usedHeight = 0;
    // Where a block would land, without putting it there.
    const findSpot = (box) => {
      const prof = box.profile;
      const span = Math.min(cells, Math.max(1, prof.top.length));
      const floor = box.seq > 0 ? (groupFloor[box.group] || 0) : 0;
      // Drop the block into the highest spot where its own outline clears
      // what is already on the canvas, column by column, so a narrow block
      // can slide into the notch beside a wide row.
      let bestX = 0, bestY = Infinity;
      for (let i = 0; i + span <= cells; i += 1) {
        let y = floor;
        for (let c = 0; c < span; c += 1) {
          if (prof.top[c] === Infinity) continue;
          y = Math.max(y, skyline[i + c] - prof.top[c]);
        }
        if (y < bestY) { bestY = y; bestX = i; }
      }
      return { x: bestX, y: bestY, span: span };
    };
    const placeBox = (box) => {
      const prof = box.profile;
      const { x: bestX, y: bestY, span } = findSpot(box);
      const left = (bestX + prof.pad) * PACK_CELL, top = bestY;
      box.comp.forEach((id) => {
        pos[id].left += left + margin;
        pos[id].top += top + margin;
      });
      for (let c = 0; c < span; c += 1) {
        if (prof.bottom[c] === -Infinity) continue;
        skyline[bestX + c] = Math.max(skyline[bestX + c], top + prof.bottom[c] + compGap);
      }
      groupFloor[box.group] = Math.max(groupFloor[box.group] || 0, top + box.height + compGap);
      box.rect = { left: left, top: top, width: box.width, height: box.height };
      box.colOffset = bestX;
      usedWidth = Math.max(usedWidth, left + box.width);
      usedHeight = Math.max(usedHeight, top + box.height);
    };
    // Everything arrow-bound first, so the holes exist.
    offlineBoxes.forEach(placeBox);

    // Centre each block in the free space beside it. The packer drops every
    // block as far left as it will go, which leaves a block alone on its
    // line pinned to the left edge with all the room on its right. How far
    // a block may slide is measured against the same column outlines the
    // packer used, so interlocked blocks never slide into one another.
    const occupancy = [];   // column -> [{ top, bottom, box }]
    offlineBoxes.forEach((box) => {
      const prof = box.profile;
      for (let c = 0; c < prof.top.length; c += 1) {
        if (prof.top[c] === Infinity) continue;
        const col = box.colOffset + c;
        (occupancy[col] = occupancy[col] || []).push({
          top: box.rect.top + prof.top[c], bottom: box.rect.top + prof.bottom[c], box: box,
        });
      }
    });
    const blocked = (box, deltaCells) => {
      const prof = box.profile;
      for (let c = 0; c < prof.top.length; c += 1) {
        if (prof.top[c] === Infinity) continue;
        const col = box.colOffset + c + deltaCells;
        if (col < 0 || col >= cells) return true;   // never past the canvas edge
        const top = box.rect.top + prof.top[c] - compGap;
        const bottom = box.rect.top + prof.bottom[c] + compGap;
        const here = occupancy[col] || [];
        for (let k = 0; k < here.length; k += 1) {
          if (here[k].box !== box && here[k].top < bottom && top < here[k].bottom) return true;
        }
      }
      return false;
    };
    offlineBoxes.forEach((box) => {
      let room = 0, spare = 0;
      while (spare < cells && !blocked(box, spare + 1)) spare += 1;
      while (room < cells && !blocked(box, -(room + 1))) room += 1;
      const shiftCells = Math.round((spare - room) / 2);
      if (!shiftCells) return;
      const shift = shiftCells * PACK_CELL;
      const prof = box.profile;
      for (let c = 0; c < prof.top.length; c += 1) {
        const here = occupancy[box.colOffset + c];
        if (here) occupancy[box.colOffset + c] = here.filter((entry) => entry.box !== box);
      }
      box.comp.forEach((id) => { pos[id].left += shift; });
      box.rect.left += shift;
      box.colOffset += shiftCells;
      for (let c = 0; c < prof.top.length; c += 1) {
        if (prof.top[c] === Infinity) continue;
        (occupancy[box.colOffset + c] = occupancy[box.colOffset + c] || []).push({
          top: box.rect.top + prof.top[c], bottom: box.rect.top + prof.bottom[c], box: box,
        });
      }
      usedWidth = Math.max(usedWidth, box.rect.left + box.rect.width);
    });

    // ---- the online family, fitted into a real hole ----------------------
    // Placed here, after the centring pass, and against the actual
    // geometry rather than the skyline. The packer above can only ever see
    // a skyline -- one height per column -- so the best it can do is drop a
    // block below everything in a column, and this family kept getting
    // shoved to the foot of the map even when there was an obvious gap
    // further up. Centring then slides blocks sideways, which opens more
    // holes still. Searching the placed outlines directly is what lets the
    // block sit in a gap that has problems ABOVE it, not just beside it.
    //
    // The shape is searched too: the same problems tiled at a range of
    // widths, since which shape fits depends entirely on the holes that
    // happen to be there.
    if (onlineBoxes.length || loneOnline.length) {
      // The highest position at column `i` where the block's own outline
      // clears every block already placed. Candidate heights are 0 and the
      // underside of each outline in the columns it would cover -- a
      // resting place is always flush against something or at the top.
      const fitAt = (block, i, span) => {
        const prof = block.profile;
        const tries = [0];
        for (let c = 0; c < span; c += 1) {
          if (prof.top[c] === Infinity) continue;
          (occupancy[i + c] || []).forEach((e) => tries.push(e.bottom + compGap - prof.top[c]));
        }
        tries.sort((p, q) => p - q);
        for (let t = 0; t < tries.length; t += 1) {
          const y = Math.max(0, tries[t]);
          let ok = true;
          for (let c = 0; c < span && ok; c += 1) {
            if (prof.top[c] === Infinity) continue;
            const top = y + prof.top[c] - compGap, bottom = y + prof.bottom[c] + compGap;
            const here = occupancy[i + c] || [];
            for (let k = 0; k < here.length; k += 1) {
              if (here[k].top < bottom && top < here[k].bottom) { ok = false; break; }
            }
          }
          if (ok) return y;
        }
        return Infinity;
      };
      const widest = Math.max(...onlineBoxes.map((b) => b.width), ...loneOnline.map((id) => widthOf[id]));
      const totalW = onlineBoxes.reduce((t, b) => t + b.width + compGap, 0) +
        loneOnline.reduce((t, id) => t + widthOf[id] + colGap, 0);
      let best = null;
      for (let f = 1; f <= 8; f += 1) {
        const w = Math.min(targetWidth, Math.max(widest, (totalW * f) / 8));
        const block = buildOnlineBlock(w);
        if (!block) break;
        const span = Math.min(cells, Math.max(1, block.profile.top.length));
        for (let i = 0; i + span <= cells; i += 1) {
          const y = fitAt(block, i, span);
          if (!isFinite(y)) continue;
          const bottom = y + block.height;
          // Lowest bottom edge wins -- a hole high up beats the floor --
          // and among equals the flattest shape, which disturbs the
          // skyline least.
          if (!best || bottom < best.bottom - 1 || (Math.abs(bottom - best.bottom) <= 1 && w > best.w)) {
            best = { w: w, x: i, y: y, bottom: bottom };
          }
        }
      }
      if (best) {
        const block = buildOnlineBlock(best.w);
        const left = (best.x + block.profile.pad) * PACK_CELL;
        block.comp.forEach((id) => {
          pos[id].left += left + margin;
          pos[id].top += best.y + margin;
        });
        usedWidth = Math.max(usedWidth, left + block.width);
        usedHeight = Math.max(usedHeight, best.y + block.height);
      }
    }

    let shelfY = usedHeight, shelfX = 0, shelfH = 0;

    if (lone.some((id) => !isOnline(id))) {
      // The problems with no arrows at all: one group per complexity,
      // hardest first, so the shelf reads as a continuation of the map's
      // own colour order rather than as a jumble.
      // Each group starts on its own line, with a gutter every few problems
      // and a gap between groups, so these do not read as one endless band
      // of boxes.
      const GUTTER_EVERY = 6;
      const groupsOfLone = [];
      const keyOf = (id) => szEffective[id] || byId[id].classicalClass || "unclaimed";
      CLASS_TOP_DOWN.forEach((key) => {
        const members = lone.filter((id) => !isOnline(id) && keyOf(id) === key)
          .sort((a, b) => widthOf[a] - widthOf[b] || a.localeCompare(b));
        if (members.length) groupsOfLone.push(members);
      });
      shelfY += compGap * 2;
      // Break each group into lines first, so every line can be centred.
      const blockW = Math.max(targetWidth, usedWidth);
      groupsOfLone.forEach((members) => {
        const rowsOfLone = [];
        let line = [], lineW = 0;
        members.forEach((id, i) => {
          const gutter = i && i % GUTTER_EVERY === 0 ? colGap * 2.5 : 0;
          const need = widthOf[id] + (line.length ? colGap + gutter : 0);
          if (line.length && lineW + need > blockW) {
            rowsOfLone.push({ items: line, width: lineW });
            line = []; lineW = 0;
          }
          line.push({ id: id, gap: line.length ? colGap + gutter : 0 });
          lineW += line.length === 1 ? widthOf[id] : need;
        });
        if (line.length) rowsOfLone.push({ items: line, width: lineW });
        rowsOfLone.forEach((lineOfLone) => {
          shelfX = (blockW - lineOfLone.width) / 2;
          lineOfLone.items.forEach((item) => {
            shelfX += item.gap;
            pos[item.id] = { left: shelfX + margin, top: shelfY + margin, w: widthOf[item.id], h: nodeH };
            shelfX += widthOf[item.id];
            usedWidth = Math.max(usedWidth, shelfX);
          });
          shelfY += rowH;
        });
        shelfY += compGap;
      });
      shelfY -= rowH;
      shelfY -= rowH + compGap;
      shelfH = nodeH;
    }

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

    const portOf = edgePorts(edgesAll, (id) => pos[id]);
    const linesSvg = edgesAll
      .map((e) => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return "";
        const port = portOf(e);
        const d = edgePathD(a, b, 3, port.pa, port.pb);
        const portAttr = ' data-pa="' + port.pa + '" data-pb="' + port.pb + '"';
        // Red also covers a contradiction the reader has just created by
        // classifying something themselves (item: inconsistent claims stay
        // allowed, but the arrows that disagree say so).
        const flagged = szFlaggedEdgeFor(e.from, e.to) ||
          !!szClassConflict(szEffective[e.from], szEffective[e.to], e.from, e.to);
        // Blue where one of the reader's classifications reaches: either end
        // claimed, or moved by a claim. A real contradiction still wins the
        // arrow -- red is a warning and must not be painted over.
        const claimTouched = !flagged && (
          userClassification(e.from, null) || userClassification(e.to, null) ||
          SZ_USER_AFFECTED.has(e.from) || SZ_USER_AFFECTED.has(e.to));
        // Green = an edge that exists ONLY because of OUR added "number of
        // machines" reduction rule (see OUR_MACHINE_COUNT_RULES in
        // convert_for_pzoo.py) -- schedzoo's own data never implied it.
        // Never both flagged and ours: we only ever add edges we've checked
        // are sound (see the data notes below).
        const stroke = claimTouched ? USER_CLASS_RING : szEdgeStroke(e, flagged);
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
          '<path class="sz-edge-hit" ' + fromAttr + portAttr + ' fill="none" d="' + d + '" />' +
          '<path class="sz-edge-visible" ' + fromAttr + portAttr + ' fill="none" d="' + d +
          '" stroke="' + stroke + '" stroke-width="' + (flagged ? "2.6" : "2") + '"' + dash +
          ' marker-end="url(#' + szArrowIdFor(stroke) + ')" />' +
          "</g>";
      })
      .join("");

    const nodesHtml = nodes
      .map((n) => {
        const p = pos[n.id];
        return '<a class="map-node sz-node' + (userClassification(n.id, null) ? " user-classified" : "") +
          (SZ_USER_AFFECTED.has(n.id) ? " user-affected" : "") +
          ({ own: " has-params", implied: " has-params-implied" }[szNodeParamsTier(n)] || "") +
          ({ own: " has-approx", implied: " has-approx-implied" }[szNodeApproxTier(n)] || "") +
          '" data-sz-id="' + escapeHtml(n.id) + '" data-sz-notation="' +
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
          (classBg(c, "transparent", 2)) + ";border:2px " + (c.border || "solid") + " " + c.color +
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
      '<div class="map-diagram"' + (SZ_LENS ? ' data-lens="' + SZ_LENS + '"' : "") + ">" +
      // Always start disabled: a full render (this one included) always
      // clears SZ_HIDDEN_STACK/SZ_HIDDEN_REDO_STACK above, since neither
      // stack means anything against a layout that's just been discarded
      // and rebuilt from scratch.
      '<div class="map-history-controls">' +
      '<button type="button" id="sz-undo-btn" class="map-history-btn" disabled title="Undo the last node hidden by dragging">↶ Undo</button>' +
      '<button type="button" id="sz-redo-btn" class="map-history-btn" disabled title="Redo the last undone hide">↷ Redo</button>' +
      '<button type="button" id="sz-reset-hidden-btn" class="map-history-btn" disabled title="Bring back every node hidden by dragging off the edge (does not touch the filters)">↺ Restore hidden</button>' +
      // Same control, same two-click gesture and same reduction
      // questionnaire as the designer's -- see szArrowPick.
      '<button type="button" id="sz-add-arrow-btn" class="map-history-btn designer-add-arrow-btn" aria-pressed="false"' +
      ' title="Add an arrow by hand: click the more general problem, then its special case" aria-label="Add arrow">→+</button>' +
      "</div>" +
      '<button type="button" class="tikz-export-btn" title="Copy this diagram as TikZ code">⧉ TikZ</button>' +
      '<button type="button" class="auto-arrange-btn" title="Recompute node positions from scratch">⇄ Auto-arrange</button>' +
      '<button type="button" class="sz-save-map-btn" title="Save the problems shown here as a new problem map">⊕ Save as a New Problem Map</button>' +
      // The lens: two switches on the right edge of the box. Pressing one
      // lights every node that has that kind of result -- a full glow for
      // a result cited on it, a softer one for a result that reaches it
      // along the arrows -- and dims the rest; pressing it again turns it
      // off, pressing the other swaps. Counts are over the nodes actually
      // drawn, so they follow the filter.
      '<div class="sz-lens" role="group" aria-label="Highlight problems by kind of result">' +
      '<button type="button" class="sz-lens-btn" data-lens="params" aria-pressed="' + (SZ_LENS === "params" ? "true" : "false") +
      '" title="Light up every problem with a parameterized result and dim the rest. Full glow: a result cited on it. ' +
      'Softer glow: a result that reaches it along the arrows -- hardness up from a special case, an algorithm down from a generalization.">' +
      "✦ Parameterized " + szLensCountHtml(nodes, szNodeParamsTier) + "</button>" +
      '<button type="button" class="sz-lens-btn" data-lens="approx" aria-pressed="' + (SZ_LENS === "approx" ? "true" : "false") +
      '" title="Light up every approximable problem -- one with an approximation scheme or a ratio achieved -- and dim the rest. ' +
      'Full glow: the algorithm is cited on it. Softer glow: it comes down the arrows from a more general problem. ' +
      'An inapproximability bound on its own does not light a problem; it shows in the panel.">' +
      "✦ Approximable " + szLensCountHtml(nodes, szNodeApproxTier) + "</button>" +
      "</div>" +
      // Always in the DOM, shown by szUpdateClaimsBar once the reader has
      // actually made something of their own -- a classification, or an
      // arrow drawn by hand. Rendering it conditionally meant the buttons
      // only turned up on the next full redraw, long after the claim.
      '<div class="sz-claims-actions" hidden>' +
      '<button type="button" class="sz-submit-claims-btn" title="Review your own classifications and send them to this site\'s author">' +
      "&#9993; Send my classifications</button>" +
      '<button type="button" class="sz-reset-claims-btn" title="Delete every classification you have made in this browser">' +
      "&#8635; Reset my classifications</button></div>" +
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
      // Filled in place by szUpdateArrowUi (hidden while empty), so adding
      // an arrow never costs a re-render -- which would throw away whatever
      // the reader has dragged around.
      '<p class="designer-arrow-hint sz-arrow-hint" role="status"></p>' +
      '<div class="map-legend">' + szClassLegendHtml + "</div>" +
      // How to read the map and what can be done with it, under the legend.
      '<div class="map-hint sz-map-help"><span class="map-hint-icon">i</span>' +
      '<p><b class="sz-def">Nodes</b> are problems -- click one for its citations and parameterized results. ' +
      '<b class="sz-def">Arrows</b> run from a problem to a special case of it: every instance of the problem an ' +
      "arrow points to is also an instance of the one it starts from. Click one to see which field differs.</p>" +
      '<p><b class="sz-def">Colors</b> show classical complexity. Hardness travels against the arrows, so a problem ' +
      "with no classical result of its own takes the hardness of any special case of it that is proven hard.</p>" +
      '<p>The <b class="sz-def">teal</b> problems are online: their jobs arrive over time, so they are measured by ' +
      "competitive ratio rather than by a complexity class, and they share no arrow with the rest of the map " +
      '(which is why they turn up wherever there was room for them). ' +
      '<a href="#/docs/docs-online-problems-are-measured-on-a-different-axis">Why</a>.</p>' +
      '<p><b class="sz-def">Drag</b> a node off the diagram ' +
      'to hide it from this view -- the data is unchanged. <b class="sz-def">Shift-click</b> several nodes, or ' +
      '<b class="sz-def">drag a box</b> across empty space, to pick out a group: they then move together, and go ' +
      'off the diagram together. <b class="sz-def">Undo / Redo / Restore hidden</b> ' +
      'brings it back. <b class="sz-def">Apply filter</b> redraws the map with only the problems matching the ' +
      'filters; <b class="sz-def">Show all</b> returns to the full map.</p>' +
      '<p><b class="sz-def">→+</b> draws an arrow of your own: click the more general problem, then the special ' +
      "case it points to, and say what kind of reduction it is. Your arrows are dashed and kept in this browser; " +
      "click one to edit or remove it. They are claims of yours, so a class carries along them the way it does " +
      "along the corpus's arrows -- P down to the special case, hardness up to the general one -- superseding what " +
      "is cited, and the problems that moves glow blue. An arrow turns red only where two claims of yours " +
      "disagree, or where one you called a restriction widens a field.</p></div>" +
      "</div>";

    fitMapCanvasSoon(els.viewSchedulingZoo);

    enableSzNodeDragging(els.viewSchedulingZoo.querySelector(".map-canvas"));
    els.viewSchedulingZoo.querySelectorAll(".sz-lens-btn").forEach((b) => {
      b.addEventListener("click", () => {
        SZ_LENS = SZ_LENS === b.dataset.lens ? null : b.dataset.lens;
        szApplyLens();
      });
    });

    // Click on an edge (either its thin visible line or its wide invisible
    // hit-area, both tagged the same way) opens the full "why does this
    // arrow exist" panel. Delegated once on the svg rather than per-edge --
    // this graph can have hundreds of edges.
    els.viewSchedulingZoo.querySelector(".map-edge-svg").addEventListener("click", (ev) => {
      const g = ev.target.closest(".sz-edge");
      if (!g) return;
      // An arrow the reader drew has no entry in the corpus to explain, so
      // clicking it reopens their own description of it instead.
      if (g.classList.contains("sz-user-edge")) {
        const edge = loadSzUserEdges()[+g.dataset.szUserEdge];
        if (edge) showDesignerReductionDialog(edge, +g.dataset.szUserEdge, SZ_EDGE_HOST);
        return;
      }
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
      // Arrows the reader drew here come along, if both their ends made it
      // onto the map -- copied, so editing them in the designer (where they
      // are saved with the map) doesn't rewrite the overview's set.
      const onMap = new Set(ids);
      designerUserEdges = loadSzUserEdges()
        .filter((e) => onMap.has(e.from) && onMap.has(e.to))
        .map((e) => Object.assign({}, e));
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
      // Arrows drawn by hand go into the export too, like the designer's --
      // they are part of the picture on screen.
      const visibleEdges = edgesAll.concat(loadSzUserEdges())
        .filter((ed) => livePositions[ed.from] && livePositions[ed.to]);
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
    els.viewSchedulingZoo.querySelector(".sz-submit-claims-btn").addEventListener("click", showSubmitClassificationsDialog);
    els.viewSchedulingZoo.querySelector(".sz-reset-claims-btn").addEventListener("click", showResetClassificationsDialog);
    szUpdateClaimsBar();
    els.viewSchedulingZoo.querySelector("#sz-add-arrow-btn").addEventListener("click", () => {
      SZ_ARROW_MODE = SZ_ARROW_MODE ? null : { from: null };
      SZ_ARROW_NOTICE = "";
      szUpdateArrowUi();
    });
    // Same escape hatch as the designer's, registered once for the page.
    if (!window.szArrowEscReady) {
      window.szArrowEscReady = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && SZ_ARROW_MODE && !els.viewSchedulingZoo.hidden && !document.querySelector(".designer-dialog-backdrop")) {
          SZ_ARROW_MODE = null;
          szUpdateArrowUi();
        }
      });
    }
    szUpdateArrowUi();
    // Last, so it can read the nodes' final positions out of the DOM.
    szRenderUserEdges();
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

  // A stack entry is one id, or an array of them when several nodes were
  // dragged out together -- one Undo then brings the whole set back, which
  // is what the reader means by "undo that".
  function szUndoHide() {
    if (!SZ_HIDDEN_STACK.length) return;
    const entry = SZ_HIDDEN_STACK.pop();
    const canvas = els.viewSchedulingZoo.querySelector(".map-canvas");
    [].concat(entry).forEach((id) => {
      SZ_HIDDEN_IDS.delete(id);
      setSzNodeHidden(canvas, id, false);
    });
    SZ_HIDDEN_REDO_STACK.push(entry);
    szUpdateHistoryButtons();
  }

  function szRedoHide() {
    if (!SZ_HIDDEN_REDO_STACK.length) return;
    const entry = SZ_HIDDEN_REDO_STACK.pop();
    const canvas = els.viewSchedulingZoo.querySelector(".map-canvas");
    [].concat(entry).forEach((id) => {
      SZ_HIDDEN_IDS.add(id);
      setSzNodeHidden(canvas, id, true);
    });
    SZ_HIDDEN_STACK.push(entry);
    szUpdateHistoryButtons();
  }

  // Restores every node hidden on the CURRENT layout at once, in place --
  // same reasoning as mapResetHidden: no re-render, so nothing else moves,
  // and it clears the redo stack (this is "start over", not "keep
  // stepping back"). Separate from the top-right Filter toggle, which only
  // concerns the search-based subset (SZ_FOCUS_IDS).
  function szResetHidden() {
    // Driven by SZ_HIDDEN_IDS, the actual set of hidden nodes, NOT by the
    // undo stack: a stack entry is one id or a whole array of them (a group
    // dragged out together), so walking the stack passed an array where an
    // id was expected and left those nodes hidden with no way back.
    if (!SZ_HIDDEN_IDS.size) return;
    const canvas = els.viewSchedulingZoo.querySelector(".map-canvas");
    SZ_HIDDEN_IDS.forEach((id) => setSzNodeHidden(canvas, id, false));
    SZ_HIDDEN_IDS = new Set();
    SZ_HIDDEN_STACK = [];
    SZ_HIDDEN_REDO_STACK = [];
    szUpdateHistoryButtons();
  }

  // ---- arrows drawn by hand on the overview ----------------------------
  // Everything here works IN PLACE, without re-rendering: this view lays
  // itself out from scratch on every render, so a redraw would undo any
  // dragging the reader has done and bake the current hidden set into a new
  // layout. Adding an arrow must not cost them that.

  // What showDesignerReductionDialog (and the conflict dialog) act on, so
  // the same two dialogs serve the designer's arrows and the overview's.
  const DESIGNER_EDGE_HOST = {
    edges: () => designerUserEdges,
    // The designer's arrows are saved with the map, not on their own.
    changed: () => {},
    rerender: () => renderDesign(),
    notice: (text) => { designerArrowNotice = text; },
  };
  const SZ_EDGE_HOST = {
    edges: () => loadSzUserEdges(),
    changed: () => storeSzUserEdges(),
    // Not just the arrows: the classes they carry have to be repainted.
    rerender: () => refreshClassificationViews(),
    notice: (text) => { SZ_ARROW_NOTICE = text; szUpdateArrowUi(); },
  };

  // "Send" / "Reset my classifications" appear as soon as there is anything
  // of the reader's own to send or throw away, and go again when there
  // isn't -- both without a redraw.
  function szUpdateClaimsBar() {
    const bar = els.viewSchedulingZoo.querySelector(".sz-claims-actions");
    if (!bar) return;
    const claims = Object.keys(loadUserClassifications()).length;
    const arrows = loadSzUserEdges().length + loadSzParamEdges().length;
    bar.hidden = !(claims || arrows || userDraftProblems().length);
    // Reset is about classifications (and, if asked, arrows). Drafted
    // problems belong to the maps they were drawn on, so they alone are
    // nothing for it to delete -- and "delete your 0 classifications" is
    // not a question worth asking.
    const reset = bar.querySelector(".sz-reset-claims-btn");
    if (reset) reset.hidden = !(claims || arrows);
  }

  // Reflects SZ_ARROW_MODE / SZ_ARROW_NOTICE onto the page: the button's
  // pressed state, the crosshair cursor, the glow on the chosen origin, the
  // floating instruction, and the one-line result underneath.
  function szUpdateArrowUi() {
    const view = els.viewSchedulingZoo;
    const btn = view.querySelector("#sz-add-arrow-btn");
    if (!btn) return;
    btn.setAttribute("aria-pressed", SZ_ARROW_MODE ? "true" : "false");
    const diagram = view.querySelector(".map-diagram");
    if (diagram) diagram.classList.toggle("arrow-mode", !!SZ_ARROW_MODE);
    view.querySelectorAll(".sz-node.arrow-origin").forEach((el) => el.classList.remove("arrow-origin"));
    if (SZ_ARROW_MODE && SZ_ARROW_MODE.from) {
      const el = view.querySelector('.sz-node[data-sz-id="' + cssEscape(SZ_ARROW_MODE.from) + '"]');
      if (el) el.classList.add("arrow-origin");
    }
    const old = view.querySelector(".designer-arrow-toast");
    if (old) old.remove();
    if (SZ_ARROW_MODE) {
      const toast = document.createElement("div");
      toast.className = "designer-arrow-toast";
      toast.setAttribute("role", "status");
      toast.innerHTML = "<b>" + (SZ_ARROW_MODE.from ? "Choose Destination Problem" : "Choose Origin Problem") +
        "</b><span>" + (SZ_ARROW_MODE.from ? "the special case the arrow points to" : "the more general problem the arrow starts from") +
        " &middot; Esc to cancel</span>";
      view.appendChild(toast);
    }
    const hint = view.querySelector(".sz-arrow-hint");
    if (hint) hint.textContent = SZ_ARROW_MODE ? "" : SZ_ARROW_NOTICE;
  }

  // The two-click gesture: origin (the general problem), then destination
  // (its special case). Clicking the origin again takes it back.
  function szArrowPick(id) {
    if (!SZ_ARROW_MODE.from) {
      SZ_ARROW_MODE.from = id;
      szUpdateArrowUi();
      return;
    }
    const from = SZ_ARROW_MODE.from;
    // A problem cannot be a special case of itself.
    if (id === from) { SZ_ARROW_MODE.from = null; szUpdateArrowUi(); return; }
    SZ_ARROW_MODE = null;
    if (loadSzUserEdges().some((e) => e.from === from && e.to === id)) {
      SZ_ARROW_NOTICE = "That arrow is already on the map.";
      szUpdateArrowUi();
      return;
    }
    szUpdateArrowUi();
    showDesignerReductionDialog({ from: from, to: id }, -1, SZ_EDGE_HOST);
  }

  // Redraws every hand-drawn arrow from the nodes' LIVE positions in the
  // DOM, so one function serves the first render, an edit, and a removal
  // (dragging is handled by updateEdgesFor, which finds these lines by the
  // same data-sz-from/to attributes the corpus arrows carry).
  //
  // Built with createElementNS rather than an HTML string: innerHTML on an
  // SVG element is not something to rely on across browsers.
  const SVG_NS = "http://www.w3.org/2000/svg";
  function szRenderUserEdges() {
    const view = els.viewSchedulingZoo;
    const canvas = view.querySelector(".map-canvas");
    const svg = canvas && canvas.querySelector(".map-edge-svg");
    if (!svg) return;
    szUpdateClaimsBar();
    svg.querySelectorAll("g.sz-user-edge").forEach((g) => g.remove());
    const boxOf = (id) => {
      const el = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(id) + '"]');
      if (!el || SZ_HIDDEN_IDS.has(id)) return null;
      const left = parseFloat(el.style.left), top = parseFloat(el.style.top);
      const halfW = el.offsetWidth / 2, halfH = el.offsetHeight / 2;
      return { cx: left + halfW, cy: top + halfH, halfW: halfW, halfH: halfH };
    };
    loadSzUserEdges().forEach((edge, i) => {
      // Skipped rather than dropped when an endpoint isn't on this map: the
      // arrow is still the reader's, it just has nothing to join here (a
      // filter is applied, or one end was dragged off the edge).
      const a = boxOf(edge.from), b = boxOf(edge.to);
      if (!a || !b) return;
      const conflict = !!designerArrowConflict(edge);
      const stroke = conflict ? SZ_EDGE_FLAGGED_COLOR : USER_CLASS_RING;
      const d = edgePathD(a, b, 3, 0, 0);
      const g = document.createElementNS(SVG_NS, "g");
      // `sz-edge` too, so hiding a node hides these along with the rest.
      g.setAttribute("class", "sz-edge sz-user-edge");
      g.dataset.szFrom = edge.from;
      g.dataset.szTo = edge.to;
      g.dataset.szUserEdge = String(i);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = "Added by you: " + szReductionSummary(edge) +
        (conflict ? " -- conflicts with The Scheduling Zoo's data" : "") + ". Click to edit or remove.";
      g.appendChild(title);
      ["sz-edge-hit", "sz-edge-visible"].forEach((cls) => {
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute("class", cls);
        line.dataset.szFrom = edge.from;
        line.dataset.szTo = edge.to;
        line.setAttribute("fill", "none");
        line.setAttribute("d", d);
        if (cls === "sz-edge-visible") {
          line.setAttribute("stroke", stroke);
          line.setAttribute("stroke-width", "2.4");
          // Dashed, so a claim never reads as a recorded reduction.
          line.setAttribute("stroke-dasharray", "7,4");
          line.setAttribute("marker-end", "url(#" + szArrowIdFor(stroke) + ")");
        }
        g.appendChild(line);
      });
      svg.appendChild(g);
    });
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
      // Both ends tokenized, sharing the heading's one tooltip -- the arrow
      // is exactly about which field differs, so being able to point at the
      // fields is worth more here than anywhere.
      szNotationHeadingHtml(
        szNotationPartsHtml(from) + ' <span class="notation-verb">generalizes</span> ' + szNotationPartsHtml(to)) +
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
    enableNotationTooltips(els.detailContent);
  }

  // Repaints every view that shows classifications, in place, as soon as one
  // changes -- the reader's claim travels through the inheritance rules, so
  // it can recolour problems anywhere on the map, not just the one clicked.
  // The overview's nodes are updated rather than re-rendered so that any
  // dragging the reader has done survives.
  function refreshClassificationViews() {
    SZ_EFFECTIVE = null;
    designerEffectiveCache = { key: null, classes: null };
    // Recomputed here, before ANY view is redrawn, rather than inside the
    // overview's branch below: the problem maps read the same classes (and
    // the same SZ_USER_AFFECTED, which computing them fills in), so leaving
    // it to whichever view happened to be open meant a claim made in a
    // problem map repainted that map from an empty cache.
    szEffectiveClasses();
    if (DATA_SZ && !els.viewSchedulingZoo.hidden) {
      const conflicts = new Set(szConflictingEdges().map((c) => c.from + "\u0000" + c.to));
      els.viewSchedulingZoo.querySelectorAll(".sz-node").forEach((el) => {
        const id = el.dataset.szId;
        applySzNodeStyle(el, SZ_EFFECTIVE[id]);
        el.classList.toggle("user-classified", !!userClassification(id, null));
        el.classList.toggle("user-affected", SZ_USER_AFFECTED.has(id));
      });
      els.viewSchedulingZoo.querySelectorAll("g.sz-edge").forEach((g) => {
        const from = g.getAttribute("data-sz-from"), to = g.getAttribute("data-sz-to");
        const line = g.querySelector(".sz-edge-visible");
        if (!line) return;
        const conflict = conflicts.has(from + "\u0000" + to);
        const claimTouched = !conflict && (
          userClassification(from, null) || userClassification(to, null) ||
          SZ_USER_AFFECTED.has(from) || SZ_USER_AFFECTED.has(to));
        if (conflict) {
          line.setAttribute("stroke", SZ_EDGE_FLAGGED_COLOR);
          line.setAttribute("stroke-width", "2.6");
          line.setAttribute("stroke-dasharray", "6,3");
          line.setAttribute("marker-end", "url(#" + szArrowIdFor(SZ_EDGE_FLAGGED_COLOR) + ")");
        } else if (claimTouched) {
          line.setAttribute("stroke", USER_CLASS_RING);
          line.setAttribute("stroke-width", "2");
          line.removeAttribute("stroke-dasharray");
          line.setAttribute("marker-end", "url(#" + szArrowIdFor(USER_CLASS_RING) + ")");
        } else {
          // Removing a claim or an arrow can leave an arrow with nothing to
          // say any more.
          line.setAttribute("stroke", MAP_EDGE_COLOR);
          line.setAttribute("stroke-width", "2");
          line.removeAttribute("stroke-dasharray");
          line.setAttribute("marker-end", "url(#" + szArrowIdFor(MAP_EDGE_COLOR) + ")");
        }
      });
      // A claim can put a hand-drawn arrow in (or out of) conflict, which is
      // the arrow's own colour -- redrawn from the live node positions, so
      // any dragging survives this.
      szRenderUserEdges();
    }
    if (!els.viewDesign.hidden) renderDesign();
  }

  // Shown when a claim disagrees with something already on the map. It is
  // never blocked -- an inconsistency the reader means to keep is allowed,
  // and the arrows that disagree turn red (see szConflictingEdges).
  function showClassificationConflictAlert(nodeId, conflicts) {
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<div class="designer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="classify-conflict-title">' +
      '<h3 id="classify-conflict-title">That contradicts ' +
      (conflicts.length === 1 ? "a published result" : conflicts.length + " published results") + "</h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.7rem">Either the classification is wrong, or you have a result ' +
      "worth writing up. Your claim has been kept and now supersedes the citations below, here and everywhere it follows " +
      "along the arrows. The problems it moved are glowing blue, and the arrows involved are red.</p>" +
      '<ul class="result-list">' +
      conflicts.slice(0, 6).map((c) =>
        "<li><b>" + escapeHtml(c.notation) + "</b> is cited as <b>" + escapeHtml(szClassLabel(c.cited)) +
        "</b>, but is now <b>" + escapeHtml(szClassLabel(c.now)) + "</b>" +
        (c.direct ? " because you classified it." : " because that follows from what you classified.") + "</li>").join("") +
      (conflicts.length > 6 ? "<li>and " + (conflicts.length - 6) + " more</li>" : "") +
      "</ul>" +
      '<div class="designer-dialog-actions">' +
      '<button type="button" class="map-history-btn" data-dialog="undo">Undo my classification</button>' +
      '<button type="button" class="map-history-btn designer-dialog-report" data-dialog="keep">Keep it</button>' +
      "</div></div>";
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.querySelector('[data-dialog="keep"]').addEventListener("click", close);
    backdrop.querySelector('[data-dialog="undo"]').addEventListener("click", () => {
      setUserClassification(nodeId, null, null);
      close();
      refreshClassificationViews();
      openSchedulingZooPanel(nodeId);
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-dialog="keep"]').focus();
  }

  // The form behind both classify buttons in the Scheduling Zoo panel: the
  // class pill next to the problem's notation, and each box in the
  // parameter diagram. `label` null means the problem's own classical
  // class, otherwise the parameter being classified.
  // ---- sending classifications to the site's author -------------------
  // The site is a static page with nowhere to POST to, so "submit" means
  // opening a prefilled issue on its repository: the reader presses the
  // button, GitHub's own form appears with everything already written, and
  // they decide whether to file it. Nothing leaves the browser until they do.
  const REPO_ISSUES_URL = "https://github.com/yuvalyitz/parameterized-scheduling-zoo/issues/new";
  // GitHub rejects very long URLs, so a big batch is trimmed in the body and
  // the JSON stays complete on the clipboard instead.
  const ISSUE_URL_LIMIT = 6000;

  function userClassificationList() {
    // The author's most useful column is what the site said before the
    // reader disagreed, so make sure the corpus-only reading exists.
    if (DATA_SZ && !SZ_EFFECTIVE_CORPUS) {
      SZ_EFFECTIVE_CORPUS = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, true);
    }
    const all = loadUserClassifications();
    // A classification can be about a problem the reader drafted, which the
    // corpus index knows nothing about -- without this its row was headed
    // by the internal draft id.
    const drafts = {};
    userDraftProblems().forEach((d) => { drafts[d.node.id] = d.node; });
    const rows = [];
    Object.keys(all).forEach((id) => {
      const notation = (szNodeIndex()[id] || {}).notation || (drafts[id] || {}).notation || id;
      const entry = all[id];
      if (entry.classical) {
        rows.push({ id: id, notation: notation, what: "classical", parameter: null, draft: !!drafts[id],
          classId: entry.classical.classId, label: szClassLabel(entry.classical.classId),
          // What it was before they disagreed: the corpus reading for a
          // corpus problem, and for a draft what the rules alone make of it.
          cited: drafts[id]
            ? szClassLabel(draftInferredClass(drafts[id], true))
            : SZ_EFFECTIVE_CORPUS ? szClassLabel(SZ_EFFECTIVE_CORPUS[id]) : null,
          source: entry.classical.source || "", note: entry.classical.note || "", at: entry.classical.at });
      }
      Object.keys(entry.params || {}).forEach((param) => {
        const claim = entry.params[param];
        const cls = classById(claim.classId);
        rows.push({ id: id, notation: notation, what: "parameterized", parameter: param,
          classId: claim.classId, label: cls ? cls.label : claim.classId, cited: null,
          source: claim.source || "", note: claim.note || "", at: claim.at });
      });
    });
    return rows;
  }

  function classificationIssueBody(rows) {
    const lines = ["Recorded on the Parameterized Scheduling Zoo and sent from the site.", ""];
    if (rows.length) {
      lines.push("| problem | claim | source | note |", "| --- | --- | --- | --- |");
      rows.forEach((r) => {
        const claim = r.parameter ? r.label + " for " + r.parameter : r.label +
          (r.cited ? (r.draft ? " (a problem they drafted; the rules give it " : " (this site currently says ") + r.cited + ")" : "");
        lines.push("| `" + r.notation + "` | " + claim + " | " + (r.source || "--") + " | " + (r.note || "--") + " |");
      });
    }
    const arrows = loadSzUserEdges();
    if (arrows.length) {
      lines.push("", "Reductions drawn by hand on the map (each says the second problem is a special case of the first):", "",
        "| general | special case | the reduction | note |", "| --- | --- | --- | --- |");
      arrows.forEach((e) => {
        const notation = (id) => ((szNodeIndex()[id] || {}).notation || id);
        lines.push("| `" + notation(e.from) + "` | `" + notation(e.to) + "` | " + szReductionSummary(e) + " | " + (e.note || "--") + " |");
      });
    }
    const drafts = userDraftProblems();
    if (drafts.length) {
      lines.push("", "Problems drafted in the designer -- written in The Scheduling Zoo's own notation, but not in the corpus:", "",
        "| problem | fields | class the rules give it | drafted on |", "| --- | --- | --- | --- |");
      drafts.forEach((d) => {
        // Always the rules' own answer here; where they classified it
        // themselves that claim is in the table above, with this as the
        // reading it overrode.
        lines.push("| `" + d.node.notation + "` | " + (draftFieldsSummary(d.node) || "--") + " | " +
          szClassLabel(draftInferredClass(d.node, true)) + " | " + (d.maps.join(", ") || "--") + " |");
      });
    }
    lines.push("", "<details><summary>The same thing as JSON</summary>", "",
      "```json", JSON.stringify(submissionJson(), null, 2), "```", "</details>");
    return lines.join("\n");
  }

  // Problems the reader DRAFTED: ones they wrote in The Scheduling Zoo's own
  // notation that the corpus doesn't have. Gathered from every saved problem
  // map plus whatever the designer is holding right now (a map may not have
  // been saved yet), de-duplicated by id -- the id is derived from the
  // notation, so the same problem drafted on two maps is one problem here.
  function userDraftProblems() {
    const byId = {};
    const add = (node, where) => {
      if (!node || !node.id) return;
      const row = byId[node.id] || (byId[node.id] = { node: node, maps: [] });
      if (where && row.maps.indexOf(where) === -1) row.maps.push(where);
    };
    loadSavedMaps().forEach((m) => {
      Object.keys(m.drafts || {}).forEach((id) => add(m.drafts[id], m.title || "untitled map"));
    });
    Object.keys(designerDraftNodes).forEach((id) => {
      add(designerDraftNodes[id], storyProblemIds.indexOf(id) !== -1 ? (designerMapTitle.trim() || "the designer, unsaved") : null);
    });
    return Object.keys(byId).map((id) => byId[id]);
  }

  // The class the reduction rules give a drafted problem, for ANY draft --
  // including one saved on a map that isn't currently open, which
  // designerClassOf can say nothing about (it only relates the drafts on
  // the map in front of the reader). Same two rules, against the corpus:
  // P travels down to a special case, hardness travels up from one.
  function draftInferredClass(node, ignoreClaim) {
    const claim = ignoreClaim ? null : userClassification(node.id, null);
    if (claim) return claim.classId;
    if (!DATA_SZ || !node.vector) return "unclaimed";
    szEffectiveClasses();
    let result = null;
    DATA_SZ.nodes.forEach((other) => {
      if (SZ_EFFECTIVE[other.id] === "P" && szVectorReduces(node.vector, other.vector)) result = "P";
    });
    if (result) return result;
    DATA_SZ.nodes.forEach((other) => {
      if (szVectorReduces(other.vector, node.vector)) result = strongerOf(result, inheritedContribution(SZ_EFFECTIVE[other.id]));
    });
    return result || "unclaimed";
  }

  // One drafted problem's fields, written the way its name is read.
  function draftFieldsSummary(node) {
    const tokens = szNotationTokens(node);
    if (!tokens) return "";
    return tokens.filter((t) => !t.sep && t.field)
      .map((t) => szFieldName(t.field).toLowerCase() + ": " + t.text).join("; ");
  }

  // Everything of the reader's own, in one object: what Copy as JSON puts on
  // the clipboard and what the issue body carries.
  function submissionJson() {
    const arrows = loadSzUserEdges();
    const drafts = userDraftProblems();
    const out = { classifications: loadUserClassifications() };
    if (arrows.length) out.arrows = arrows;
    if (loadSzParamEdges().length) out.parameterArrows = loadSzParamEdges();
    // The whole node, not just the name: it carries the field assignment
    // the name was built from, which is what makes it reproducible here.
    if (drafts.length) out.draftProblems = drafts.map((d) => d.node);
    return out;
  }

  function showSubmitClassificationsDialog() {
    const rows = userClassificationList();
    const arrows = loadSzUserEdges();
    const drafts = userDraftProblems();
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    const body = classificationIssueBody(rows);
    const issueTitle = rows.length
      ? "Classifications from a reader (" + rows.length +
        (arrows.length ? " + " + arrows.length + " arrows" : "") +
        (drafts.length ? " + " + drafts.length + " drafted problems" : "") + ")"
      : arrows.length
        ? "Reductions drawn by a reader (" + arrows.length + ")"
        : "Problems drafted by a reader (" + drafts.length + ")";
    const url = REPO_ISSUES_URL + "?title=" + encodeURIComponent(issueTitle) +
      "&labels=" + encodeURIComponent("classification") + "&body=" + encodeURIComponent(body);
    const tooLong = url.length > ISSUE_URL_LIMIT;
    backdrop.innerHTML =
      '<div class="designer-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-title">' +
      '<h3 id="submit-title">Send ' +
      [rows.length ? rows.length + " classification" + (rows.length === 1 ? "" : "s") : "",
        arrows.length ? arrows.length + " hand-drawn arrow" + (arrows.length === 1 ? "" : "s") : "",
        drafts.length ? drafts.length + " drafted problem" + (drafts.length === 1 ? "" : "s") : ""]
        .filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1") + " to the author</h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.6rem">These are yours, kept in this browser. Sending ' +
      "opens a new issue on this site's repository with them filled in -- nothing is sent until you press submit there.</p>" +
      '<ul class="result-list">' +
      rows.slice(0, 12).map((r) =>
        "<li><b>" + escapeHtml(r.notation) + "</b> &mdash; " + escapeHtml(r.label) +
        (r.parameter ? " for " + escapeHtml(r.parameter) : "") +
        (r.cited ? ' <span class="detail-class-aside">(' + (r.draft ? "the rules give it " : "this site says ") +
          escapeHtml(r.cited) + ")</span>" : "") +
        (r.source ? ' <span class="detail-class-aside">&middot; ' + escapeHtml(r.source) + "</span>" : "") +
        "</li>").join("") +
      (rows.length > 12 ? "<li>and " + (rows.length - 12) + " more</li>" : "") +
      arrows.slice(0, 6).map((e) => {
        const notation = (id) => ((szNodeIndex()[id] || {}).notation || id);
        return "<li><b>" + escapeHtml(notation(e.from)) + " &rarr; " + escapeHtml(notation(e.to)) +
          '</b> <span class="detail-class-aside">your arrow &middot; ' + escapeHtml(szReductionSummary(e)) + "</span></li>";
      }).join("") +
      (arrows.length > 6 ? "<li>and " + (arrows.length - 6) + " more arrows</li>" : "") +
      drafts.slice(0, 6).map((d) =>
        "<li><b>" + escapeHtml(d.node.notation) + '</b> <span class="detail-class-aside">your drafted problem &middot; ' +
        escapeHtml(szClassLabel(draftInferredClass(d.node, true))) + " by the rules" +
        (d.maps.length ? " &middot; on " + escapeHtml(d.maps.join(", ")) : "") + "</span></li>").join("") +
      (drafts.length > 6 ? "<li>and " + (drafts.length - 6) + " more drafted problems</li>" : "") +
      "</ul>" +
      (tooLong
        ? '<p class="designer-relations-empty">That is too much to carry in a link, so the issue will open with a ' +
          "short note -- use Copy as JSON and paste it in there.</p>"
        : "") +
      '<div class="designer-dialog-actions">' +
      '<button type="button" class="map-history-btn" data-dialog="cancel">Close</button>' +
      '<button type="button" class="map-history-btn" data-dialog="copy">Copy as JSON</button>' +
      '<a class="map-history-btn designer-dialog-report" data-dialog="send" target="_blank" rel="noopener" href="' +
      escapeHtml(tooLong
        ? REPO_ISSUES_URL + "?title=" + encodeURIComponent(issueTitle) +
          "&labels=" + encodeURIComponent("classification") +
          "&body=" + encodeURIComponent("Paste the JSON copied from the site here.")
        : url) + '">Open an issue &rarr;</a>' +
      "</div></div>";
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.querySelector('[data-dialog="cancel"]').addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const copyBtn = backdrop.querySelector('[data-dialog="copy"]');
    copyBtn.addEventListener("click", () => {
      copyTextToClipboard(JSON.stringify(submissionJson(), null, 2));
      copyBtn.textContent = "Copied";
    });
    document.body.appendChild(backdrop);
  }

  // The live state of the overview's filter controls, saved from outside
  // renderSchedulingZoo (which has its own saveSzFilterState over the
  // controls it just wired). Without this, a redraw triggered from anywhere
  // else snaps every switch back to whatever was saved the last time Apply
  // was pressed.
  function saveSzFilterStateNow() {
    const input = els.viewSchedulingZoo.querySelector("#sz-filter");
    if (!input || !szValueDropdowns || !szSettingsControl) return;
    SZ_LAST_FILTERS = {
      q: input.value,
      machineEnv: szValueDropdowns[0].getSelected(),
      objective: szValueDropdowns[1].getSelected(),
      settings: szSettingsControl.getSelected(),
    };
  }

  // The way out of everything the reader has recorded here. Destructive and
  // not undoable, so it says exactly what will go and asks first. Hand-drawn
  // arrows go with it too: they are recorded in this same browser by this
  // same reader, so a reset that left them behind would still show claims
  // the reader asked to delete.
  function showResetClassificationsDialog() {
    const rows = userClassificationList();
    const arrows = loadSzUserEdges().concat(loadSzParamEdges());
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    const parts = [];
    if (rows.length) parts.push(rows.length + " classification" + (rows.length === 1 ? "" : "s"));
    if (arrows.length) parts.push(arrows.length + " arrow" + (arrows.length === 1 ? "" : "s"));
    backdrop.innerHTML =
      '<div class="designer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-claims-title">' +
      '<h3 id="reset-claims-title">Delete your ' +
      (parts.length ? parts.join(" and ") : "work here") + "?</h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.7rem">Everything you have classified or drawn ' +
      "(→+) in this browser goes, and every problem it moved falls back to what The Scheduling Zoo's data says. " +
      "This cannot be undone -- if you want to keep a copy, close this and use <b>Send my classifications</b> " +
      "&rarr; Copy as JSON first.</p>" +
      '<div class="designer-dialog-actions">' +
      '<button type="button" class="map-history-btn" data-dialog="cancel">Keep them</button>' +
      '<button type="button" class="map-history-btn designer-dialog-report" data-dialog="reset">Delete</button>' +
      "</div></div>";
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.querySelector('[data-dialog="cancel"]').addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('[data-dialog="reset"]').addEventListener("click", () => {
      storeUserClassifications({});
      // Same invalidation setUserClassification does: the inherited classes
      // are cached and every one of them may now be different.
      SZ_EFFECTIVE = null;
      SZ_PARAM_CLAIMS = null;
      designerEffectiveCache = { key: null, classes: null };
      SZ_USER_EDGES = [];
      storeSzUserEdges();
      SZ_PARAM_EDGES = [];
      storeSzParamEdges();
      close();
      closeDetail();
      els.detailOverlay.hidden = true;
      // A full redraw, unlike the in-place refresh a single claim gets: the
      // two buttons at the bottom of the diagram are gone now, and so is
      // every blue ring and glow on the map.
      saveSzFilterStateNow();
      renderSchedulingZoo();
      if (!els.viewDesign.hidden) renderDesign();
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-dialog="cancel"]').focus();
  }

  // Reflects SZ_PT_ARROW onto the open panel: the button's pressed state,
  // the crosshair, the glow on the chosen origin, the floating instruction,
  // and the one-line notice underneath (SZ_PT_ARROW_NOTICE).
  let SZ_PT_ARROW_NOTICE = "";
  function szUpdatePtArrowUi() {
    const root = els.detailContent;
    const btn = root.querySelector(".sz-pt-add-arrow");
    const wrap = root.querySelector(".param-tree-wrap");
    if (els.detailPanel.hidden || !btn) SZ_PT_ARROW = null;
    const old = document.querySelector(".sz-pt-arrow-toast");
    if (old) old.remove();
    if (!btn) return;
    btn.setAttribute("aria-pressed", SZ_PT_ARROW ? "true" : "false");
    if (wrap) wrap.classList.toggle("arrow-mode", !!SZ_PT_ARROW);
    root.querySelectorAll("g.sz-pt-node.arrow-origin").forEach((g) => g.classList.remove("arrow-origin"));
    if (SZ_PT_ARROW && SZ_PT_ARROW.from) {
      const g = Array.from(root.querySelectorAll("g.sz-pt-node")).find((x) => x.dataset.szPtId === SZ_PT_ARROW.from);
      if (g) g.classList.add("arrow-origin");
    }
    if (SZ_PT_ARROW) {
      const toast = document.createElement("div");
      toast.className = "designer-arrow-toast sz-pt-arrow-toast";
      toast.setAttribute("role", "status");
      toast.innerHTML = "<b>" + (SZ_PT_ARROW.from ? "Choose the bounding parameter" : "Choose the parameter to bound") +
        "</b><span>" + (SZ_PT_ARROW.from
          ? "the one " + escapeHtml(SZ_PT_ARROW.from) + " is bounded by a function of"
          : "the more general one, that the arrow starts from") + " &middot; Esc to cancel</span>";
      document.body.appendChild(toast);
    }
    const hint = root.querySelector(".sz-pt-arrow-hint");
    if (hint) hint.textContent = SZ_PT_ARROW ? "" : SZ_PT_ARROW_NOTICE;
  }
  if (!window.szPtArrowEscReady) {
    window.szPtArrowEscReady = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && SZ_PT_ARROW && !document.querySelector(".designer-dialog-backdrop")) {
        SZ_PT_ARROW = null;
        szUpdatePtArrowUi();
      }
    });
  }
  // The two-click gesture: the parameter to bound, then the one that bounds
  // it. Clicking the origin again takes it back.
  function szPtArrowPick(label) {
    if (!SZ_PT_ARROW.from) {
      SZ_PT_ARROW.from = label;
      szUpdatePtArrowUi();
      return;
    }
    const from = SZ_PT_ARROW.from;
    if (label === from) { SZ_PT_ARROW.from = null; szUpdatePtArrowUi(); return; }
    const nodeId = SZ_PT_ARROW.nodeId, notation = SZ_PT_ARROW.notation;
    SZ_PT_ARROW = null;
    szUpdatePtArrowUi();
    if (loadSzParamEdges().some((e) => canonicalParamLabel(e.from) === from && canonicalParamLabel(e.to) === label)) {
      SZ_PT_ARROW_NOTICE = "You already drew " + from + " → " + label + ".";
      szUpdatePtArrowUi();
      return;
    }
    if (paramSubsetOf(paramParts(from), paramParts(label))) {
      SZ_PT_ARROW_NOTICE = "The diagram already has " + from + " → " + label + ": " + label + " bounds every measure " + from + " bounds.";
      szUpdatePtArrowUi();
      return;
    }
    showParamArrowDialog({ from: from, to: label, note: "" }, -1, nodeId, notation);
  }

  // `index` -1 adds the arrow; otherwise it edits loadSzParamEdges()[index].
  function showParamArrowDialog(edge, index, nodeId, notation) {
    const editing = index >= 0;
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<form class="designer-dialog designer-reduction-dialog" role="dialog" aria-modal="true" aria-labelledby="param-arrow-title">' +
      '<h3 id="param-arrow-title">You claim that <span class="designer-reduction-problem">' + escapeHtml(edge.to) +
      "</span> bounds <span class=\"designer-reduction-problem\">" + escapeHtml(edge.from) + "</span></h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.7rem">Whenever ' + escapeHtml(edge.to) + " is bounded, " +
      escapeHtml(edge.from) + " is bounded by a function of it. So an FPT or XP result for " + escapeHtml(edge.from) +
      " holds for " + escapeHtml(edge.to) + ", and W-hardness for " + escapeHtml(edge.to) + " holds for " + escapeHtml(edge.from) +
      " -- for the cited results here and for your own classifications. This is a statement about the two parameters, " +
      "not about " + escapeHtml(notation) + ", so it applies on every problem where both appear. Kept in this browser.</p>" +
      '<label class="designer-reduction-note">Source or note <small>(optional)</small>' +
      '<input type="text" class="sz-filter" name="note" placeholder="e.g. #p ≤ p_max since the distinct values are integers" value="' + escapeHtml(edge.note || "") + '"></label>' +
      '<div class="designer-dialog-actions">' +
      (editing ? '<button type="button" class="map-history-btn designer-reduction-remove">Remove arrow</button>' : "") +
      '<button type="button" class="map-history-btn" data-dialog="cancel">Cancel</button>' +
      '<button type="submit" class="map-history-btn designer-dialog-report">' + (editing ? "Save" : "Add arrow") + "</button>" +
      "</div></form>";
    const form = backdrop.querySelector("form");
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    form.querySelector('[data-dialog="cancel"]').addEventListener("click", close);
    const redraw = () => { if (!els.detailPanel.hidden) openSchedulingZooPanel(nodeId); szUpdatePtArrowUi(); };
    const remove = form.querySelector(".designer-reduction-remove");
    if (remove) remove.addEventListener("click", () => {
      loadSzParamEdges().splice(index, 1);
      storeSzParamEdges();
      SZ_PT_ARROW_NOTICE = "Removed " + edge.from + " → " + edge.to + ".";
      close();
      redraw();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const next = { from: edge.from, to: edge.to, note: form.note.value.trim() };
      const list = loadSzParamEdges();
      if (editing) list[index] = next;
      else list.push(next);
      storeSzParamEdges();
      SZ_PT_ARROW_NOTICE = (editing ? "Updated " : "Added ") + next.from + " → " + next.to + ".";
      close();
      redraw();
    });
    document.body.appendChild(backdrop);
    form.note.focus();
  }

  function showClassifyDialog(nodeId, label, notation) {
    const isClassical = label === null || label === undefined;
    const classes = isClassical
      // "online" is not a claim anyone can make about a problem: it follows
      // from the problem's own notation (online-rj in the release-time
      // field), so it is not offered as something to classify it as.
      ? DATA.classicalClasses.filter((c) => c.id !== "unclaimed" && c.id !== "online")
      : DATA.complexityClasses;
    const existing = userClassification(nodeId, label) || {};
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<form class="designer-dialog" role="dialog" aria-modal="true" aria-labelledby="classify-title">' +
      '<h3 id="classify-title">' +
      (isClassical
        ? "Classify <span class=\"designer-reduction-problem\">" + escapeHtml(notation) + "</span>"
        : "Classify <span class=\"designer-reduction-problem\">" + escapeHtml(notation) +
          "</span> for parameter <span class=\"designer-reduction-problem\">" + escapeHtml(label) + "</span>") +
      "</h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.6rem">Kept in this browser only, and shown as your own ' +
      "claim rather than a cited result. A source is optional.</p>" +
      "<fieldset><legend>Class</legend>" +
      classes.map((c) =>
        '<label class="designer-reduction-option"><input type="radio" name="cls" value="' + escapeHtml(c.id) + '"' +
        (c.id === existing.classId ? " checked" : "") + "><span><b>" + escapeHtml(c.label) + "</b></span></label>").join("") +
      "</fieldset>" +
      '<label class="designer-reduction-note">Source <small>(optional -- paper, DOI, or "own proof")</small>' +
      '<input type="text" class="sz-filter" name="source" value="' + escapeHtml(existing.source || "") + '"></label>' +
      '<label class="designer-reduction-note">Note <small>(optional)</small>' +
      '<input type="text" class="sz-filter" name="note" value="' + escapeHtml(existing.note || "") + '"></label>' +
      '<div class="designer-dialog-actions">' +
      (existing.classId ? '<button type="button" class="map-history-btn classify-remove">Remove my classification</button>' : "") +
      '<button type="button" class="map-history-btn" data-dialog="cancel">Cancel</button>' +
      '<button type="submit" class="map-history-btn designer-dialog-report">Save</button>' +
      "</div></form>";
    const form = backdrop.querySelector("form");
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    form.querySelector('[data-dialog="cancel"]').addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const removeBtn = form.querySelector(".classify-remove");
    if (removeBtn) removeBtn.addEventListener("click", () => {
      setUserClassification(nodeId, label, null);
      close();
      refreshClassificationViews();
      openSchedulingZooPanel(nodeId);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const picked = form.querySelector('input[name="cls"]:checked');
      if (!picked) return;
      setUserClassification(nodeId, label, {
        classId: picked.value,
        source: form.source.value.trim(),
        note: form.note.value.trim(),
        at: new Date().toISOString(),
      });
      close();
      refreshClassificationViews();
      openSchedulingZooPanel(nodeId);
      // Only a classical claim can contradict an arrow; a parameterized one
      // says nothing about the classical class the arrows are judged on.
      if (isClassical) {
        const overridden = szOverriddenByClaims();
        if (overridden.length) showClassificationConflictAlert(nodeId, overridden);
      }
    });
    document.body.appendChild(backdrop);
    const first = form.querySelector('input[name="cls"]:checked') || form.querySelector('input[name="cls"]');
    if (first) first.focus();
  }

  // The Scheduling Zoo's own wording for what one value of one field means,
  // from notation.xml's <choice explanation=...> (see the notation_form loop
  // in convert_for_pzoo.py). Its text, not ours -- this site never
  // re-describes the corpus's own vocabulary.
  function szChoiceExplanation(field, value) {
    const f = szFormField(field);
    const c = f && f.choices.find((x) => x.value === value);
    return (c && c.explanation) || "";
  }

  // A problem's name broken into the parts it is built from: each token of
  // the alpha|beta|gamma heading paired with the field it fills and that
  // field's value, so every one of them can be explained on its own.
  //
  // Driven by the node's own fields rather than by parsing the string:
  // `notation` is BUILT from `vector` / `settings` / `preemption`, so
  // matching a displayed token back to the (field, value) behind it is
  // exact rather than a guess at what "p-batch(∞)" might be. Checked over
  // the whole corpus: all 719 names split with nothing left unmatched, and
  // every resulting token has an explanation.
  //
  // Returns a flat list of { sep } separators and { text, field, value }
  // parts, or null when the name isn't the three-slot form (then the panel
  // just prints it as it always did).
  function szNotationTokens(n) {
    const slots = String(n.notation || "").split("|");
    if (slots.length !== 3) return null;
    const out = [];
    const part = (field, value, text) => out.push({ text: text, field: field, value: value });
    const sep = (s) => out.push({ sep: s });
    const vec = n.vector || {};

    // alpha: the machine environment, its machine count written straight
    // after it ("P2"), then any ";"-separated extras (robot, server).
    const alphaSegs = slots[0].split(";");
    const head = alphaSegs[0];
    if (head === "1") {
      // A single machine is one idea, not "parallel machines, of which 1":
      // notation.xml has its own "1" choice, with its own explanation.
      part("type", "1", head);
    } else if (n.machineEnv && head.indexOf(n.machineEnv) === 0) {
      part("type", n.machineEnv, n.machineEnv);
      const count = head.slice(n.machineEnv.length);
      if (count) part("number of machines", vec["number of machines"], count);
    } else {
      part(null, null, head);
    }
    alphaSegs.slice(1).forEach((seg) => {
      sep(";");
      const field = ["robot", "server"].find((f) => vec[f] && szChoiceLabel(f, vec[f]) === seg);
      part(field || null, field ? vec[field] : null, seg);
    });

    // beta: the settings, in the order the name writes them. Preemption is
    // kept apart from `settings` on the node, but it is a beta field like
    // any other here.
    sep("|");
    if (slots[1]) {
      const byLabel = {};
      Object.keys(n.settings || {}).forEach((f) => { byLabel[szChoiceLabel(f, n.settings[f])] = f; });
      if (n.preemption) byLabel[szChoiceLabel("preemption", n.preemption)] = "preemption";
      slots[1].split(";").forEach((seg, i) => {
        if (i) sep(";");
        const field = byLabel[seg];
        part(field || null, field ? (field === "preemption" ? n.preemption : n.settings[field]) : null, seg);
      });
    }
    sep("|");
    part("Objective function", vec["Objective function"], slots[2]);
    return out;
  }

  // One problem's name as hoverable (and focusable, and tappable) tokens.
  // Falls back to the plain name whenever it can't be split.
  function szNotationPartsHtml(n) {
    const tokens = szNotationTokens(n);
    if (!tokens) return escapeHtml(n.notation);
    return tokens.map((t) => t.sep
      ? '<span class="notation-sep">' + escapeHtml(t.sep) + "</span>"
      : '<span class="notation-part" tabindex="0" role="button"' +
        ' data-field="' + escapeHtml(t.field || "") + '" data-value="' + escapeHtml(t.value || "") + '">' +
        escapeHtml(t.text) + "</span>").join("");
  }

  // A heading built out of those tokens, with ONE tooltip under the whole
  // heading rather than one per token -- no clamping against the panel's
  // edge, and nothing to reposition when a long name wraps. `inner` lets a
  // heading hold more than one name (the arrow panel's "X generalizes Y"),
  // all of them sharing that one tooltip.
  function szNotationHeadingHtml(inner) {
    return '<h3 class="detail-notation">' + inner +
      '<span class="notation-tip" role="status" hidden></span></h3>';
  }

  function enableNotationTooltips(root) {
    root.querySelectorAll(".detail-notation").forEach((head) => {
      const tip = head.querySelector(".notation-tip");
      if (!tip) return;
      const clear = () => head.querySelectorAll(".notation-part.active").forEach((x) => x.classList.remove("active"));
      const show = (el) => {
        const field = el.dataset.field;
        const explanation = field ? szChoiceExplanation(field, el.dataset.value) : "";
        // Even with no prose to show, naming the field the token fills is
        // worth saying -- it is half of what the reader is asking.
        tip.innerHTML = "<b>" + escapeHtml(el.textContent) + "</b>" +
          (field ? ' <span class="notation-tip-field">' + escapeHtml(szFieldName(field).toLowerCase()) + "</span>" : "") +
          (explanation ? "<br>" + escapeHtml(explanation) : "");
        tip.hidden = false;
        clear();
        el.classList.add("active");
      };
      const hide = () => { tip.hidden = true; clear(); };
      head.querySelectorAll(".notation-part").forEach((el) => {
        el.addEventListener("mouseenter", () => show(el));
        el.addEventListener("mouseleave", hide);
        el.addEventListener("focus", () => show(el));
        el.addEventListener("blur", hide);
        // For touch, where there is no hover: tap to open, tap again to close.
        el.addEventListener("click", () => (el.classList.contains("active") ? hide() : show(el)));
      });
    });
  }

  // Where a corpus problem's inherited class comes from: the nearest special
  // cases whose cited class gives it (hardness travels up), or the nearest
  // generalizations whose cited algorithm does (P and pseudo-polynomial
  // travel down). Nearest first, stopping at each witness; up to three are
  // named, the rest counted.
  function szClassWitnesses(id) {
    if (!SZ_EFFECTIVE_CORPUS) SZ_EFFECTIVE_CORPUS = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, true);
    const eff = SZ_EFFECTIVE_CORPUS[id];
    const byId = szNodeIndex();
    const own = (x) => (byId[x] || {}).classicalClass || "unclaimed";
    if (!eff || eff === "unclaimed" || (own(id) === eff)) return { direction: null, items: [], more: 0 };
    const up = ["strongly-NP-hard", "NP-hard-unresolved", "weakly-NP-hard"].includes(eff);
    const qualifies = up
      ? (x) => eff === "strongly-NP-hard" ? own(x) === "strongly-NP-hard" : ["NP-hard-unresolved", "weakly-NP-hard", "strongly-NP-hard"].includes(own(x))
      : (x) => eff === "P" ? own(x) === "P" : ["weakly-NP-hard", "pseudo-open", "P"].includes(own(x));
    const next = up ? (x) => DATA_SZ.edges.filter((e) => e.from === x).map((e) => e.to)
                    : (x) => DATA_SZ.edges.filter((e) => e.to === x).map((e) => e.from);
    const seen = new Set([id]);
    let frontier = [id];
    const found = [];
    while (frontier.length && found.length < 12) {
      const layer = [];
      frontier.forEach((x) => next(x).forEach((y) => {
        if (seen.has(y)) return;
        seen.add(y);
        if (qualifies(y)) found.push({ id: y, notation: (byId[y] || {}).notation || y, classId: own(y) });
        else layer.push(y);
      }));
      frontier = layer;
    }
    return { direction: up ? "up" : "down", items: found.slice(0, 3), more: Math.max(0, found.length - 3) };
  }

  // Opens for a problem the reader DRAFTED as readily as for a corpus one
  // -- same panel, minus the citations it cannot have. Without this, the
  // one kind of problem whose classification needs explaining (it is
  // entirely inferred) was the one kind you could not open.
  function openSchedulingZooPanel(nodeId) {
    const n = DATA_SZ.nodes.find((x) => x.id === nodeId) || designerDraftNodes[nodeId];
    if (!n) return;
    const isOnline = !!(n.vector && n.vector["release time"] === "online-r_j");
    // A positive approximation line is tagged so the Approximable lens can
    // light it here as it does on the map -- same test as szNodeApproxTier.
    const approxCat = SZ_RESULT_CATEGORIES.find((c) => c.name === "Approximation");
    // The same folded cards as the parameterized results: one card per
    // result ("NP-hard", "in P_pseudo", a ratio), its first paper on the
    // summary line, every paper that states it inside with its title, and
    // where a line came from if it was carried here (Karp 1972 and Lawler
    // & Moore 1969 both show 1||ΣwjUj NP-hard: one card, two lines).
    const resultLi = (rs) => {
      const r = rs[0];
      const approxCls = r.kind === "upper" && isApprox(r) ? " result-approx" : "";
      const line = (x) =>
        '<li class="result-' + x.kind + approxCls + '">' + szCiteLink(x) +
        (x.title ? ' <span class="sz-res-title">' + escapeHtml(x.title) + "</span>" : "") +
        (x.inheritedFrom
          ? '<div class="sz-res-path">inherited from ' + (x.direction === "down" ? "the more general " : "its special case ") +
            escapeHtml(szNotationOf(x.inheritedFrom)) +
            (x.via && x.via.length > 1 ? " along " + escapeHtml(x.via.map(szNotationOf).join(" → ")) : "") +
            "; every arrow keeps the objective value as it is</div>"
          : "") + "</li>";
      return '<details class="sz-param-card sz-res-card result-' + r.kind + '"><summary class="sz-param-head">' +
        '<span class="sz-param-name">' + szClassicalTerm(r.bound) + "</span>" +
        '<span class="sz-param-why">' + escapeHtml(szShortCite(r)) + (rs.length > 1 ? " +" + (rs.length - 1) : "") +
        (r.inheritedFrom ? ", inherited" : "") + "</span>" +
        '<span class="sz-param-count">' + rs.length + "</span></summary>" +
        '<div class="sz-param-body"><ul class="result-list">' + rs.map(line).join("") + "</ul></div></details>";
    };
    // Group the lines that say the same thing about the same problem.
    const groupResults = (list) => {
      const out = [], byKey = {};
      list.forEach((r) => {
        const key = szClassicalTerm(r.bound) + "\u0001" + (r.inheritedFrom || "");
        if (!byKey[key]) { byKey[key] = []; out.push(byKey[key]); }
        if (!byKey[key].some((x) => x.bibkey === r.bibkey)) byKey[key].push(r);
      });
      return out;
    };
    // Own results first, then the approximation results this site carried
    // here along the arrows (inheritedApprox) -- each says where it came
    // from, see szCitationHtml.
    // Approximation lines (a ratio, a scheme, an inapproximability
    // threshold) are their own section: a real result, but not a claim
    // about the problem's class.
    const isApprox = (r) => approxCat.values.some((v) => v.re.test(r.bound || ""));
    const allLower = n.classical.filter((r) => r.kind === "lower").concat((n.inheritedApprox || []).filter((r) => r.kind === "lower"));
    const allUpper = n.classical.filter((r) => r.kind === "upper").concat((n.inheritedApprox || []).filter((r) => r.kind === "upper"));
    const lower = allLower.filter((r) => !isApprox(r)), upper = allUpper.filter((r) => !isApprox(r));
    const approxLower = allLower.filter(isApprox), approxUpper = allUpper.filter(isApprox);
    // A problem in P is FPT for every parameter: the boxes say so and the
    // results are shown for the record.
    const inP = szEffectiveClasses()[n.id] === "P";
    const baseParams = szAllParams(n);
    const forest = buildParamForest(baseParams.concat(szParamDerivedResults(baseParams)));
    const paramTreeHtml = buildParamTreeHtml(forest, n.id, inP);
    const paramDiagram = buildParamDiagramHtml(forest, n.id, inP);
    // Every class the citations put on this problem, plus any the reader has
    // claimed: a union, so a claim never drops a class the sources still
    // assert from the legend.
    const paramUsedClasses = new Set(forest.labels
      .flatMap((l) => [inP ? "FPT" : bestParamComplexityClass(forest.byLabel[l]), (userParamClass(n.id, l) || {}).classId])
      .filter(Boolean));
    const swatch = (bg, color) =>
      '<span class="legend-swatch" style="width:0.7em;height:0.7em;display:inline-block;border-radius:2px;vertical-align:middle;margin-right:0.3em;background:' +
      bg + ";border:1.5px solid " + color + '"></span>';
    const paramLegendHtml = paramUsedClasses.size
      ? '<p class="sz-legend-line">' +
        DATA.complexityClasses.filter((c) => paramUsedClasses.has(c.id)).map((c) =>
          "<span>" + swatch(c.opacity ? mixWithPanelBg(c.color, c.opacity) : classBg(c, "var(--panel-bg)", 2), c.color) + escapeHtml(c.label) + "</span>"
        ).join("") +
        (!inP && forest.labels.some((l) => szParamAlsoXp(forest.byLabel[l]))
          ? "<span>" + swatch(classById("W1").color, classById("W1").color) + "W-hard and in XP</span>"
          : "") + "</p>"
      : "";

    // ---- the classical class, three readings of it ----
    szEffectiveClasses();
    const mine = userClassification(n.id, null);
    const mineClass = mine ? classicalClassById(mine.classId) : null;
    if (!SZ_EFFECTIVE_CORPUS) SZ_EFFECTIVE_CORPUS = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, true);
    const szClassId = SZ_EFFECTIVE_CORPUS[n.id];
    // "Cited" only when the class shown IS the cited one: a problem with a
    // pseudo-polynomial algorithm of its own and NP-hard special cases is
    // weakly NP-hard by both, and says where the hardness comes from.
    const isDirect = n.classicalClass && n.classicalClass !== "unclaimed" && n.classicalClass === szClassId;
    const szOwnClass = classicalClassById(szClassId);
    const szOwnLabel = !szClassId || szClassId === "unclaimed" ? "open" : (szOwnClass ? szOwnClass.label : szClassId);
    // Open, but W-hard for some parameter: not in P unless FPT = W[1] (a
    // polynomial algorithm is an FPT one with f(k) = 1), which is not the
    // same as NP-hard -- said in the notes, not folded into the class.
    const wHardParams = (!szClassId || szClassId === "unclaimed" || szClassId === "open")
      ? szAllParams(n).filter((r) => /W\[\d/.test(r.bound || "")).map((r) => r.param)
      : [];
    const classRow = (label, pill, trailing) =>
      '<div class="detail-class-row"><span class="detail-class-label">' + label + "</span>" + pill +
      (trailing ? ' <span class="detail-class-aside">' + trailing + "</span>" : "") + "</div>";
    const draftClassId = n.draft ? designerClassOf(n.id) : null;
    const draftClass = n.draft ? classicalClassById(draftClassId) : null;
    const draftReason = n.draft ? designerClassReason(n.id) : null;
    // A corpus problem the reader did not classify, but whose class a claim
    // or an arrow of theirs moved (it glows blue on the map): its own line,
    // above the corpus reading it supersedes.
    const movedClassId = !mine && !n.draft ? activeClassOf(n.id) : null;
    const moved = movedClassId && movedClassId !== szClassId && !(movedClassId === "unclaimed" && !szClassId);
    const movedClass = moved ? classicalClassById(movedClassId) : null;
    const touching = moved
      ? (els.viewDesign.hidden ? loadSzUserEdges() : designerModelEdges()).filter((e) => e.from === n.id || e.to === n.id)
      : [];
    const arrowName = (e) => escapeHtml(((storyNodeById(e.from) || {}).notation || e.from) + " → " + ((storyNodeById(e.to) || {}).notation || e.to));
    // An inherited class names the problems it comes from, each a link.
    const jump = (w) => '<a href="javascript:void(0)" class="sz-jump" data-sz-jump="' + escapeHtml(w.id) + '">' + escapeHtml(w.notation) + "</a>";
    const witnesses = !n.draft && !isDirect && szClassId && szClassId !== "unclaimed" ? szClassWitnesses(n.id) : { items: [] };
    const witnessText = witnesses.items.length
      ? (witnesses.direction === "up" ? "inherited: it generalizes " : "inherited: it is a special case of ") +
        witnesses.items.map((w) => jump(w) + " (" + escapeHtml(szClassLabel(w.classId)) + ")").join(", ") +
        (witnesses.more ? " and " + witnesses.more + " more" : "") +
        (szClassId === "weakly-NP-hard" && n.classicalClass === "pseudo-open" ? "; the pseudo-polynomial algorithm is its own" : "")
      : "";
    const ccPillHtml =
      (mine
        ? classRow("your classification",
            '<button type="button" class="class-pill classify-btn classify-mine" title="Click to change or remove it" style="' +
            classPillStyle(mineClass) + '">' + escapeHtml(mineClass ? mineClass.label : mine.classId) + "</button>",
            "unverified" + (mine.source ? " &middot; " + escapeHtml(mine.source) : ""))
        : "") +
      (moved
        ? classRow("from your claims",
            '<span class="class-pill" style="' + classPillStyle(movedClass) + '">' +
            escapeHtml(movedClassId === "unclaimed" ? "open" : (movedClass ? movedClass.label : movedClassId)) + "</span>",
            (touching.length
              ? "follows from your arrow " + touching.slice(0, 2).map(arrowName).join(" and ")
              : "carried along the arrows from a classification or an arrow of yours") + " &mdash; supersedes the reading below")
        : "") +
      (n.draft
        ? classRow("from this map",
            '<button type="button" class="class-pill classify-btn" title="Classify this problem yourself" style="' +
            classPillStyle(draftClass) + '">' +
            escapeHtml(!draftClassId || draftClassId === "unclaimed" ? "open" : (draftClass ? draftClass.label : draftClassId)) + "</button>",
            draftReason ? escapeHtml(draftReason.summary) : "nothing on this map settles it yet")
        : classRow(mine || moved ? "cited" : "classical",
            '<button type="button" class="class-pill classify-btn" title="Classify this problem yourself" style="' +
            classPillStyle(szOwnClass) + '">' + escapeHtml(szOwnLabel) + "</button>",
            szClassId === "online"
              ? "measured by competitive ratio, not by a complexity class"
              : wHardParams.length
                ? "but not in P unless FPT = W[1] &mdash; see the notes"
                : isDirect
                  ? "cited"
                  : witnessText));

    // ---- sections, and the table of contents over them ----
    const sections = [];
    const sec = (id, title, html, extraClass) => {
      if (!html) return "";
      sections.push({ id: id, title: title });
      return '<section class="sz-sec' + (extraClass ? " " + extraClass : "") + '" id="' + id + '">' +
        (title ? "<h4>" + title + "</h4>" : "") + html + "</section>";
    };
    const classHtml = sec("sz-sec-class", "Classification", ccPillHtml +
      (n.draft
        ? '<p class="sz-note">A problem <b>you drafted</b>: not in the corpus, so nothing is cited about it. Its name is ' +
          "well formed in The Scheduling Zoo's notation, so the reduction rules place it among the corpus problems, " +
          "and that is where the class above comes from.</p>"
        : ""));
    const paramsHtml = sec("sz-sec-params", "Parameters", paramDiagram
      ? (inP ? '<p class="sz-note">This problem is in P, so it is FPT for every parameter; the results are kept for the record.</p>' : "") +
        '<div class="sz-pt-arrow-bar"><button type="button" class="map-history-btn sz-pt-add-arrow" aria-pressed="false" ' +
        'title="Add an arrow between two parameters: click the more general one, then the one that bounds it">→+</button>' +
        '<span class="sz-arrow-hint sz-pt-arrow-hint"></span></div>' +
        paramDiagram.html + paramLegendHtml
      : "");
    const classicalHtml = sec("sz-sec-classical", isOnline ? "Competitive ratios" : "Classical results",
      (lower.length ? "<h5>" + (isOnline ? "What no algorithm can beat" : "Hardness") + "</h5>" + groupResults(lower).map(resultLi).join("") : "") +
      (upper.length ? "<h5>" + (isOnline ? "What an algorithm achieves" : "Algorithms") + "</h5>" + groupResults(upper).map(resultLi).join("") : ""));
    const approxHtml = sec("sz-sec-approx", "Approximation",
      (approxLower.length ? "<h5>Inapproximability</h5>" + groupResults(approxLower).map(resultLi).join("") : "") +
      (approxUpper.length ? "<h5>Algorithms</h5>" + groupResults(approxUpper).map(resultLi).join("") : ""));
    const paramResultsHtml = sec("sz-sec-param-results", "Parameterized results", paramTreeHtml, "detail-params");
    const notesHtml = sec("sz-sec-notes", "Notes",
      (wHardParams.length
        ? '<p class="sz-note"><b>Open, but not in P unless FPT = W[1].</b> Nothing cited classifies this problem, but it is ' +
          "W-hard for " + escapeHtml(wHardParams.slice(0, 3).join(", ")) + (wHardParams.length > 3 ? " and others" : "") +
          ", and a polynomial-time algorithm would be an FPT algorithm with f(k) = 1. That is weaker than NP-hardness " +
          "(W-hardness comes from fpt-reductions); only para-NP-hardness settles the classical question.</p>"
        : "") +
      (isOnline
        ? '<p class="sz-note"><b>An online problem.</b> Jobs are revealed at their release times, so the results are ' +
          "<b>competitive ratios</b> against the best offline schedule, and they hold unconditionally: adversary " +
          "arguments, not P ≠ NP. No arrow joins it to an offline problem, since the same instances with less " +
          "information are not a special case of anything.</p>"
        : ""));
    const draftHtml = draftReason ? sec("sz-sec-draft", "", draftReasonHtml(draftReason)) : "";
    const sourceHtml = sec("sz-sec-source", "", n.draft ? "" :
      '<p>Data: <a href="https://schedulingzoo.lip6.fr/" target="_blank" rel="noopener">The Scheduling Zoo</a> ' +
      "(Christoph Dürr and contributors). The classes are this site's reading of its bibliography; see the " +
      '<a href="#/docs">documentation</a>.</p>', "sz-source");
    const tocHtml = '<nav class="sz-toc" aria-label="Sections">' +
      sections.filter((x) => x.title).map((x) => '<a href="javascript:void(0)" data-sz-toc="' + x.id + '">' + x.title + "</a>").join("") + "</nav>";

    // .sz-panel carries the overview's lens (see szApplyLens) so the panel
    // lights the same kind of result the map is lighting.
    els.detailContent.innerHTML =
      '<div class="sz-panel"' + (SZ_LENS ? ' data-lens="' + SZ_LENS + '"' : "") + ">" +
      szNotationHeadingHtml(szNotationPartsHtml(n)) + tocHtml +
      classHtml + paramsHtml + classicalHtml + approxHtml + paramResultsHtml + notesHtml + draftHtml + sourceHtml +
      "</div>";
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    setPanelMinWidth(paramDiagram ? paramDiagram.width : 0);
    if (paramDiagram) enableSzParamDiagramDragging(els.detailContent.querySelector(".param-tree-wrap"), n.id, n.notation);
    const ptArrowBtn = els.detailContent.querySelector(".sz-pt-add-arrow");
    if (ptArrowBtn) {
      // Reopening the panel (a redraw after an arrow) keeps a notice, never
      // a half-drawn arrow.
      if (SZ_PT_ARROW && SZ_PT_ARROW.nodeId !== n.id) SZ_PT_ARROW = null;
      ptArrowBtn.addEventListener("click", () => {
        SZ_PT_ARROW = SZ_PT_ARROW ? null : { nodeId: n.id, notation: n.notation, from: null };
        szUpdatePtArrowUi();
      });
      szUpdatePtArrowUi();
    }
    els.detailContent.querySelectorAll(".classify-btn").forEach((b) =>
      b.addEventListener("click", () => showClassifyDialog(n.id, null, n.notation)));
    // Section links scroll the panel (a real #anchor would change the
    // route); problem links open that problem's panel in place.
    els.detailContent.querySelectorAll("[data-sz-toc]").forEach((a) => a.addEventListener("click", () => {
      const target = els.detailContent.querySelector("#" + a.dataset.szToc);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    els.detailContent.querySelectorAll("[data-sz-jump]").forEach((a) => a.addEventListener("click", () => openSchedulingZooPanel(a.dataset.szJump)));
    // A lens unfolds the cards it lights.
    if (SZ_LENS === "params") els.detailContent.querySelectorAll("#sz-sec-param-results .sz-param-card").forEach((d) => { d.open = true; });
    if (SZ_LENS === "approx") els.detailContent.querySelectorAll("#sz-sec-approx .sz-param-card").forEach((d) => { d.open = true; });
    // A [n] badge unfolds its line under the card's lines.
    els.detailContent.querySelectorAll("[data-sz-badge]").forEach((b) => b.addEventListener("click", () => {
      const d = els.detailContent.querySelector("#" + CSS.escape(b.dataset.szBadge));
      if (d) { d.hidden = !d.hidden; b.classList.toggle("is-open", !d.hidden); }
    }));
    enableNotationTooltips(els.detailContent);
  }

  // Every schedzoo parameterized result is tagged with a combined-parameter
  // label like "m" or "#p+#d+#r" (several measures bounded together). Build
  // a forest by set-containment of those "+"-joined token sets -- purely
  // structural (just which label's token set is a subset of which other),
  // the results themselves are carried along it first (szParamDerivedResults).
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
    // parentOf picks ONE parent so the nested text list shows each label
    // once; parentsOf keeps every immediate one, and the diagram draws all
    // of them (m+pmax hangs under both m and pmax, not just m).
    const parentOf = {}, parentsOf = {};
    labels.forEach((b) => {
      const candidates = labels.filter((a) => a !== b && isProperSubset(a, b));
      const immediate = candidates.filter((a) => !candidates.some((c) => c !== a && isProperSubset(a, c)));
      immediate.sort();
      parentsOf[b] = immediate;
      parentOf[b] = immediate.length ? immediate[0] : null;
    });
    const childrenOf = {};
    labels.forEach((l) => (childrenOf[l] = []));
    labels.forEach((l) => { if (parentOf[l]) childrenOf[parentOf[l]].push(l); });
    const roots = labels.filter((l) => !parentOf[l]).sort();
    return { byLabel, labels, parentOf, parentsOf, childrenOf, roots };
  }

  function szParamAnchor(label) {
    return "sz-param-" + String(label).replace(/[^a-zA-Z0-9]+/g, "-");
  }
  // "Hermelin, Karhi, Pinedo & Shabtay (2021)"; four or more authors is
  // "Hermelin et al. (2021)".
  // BibTeX writes "Lawler, E.L. and Moore, J.M." (surname first) but some
  // entries are "J. K. Lenstra, D. B. Shmoys and É. Tardos" (a comma-
  // separated list, surname last): a part before a comma that is several
  // words, or ends in an initial, is a whole name, not a surname.
  function szShortCite(r) {
    const surnameOf = (name) => (name.trim().split(/\s+/).pop() || "").replace(/\.$/, "");
    // "J. K. Lenstra": an initial before the last word. "Rinnooy Kan" has none.
    const isWholeName = (head) => head.split(/\s+/).slice(0, -1).some((w) => /\.$/.test(w) || w.length === 1);
    const names = String(r.author || "").split(/\s+and\s+/).flatMap((a) => {
      a = a.trim();
      if (!a.includes(",")) return [surnameOf(a)];
      const head = a.split(",")[0].trim();
      return isWholeName(head) ? a.split(",").map(surnameOf) : [head];
    }).filter(Boolean);
    const who = !names.length ? "" : names.length > 3 ? names[0] + " et al."
      : names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
    return who + (r.year ? " (" + r.year + ")" : "");
  }
  function szCiteLink(r) {
    const full = escapeHtml([r.author, r.year ? "(" + r.year + ")" : "", r.title].filter(Boolean).join(" "));
    return r.url
      ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener" title="' + full + '">' + escapeHtml(szShortCite(r)) + "</a>"
      : '<span title="' + full + '">' + escapeHtml(szShortCite(r)) + "</span>";
  }

  // A classical result as a term, not a sentence: "is NP-hard" and "is in
  // P" lose their verb, "is Ppseudo" and "is in Ppseudo" (the corpus
  // writes both) are one "in P_pseudo" with a real subscript. Returns HTML.
  function szClassicalTerm(bound) {
    let b = String(bound || "").trim().replace(/^is (in )?(?=P(pseudo)?$)/i, "in ").replace(/^is /i, "");
    return escapeHtml(b).replace(/\bPpseudo\b/g, "P<sub>pseudo</sub>");
  }

  // A parameterized result in the vocabulary of the field, not the
  // corpus's phrasing of it: "is in P" for a fixed value of the parameter
  // is XP, "is fixed parameter tractable" is FPT. Qualifiers survive
  // ("strongly", "even if #w=1"); the phrase as cited stays in the tooltip.
  function szParamTerm(r) {
    const b = String(r.bound || "").trim();
    let m;
    if (r.complexityClass === "FPT" && /^is fixed[- ]parameter tractable$/i.test(b)) return "FPT";
    if (r.complexityClass === "XP" && /^is (in )?P$/i.test(b)) return "XP";
    if (r.complexityClass === "XP" && /^is (in )?Ppseudo$/i.test(b)) return "XP, pseudo-polynomial";
    if ((m = b.match(/^is (strongly )?(W\[\d\]-hard)(.*)$/i))) return (m[1] || "") + m[2] + m[3];
    if (r.complexityClass === "paraNP") return /complete/i.test(b) ? "para-NP-complete" : "para-NP-hard";
    return b.replace(/^is /i, "");
  }

  // One card per parameter, folded: the name, its class, and where that
  // class comes from on one line; open it for the results. Inside, one
  // line per side -- the hardness, the algorithm -- naming the best class
  // and the paper it is taken from; every other line that supports or
  // weakens it (the same result reached by containment from #d+#p, an XP
  // algorithm under an FPT one) is a [n] badge: hover for what it says,
  // click for the full line. The cards follow the forest's order and
  // indent with it; the diagram above draws the structure.
  function buildParamTreeHtml(forest, nodeId, inP) {
    if (!forest.labels.length) return "";
    const arrowText = (cb) => cb.from + " → " + cb.to;
    // Where a group's lines come from, in words (plain text): inherited
    // from ..., cited here, by containment from ..., along your arrow ...
    function pathParts(label, g) {
      const cont = [], arrows = [];
      let own = false;
      g.paths.forEach((r) => {
        if (!r.carriedBy) own = true;
        else if (r.carriedBy.kind === "arrow") { const t = arrowText(r.carriedBy) + " from " + r.derivedFrom; if (!arrows.includes(t)) arrows.push(t); }
        else if (!cont.includes(r.derivedFrom)) cont.push(r.derivedFrom);
      });
      const parts = [];
      const r0 = g.r;
      if (r0.inheritedFrom) {
        parts.push("inherited from " + (r0.direction === "down" ? "the more general " : "its special case ") + szNotationOf(r0.inheritedFrom) +
          (r0.via && r0.via.length > 1 ? " along " + r0.via.map(szNotationOf).join(" → ") : ""));
      }
      if (own && (cont.length || arrows.length)) parts.push("cited for " + label);
      if (cont.length) parts.push("by containment from " + cont.join(", "));
      if (arrows.length) parts.push("along your arrow" + (arrows.length > 1 ? "s " : " ") + arrows.join("; "));
      return parts;
    }
    // The line to show for a class: cited on this problem for this very
    // parameter first, then carried from another parameter of this
    // problem, then inherited from another problem, then the reader's
    // arrows.
    const originRank = (g) => g.paths.some((r) => !r.carriedBy) ? (g.r.inheritedFrom ? 2 : 0) : (g.paths.some((r) => r.carriedBy.kind === "containment") ? 1 : 3);
    // A one-line answer to "why this class": the sources of the lines that
    // establish it, two at most.
    function whyText(groups, best) {
      const srcs = [];
      groups.filter((g) => g.r.complexityClass === best).sort((a, b) => originRank(a) - originRank(b)).forEach((g) => {
        g.paths.forEach((r) => {
          const t = r.inheritedFrom ? "from " + szNotationOf(r.inheritedFrom)
            : r.carriedBy ? (r.carriedBy.kind === "arrow" ? "along your arrow" : "from " + r.derivedFrom)
            : szShortCite(r);
          if (!srcs.includes(t)) srcs.push(t);
        });
      });
      return srcs.length ? srcs.slice(0, 2).join(", ") + (srcs.length > 2 ? " +" + (srcs.length - 2) : "") : "";
    }
    function renderLabel(label, depth) {
      const rs = forest.byLabel[label];
      const kids = forest.childrenOf[label].slice().sort();
      const mine = nodeId ? userParamClass(nodeId, label) : null;
      const mineCls = mine ? classById(mine.classId) : null;
      const best = bestParamComplexityClass(rs);
      const shownBest = inP ? "FPT" : best;
      const bestCls = shownBest ? classById(shownBest) : null;
      const alsoXp = !inP && szParamAlsoXp(rs);
      // One group per distinct result: same citation, class and origin
      // problem, whatever path brought it.
      const groups = [], byKey = {};
      rs.forEach((r) => {
        const key = [r.kind, r.complexityClass || "", r.bibkey || r.bound, r.inheritedFrom || ""].join("\u0001");
        let g = byKey[key];
        if (!g) { g = byKey[key] = { r: r, paths: [] }; groups.push(g); }
        g.paths.push(r);
      });
      groups.forEach((g) => { g.term = szParamTerm(g.r); g.parts = pathParts(label, g); });
      // One line per side. Hardness first, as in the classical section.
      const sides = [
        { kind: "lower", best: ["paraNP", "W2", "W1"].find((c) => rs.some((r) => r.complexityClass === c)) || null },
        { kind: "upper", best: ["FPT", "XP"].find((c) => rs.some((r) => r.complexityClass === c)) || null },
      ];
      let badgeNo = 0;
      const details = [];
      const badge = (g) => {
        badgeNo += 1;
        const tip = g.term + " — " + szShortCite(g.r) + (g.parts.length ? " · " + g.parts.join(" · ") : "") +
          (g.term !== g.r.bound ? " (cited as: " + g.r.bound + ")" : "");
        const id = szParamAnchor(label) + "-c" + badgeNo;
        details.push('<div class="sz-res-detail result-' + g.r.kind + '" id="' + id + '" hidden>' +
          "[" + badgeNo + "] " + '<span class="sz-res-bound">' + escapeHtml(g.term) + '</span> <span class="sz-res-cite">— ' + szCiteLink(g.r) + "</span>" +
          (g.parts.length ? '<div class="sz-res-path">' + escapeHtml(g.parts.join(" · ")) + "</div>" : "") + "</div>");
        return '<button type="button" class="sz-cite-badge" data-sz-badge="' + id + '" title="' + escapeHtml(tip) + '">[' + badgeNo + "]</button>";
      };
      const lines = sides.map((side) => {
        const mine_ = groups.filter((g) => g.r.kind === side.kind);
        if (!mine_.length) return "";
        const top = mine_.filter((g) => g.r.complexityClass === side.best).sort((a, b) => originRank(a) - originRank(b));
        const primary = top[0] || mine_[0];
        const rest = mine_.filter((g) => g !== primary);
        return '<div class="sz-res-line result-' + side.kind + '">' +
          '<span class="sz-res-bound">' + escapeHtml(primary.term) + "</span>" +
          ' <span class="sz-res-cite">— ' + szCiteLink(primary.r) + "</span>" +
          (primary.parts.length ? ' <span class="sz-res-path">' + escapeHtml(primary.parts.join(" · ")) + "</span>" : "") +
          (rest.length ? ' <span class="sz-badges">' + rest.map(badge).join("") + "</span>" : "") + "</div>";
      }).join("");
      const why = inP ? "in P" : whyText(groups, best);
      const head =
        '<summary class="sz-param-head"><span class="sz-param-name">' + escapeHtml(label) + "</span>" +
        (bestCls
          ? '<span class="class-pill" style="' + classPillStyle(bestCls, alsoXp ? { xpBound: true } : null) + '">' +
            escapeHtml(bestCls.label) + (alsoXp ? " and in XP" : "") + "</span>"
          : '<span class="sz-param-why">recorded, not classified</span>') +
        (mine
          ? '<span class="sz-param-yours" title="' + (mine.direct ? "your classification" : "follows from your classification") + '">you: ' +
            '<span class="class-pill" style="' + classPillStyle(mineCls) + '">' + escapeHtml(mineCls ? mineCls.label : mine.classId) + "</span></span>"
          : "") +
        (why ? '<span class="sz-param-why">' + escapeHtml(why) + "</span>" : "") +
        '<span class="sz-param-count">' + groups.length + "</span></summary>";
      const claim = mine
        ? '<div class="detail-class-row"><span class="detail-class-label">' +
          (mine.direct ? "your classification" : "follows from your classification") + "</span>" +
          '<span class="class-pill" style="' + classPillStyle(mineCls) + '">' + escapeHtml(mineCls ? mineCls.label : mine.classId) + "</span>" +
          '<span class="detail-class-aside">' +
          (mine.direct
            ? "unverified" + (mine.source ? " &middot; " + escapeHtml(mine.source) : "")
            : mine.viaParam
            ? "of " + escapeHtml(mine.viaParam) + " on this problem, which bounds " + (PARAM_UPPER_BOUNDS.includes(mine.classId) ? "less" : "more")
            : "of " + escapeHtml((szNodeIndex()[mine.from] || {}).notation || mine.from) + ", carried along arrows that keep " + escapeHtml(label) + " bounded") +
          "</span></div>"
        : "";
      return '<details class="sz-param-card" id="' + szParamAnchor(label) + '" style="margin-left:' + Math.min(depth, 3) * 0.5 + 'rem">' +
        head + '<div class="sz-param-body">' + claim + lines + details.join("") + "</div></details>" +
        kids.map((k) => renderLabel(k, depth + 1)).join("");
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
  const SZ_PT_RING = 5; // the band of background inside an "inset" box (see classBg): the box's 6px side padding, less the stroke
  // The diagram wraps rather than grow past this: the panel's default
  // width (see .detail-panel) less its paddings (setPanelMinWidth).
  const SZ_PT_MAX_DIAGRAM_W = 260, SZ_PT_LINE_GAP = 10, SZ_PT_MAX_PER_LINE = 3;

  // A param label can carry several citations (different papers). Green
  // wins: an FPT result settles the parameter, whatever else is recorded
  // for it. Otherwise hardness outranks XP (which then fills the box, see
  // szParamAlsoXp), and among hardness results the strongest wins. A
  // citation this site's classifier couldn't confidently place
  // (approximation ratios, ad-hoc ETH runtimes, ...) contributes nothing
  // here -- shown in the text list below regardless.
  const SZ_PARAM_CLASS_RANK = { FPT: 5, paraNP: 4, W2: 3, W1: 2, XP: 1 };
  function bestParamComplexityClass(rs) {
    let best = null;
    rs.forEach((r) => {
      if (r.complexityClass && (!best || SZ_PARAM_CLASS_RANK[r.complexityClass] > SZ_PARAM_CLASS_RANK[best])) best = r.complexityClass;
    });
    return best;
  }

  // W[1]- or W[2]-hard AND in XP for the same parameter. Both are true at
  // once -- no FPT algorithm unless FPT = W[1], yet nothing worse than
  // n^f(k) -- and together they say more than either does, so the box keeps
  // the hardness outline and takes the XP fill (see classPillStyle's
  // xpBound) instead of being drawn as plain hardness by the hardness-wins
  // rule above (P|Mj|ΣwjZj is strongly W[1]-hard in m AND in XP in m).
  // No other pair can coexist: para-NP-hard excludes XP unless P = NP, and
  // FPT excludes W-hardness unless FPT = W[1].
  function szParamAlsoXp(rs) {
    const best = bestParamComplexityClass(rs);
    return (best === "W1" || best === "W2") && rs.some((r) => r.complexityClass === "XP");
  }

  function buildParamDiagramHtml(forest, nodeId, inP) {
    const ids = forest.labels;
    if (!ids.length) return null;
    const edgeList = ids.flatMap((id) => forest.parentsOf[id].map((p) => ({ from: p, to: id })));
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
    let width = SZ_PT_MARGIN * 2 + (maxCol ? colX[maxCol] + colWidth[maxCol] : 0);
    let height = SZ_PT_MARGIN * 2 + maxRow * SZ_PT_ROW_H + SZ_PT_NODE_H;
    const rowSizes = {};
    ids.forEach((id) => { rowSizes[row[id]] = (rowSizes[row[id]] || 0) + 1; });
    if (width <= SZ_PT_MAX_DIAGRAM_W && Math.max(...Object.values(rowSizes)) <= SZ_PT_MAX_PER_LINE) {
      // Columns: a child sits under its parent, arrows run straight.
      ids.forEach((id) => {
        const w = widthOf[id];
        pos[id] = { left: SZ_PT_MARGIN + colX[col[id]] + (colWidth[col[id]] - w) / 2, top: SZ_PT_MARGIN + row[id] * SZ_PT_ROW_H, w, h: SZ_PT_NODE_H };
      });
    } else {
      // Too wide for the panel, or too many in a row (five unrelated
      // parameters side by side): each row wraps into lines of at most
      // SZ_PT_MAX_PER_LINE, every line centred, lines of one row set closer
      // than the rows themselves. The hard parameters go first, so they
      // land on the upper line.
      const inner = SZ_PT_MAX_DIAGRAM_W - 2 * SZ_PT_MARGIN;
      const hardness = { paraNP: 0, W2: 1, W1: 2, XP: 3, FPT: 4 };
      const rankOf = (id) => {
        const own = nodeId ? userParamClass(nodeId, id) : null;
        const c = own ? own.classId : inP ? "FPT" : bestParamComplexityClass(forest.byLabel[id]);
        return c in hardness ? hardness[c] : 5;
      };
      const lines = [];
      for (let r = 0; r <= maxRow; r++) {
        const members = ids.filter((id) => row[id] === r).sort((a, b) => rankOf(a) - rankOf(b) || col[a] - col[b]);
        if (!members.length) continue;
        let line = [], lw = 0;
        members.forEach((id) => {
          const add = (line.length ? SZ_PT_COL_GAP : 0) + widthOf[id];
          if (line.length && (lw + add > inner || line.length >= SZ_PT_MAX_PER_LINE)) { lines.push({ ids: line, last: false }); line = []; lw = 0; }
          line.push(id);
          lw += (line.length > 1 ? SZ_PT_COL_GAP : 0) + widthOf[id];
        });
        lines.push({ ids: line, last: true });
      }
      const lineW = (l) => l.ids.reduce((sum, id) => sum + widthOf[id], 0) + SZ_PT_COL_GAP * (l.ids.length - 1);
      const maxLine = Math.max(...lines.map(lineW));
      let y = SZ_PT_MARGIN;
      lines.forEach((l, i) => {
        let x = SZ_PT_MARGIN + (maxLine - lineW(l)) / 2;
        l.ids.forEach((id) => { pos[id] = { left: x, top: y, w: widthOf[id], h: SZ_PT_NODE_H }; x += widthOf[id] + SZ_PT_COL_GAP; });
        if (i < lines.length - 1) y += l.last ? SZ_PT_ROW_H : SZ_PT_NODE_H + SZ_PT_LINE_GAP;
      });
      width = SZ_PT_MARGIN * 2 + maxLine;
      height = y + SZ_PT_NODE_H + SZ_PT_MARGIN;
    }

    const arrowId = "sz-param-tree-arrow";
    const claimArrowId = "sz-param-tree-arrow-claim";
    const ptMarker = (id, fill) => '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="' + STEALTH_ARROW_PATH + '" fill="' + fill + '" /></marker>';
    const userArrowId = "sz-param-tree-arrow-user";
    const defs = "<defs>" + ptMarker(arrowId, MAP_EDGE_COLOR) + ptMarker(claimArrowId, USER_CLASS_RING) +
      ptMarker(userArrowId, "#fcc419") + "</defs>";
    // The reader's own arrows between parameters, where both ends are on
    // this diagram: dashed, so a claim never reads as containment, with a
    // wide invisible twin to click. Not part of the layout (an arrow may
    // point against the containment), drawn over it.
    const ptBox = (id) => pos[id] && { cx: pos[id].left + pos[id].w / 2, cy: pos[id].top + pos[id].h / 2, halfW: pos[id].w / 2, halfH: pos[id].h / 2 };
    const ptUserEdges = loadSzParamEdges().map((e) => ({ from: canonicalParamLabel(e.from), to: canonicalParamLabel(e.to) }));
    const ptPortOf = edgePorts(edgeList.concat(ptUserEdges), ptBox);
    const userLinesSvg = loadSzParamEdges().map((e, i) => {
      const fromL = canonicalParamLabel(e.from), toL = canonicalParamLabel(e.to);
      const a = ptBox(fromL), b = ptBox(toL);
      if (!a || !b) return "";
      const port = ptPortOf({ from: fromL, to: toL });
      const ends = ' data-sz-pt-from="' + escapeHtml(fromL) + '" data-sz-pt-to="' + escapeHtml(toL) +
        '" data-pa="' + port.pa + '" data-pb="' + port.pb + '" fill="none" d="' + edgePathD(a, b, 3, port.pa, port.pb) + '"';
      return '<g class="sz-pt-user-edge" data-sz-pt-user-edge="' + i + '"><title>' +
        escapeHtml("Your arrow: " + e.from + " is bounded by a function of " + e.to + (e.note ? " (" + e.note + ")" : "") + ". Click to edit or remove.") +
        '</title><path class="sz-pt-user-edge-hit"' + ends + ' /><path' + ends + ' stroke="#fcc419" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#' + userArrowId + ')" /></g>';
    }).join("");

    const linesSvg = edgeList.map((e) => {
      const a = ptBox(e.from), b = ptBox(e.to);
      if (!a || !b) return "";
      const port = ptPortOf(e);
      const d = edgePathD(a, b, 3, port.pa, port.pb);
      // Blue when either end carries one of the reader's classifications --
      // the same blue that rings the boxes, so an arrow reading "this is
      // yours" matches the boxes it joins.
      const claimed = nodeId && (userParamClass(nodeId, e.from) || userParamClass(nodeId, e.to));
      return '<path data-sz-pt-from="' + escapeHtml(e.from) + '" data-sz-pt-to="' + escapeHtml(e.to) +
        '" data-pa="' + port.pa + '" data-pb="' + port.pb + '" fill="none" d="' + d +
        '" stroke="' + (claimed ? USER_CLASS_RING : MAP_EDGE_COLOR) + '" stroke-width="' + (claimed ? "2" : "1.5") +
        '" marker-end="url(#' + (claimed ? claimArrowId : arrowId) + ')" />';
    }).join("");

    const nodesSvg = ids.map((id) => {
      const rs = forest.byLabel[id];
      // The reader's own classification wins in their own browser, and is
      // drawn with a dashed outline so it never passes for a cited result.
      const ownClaim = nodeId ? userParamClass(nodeId, id) : null;
      const classId = ownClaim ? ownClaim.classId : inP ? "FPT" : bestParamComplexityClass(rs);
      const cls = classId ? classById(classId) : null;
      // W[1]/W[2]-hard with a cited XP result fills solid: the outline says
      // hard, the fill says also in XP -- the same encoding Problem Maps
      // uses for a result with an xpBound. Plain outline would read as
      // "hard, no known n^f(k) algorithm", which is not what is known here.
      const alsoXp = !ownClaim && !inP && szParamAlsoXp(rs);
      const filled = cls && (cls.fill || alsoXp);
      // An upper bound on its own (at most XP): the colour in the middle
      // inside a band of background -- see classBg. With W-hardness too the
      // box is solid.
      const inset = cls && cls.fill === "inset" && !alsoXp;
      const bg = inset ? "var(--panel-bg)" : cls && cls.opacity ? mixWithPanelBg(cls.color, cls.opacity) : filled ? cls.color : "var(--panel-bg)";
      const border = cls ? cls.color : "#868e96";
      const dash = cls && cls.border === "dashed" ? ' stroke-dasharray="3,2"' : "";
      const textColor = filled && !cls.opacity ? fillTextColor(cls) : cls && (filled || cls.opacity) ? "#111" : "var(--fg)";
      const p = pos[id];
      const title = id + (cls ? " — " + cls.label : rs.some((r) => r.kind === "lower") || rs.some((r) => r.kind === "upper") ? " — result recorded, not classified into FPT/XP/W-hierarchy (see list below)" : "") +
        (alsoXp ? " — and in XP: polynomial for each fixed value" : "") +
        (inP && !ownClaim ? " — trivially: the problem is in P" : "") +
        (ownClaim
          ? ownClaim.direct
            ? " (yours, unverified" + (ownClaim.source ? ": " + ownClaim.source : "") + ")"
            : " (follows from your classification of " +
              (ownClaim.viaParam || (szNodeIndex()[ownClaim.from] || {}).notation || ownClaim.from) + ")"
          : "") +
        (nodeId ? " — click to classify" : "");
      return '<g class="sz-pt-node' + (nodeId ? " sz-pt-classify" : "") + '" data-sz-pt-id="' + escapeHtml(id) + '" data-x="' + p.left + '" data-y="' + p.top + '" transform="translate(' + p.left + "," + p.top + ')">' +
        "<title>" + escapeHtml(title) + "</title>" +
        // Blue ring OUTSIDE the box, wider than it, exactly as on the map:
        // the class still owns the fill and the border, blue means "mine".
        (ownClaim
          ? '<rect x="-3.5" y="-3.5" width="' + (p.w + 7) + '" height="' + (p.h + 7) + '" rx="8" fill="none" stroke="' +
            USER_CLASS_RING + '" stroke-width="3"' + (ownClaim.direct ? "" : ' stroke-opacity="0.45"') + " />"
          : "") +
        '<rect width="' + p.w + '" height="' + p.h + '" rx="5" style="fill:' + bg + ";stroke:" + border + '"' + dash + ' stroke-width="1.5" />' +
        (inset ? '<rect x="' + SZ_PT_RING + '" y="' + SZ_PT_RING + '" width="' + (p.w - 2 * SZ_PT_RING) + '" height="' + (p.h - 2 * SZ_PT_RING) + '" rx="2" style="fill:' + cls.color + '" />' : "") +
        '<text x="' + p.w / 2 + '" y="' + (p.h / 2 + 4) + '" text-anchor="middle" font-size="' + SZ_PT_FONT_PX + '" font-weight="600" style="fill:' + textColor + '">' +
        escapeHtml(id) + "</text></g>";
    }).join("");

    return {
      html: '<div class="param-tree-wrap"><svg class="sz-param-tree-svg" width="' + width + '" height="' + height + '">' + defs + linesSvg + userLinesSvg + nodesSvg + "</svg></div>",
      width: width,
    };
  }

  function layoutSzParamDiagramEdges(svg) {
    svg.querySelectorAll("g.sz-pt-node").forEach((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform"));
      g.dataset.x = m[1];
      g.dataset.y = m[2];
    });
    svg.querySelectorAll("path[data-sz-pt-from]").forEach((line) => {
      const a = svg.querySelector('g.sz-pt-node[data-sz-pt-id="' + cssEscape(line.dataset.szPtFrom) + '"]');
      const b = svg.querySelector('g.sz-pt-node[data-sz-pt-id="' + cssEscape(line.dataset.szPtTo) + '"]');
      if (!a || !b) return;
      const aw = a.querySelector("rect").getAttribute("width"), ah = a.querySelector("rect").getAttribute("height");
      const bw = b.querySelector("rect").getAttribute("width"), bh = b.querySelector("rect").getAttribute("height");
      const ax = parseFloat(a.dataset.x) + aw / 2, ay = parseFloat(a.dataset.y) + ah / 2;
      const bx = parseFloat(b.dataset.x) + bw / 2, by = parseFloat(b.dataset.y) + bh / 2;
      line.setAttribute("d", edgePathD({ cx: ax, cy: ay, halfW: aw / 2, halfH: ah / 2 }, { cx: bx, cy: by, halfW: bw / 2, halfH: bh / 2 }, 3,
        +line.dataset.pa || 0, +line.dataset.pb || 0));
    });
  }

  function enableSzParamDiagramDragging(wrap, nodeId, notation) {
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
      // A click that didn't move the box offers to classify that parameter
      // -- or, while an arrow is being drawn, picks one of its ends.
      if (nodeId) g.addEventListener("click", () => {
        if (drag && drag.moved) return;
        if (SZ_PT_ARROW) { szPtArrowPick(g.dataset.szPtId); return; }
        showClassifyDialog(nodeId, g.dataset.szPtId, notation);
      });
    });
    if (nodeId) svg.querySelectorAll("g.sz-pt-user-edge").forEach((g) => g.addEventListener("click", () => {
      const i = +g.dataset.szPtUserEdge;
      showParamArrowDialog(loadSzParamEdges()[i], i, nodeId, notation);
    }));
    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.startX) > 4 || Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      const x = drag.x0 + (e.clientX - drag.startX), y = drag.y0 + (e.clientY - drag.startY);
      drag.g.setAttribute("transform", "translate(" + x + "," + y + ")");
      drag.g.dataset.x = x;
      drag.g.dataset.y = y;
      layoutSzParamDiagramEdges(svg);
    });
    // Cleared a tick later so the click that follows pointerup can still
    // see whether the box was dragged or merely clicked.
    document.addEventListener("pointerup", () => { setTimeout(() => { drag = null; }, 0); });
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
    const bg = classBg(cc, "var(--panel-bg)");
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
      // notation.xml writes negation as "not"; it used to spell one
      // condition "no number of machines", which schedulingzoo PR #14
      // regularised. The alias stays so an older notation.xml still reads.
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

  // The map being built and not yet saved. Nothing else keeps it: a saved
  // map is stored by "Save problem map", and until then the map lives only in
  // memory, which a reload empties. So the page writes it here as it leaves
  // (and after every redraw), and a reload of #/design/new reads it back.
  const DESIGNER_DRAFT_KEY = "psz.designerDraft.v1";
  function loadDesignerDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DESIGNER_DRAFT_KEY) || "null");
      return d && typeof d === "object" && Array.isArray(d.problemIds) ? d : null;
    } catch (e) {
      return null;
    }
  }
  function clearDesignerDraft() {
    try { localStorage.removeItem(DESIGNER_DRAFT_KEY); } catch (e) { /* nothing to clear */ }
  }
  // Only ever the unsaved map (designerMapId null) while the designer is on
  // screen; a saved map's own edits still wait for "Save problem map".
  function persistDesignerDraft() {
    if (designerMapId !== null || !els.viewDesign || els.viewDesign.hidden) return;
    const hidden = MAP_HIDDEN_IDS[DESIGNER_MAP_ID] || new Set();
    const ids = storyProblemIds.filter((id) => !hidden.has(id));
    if (!ids.length) { clearDesignerDraft(); return; }
    const draft = {
      title: designerMapTitle,
      problemIds: ids,
      positions: {},
      userEdges: designerUserEdges.filter((e) => ids.includes(e.from) && ids.includes(e.to)),
      drafts: {},
    };
    ids.forEach((id) => {
      draft.positions[id] = storyPositions[id];
      if (designerDraftNodes[id]) draft.drafts[id] = designerDraftNodes[id];
    });
    try { localStorage.setItem(DESIGNER_DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* private window or quota: the draft just isn't kept */ }
  }
  window.addEventListener("pagehide", persistDesignerDraft);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistDesignerDraft(); });

  // Loads a saved map (or "new": an empty one) into the designer. `resume`
  // is true when the page has just been loaded, which for "new" means the
  // reader is coming back to the map they were building; otherwise "new" is a
  // request for a blank one and the old draft goes.
  function openDesignerMap(mapId, options) {
    resetDesignerHidden();
    designerSelectedId = null;
    designerArrowMode = null;
    designerArrowNotice = "";
    if (mapId === "new") {
      const draft = options && options.resume ? loadDesignerDraft() : null;
      if (!draft) clearDesignerDraft();
      Object.assign(designerDraftNodes, (draft && draft.drafts) || {});
      storyProblemIds = draft ? draft.problemIds.filter((id) => storyNodeById(id)) : [];
      storyPositions = {};
      storyProblemIds.forEach((id) => { storyPositions[id] = (draft.positions || {})[id] || { left: 30, top: 30 }; });
      const onMap = new Set(storyProblemIds);
      designerUserEdges = draft ? (draft.userEdges || []).filter((e) => onMap.has(e.from) && onMap.has(e.to)) : [];
      designerMapId = null;
      designerMapTitle = draft ? draft.title || "" : "";
      return;
    }
    // Opening a saved map by address leaves any unsaved draft behind, which
    // is what starting to work on a different map means.
    clearDesignerDraft();
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
    clearDesignerDraft();
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
  // The classes an arrow is judged by: the designer's when the designer is
  // showing (its own arrows and drafts count there), the overview's otherwise.
  function activeClassOf(id) {
    if (!els.viewDesign.hidden) return designerClassOf(id);
    return szEffectiveClasses()[id] || (storyNodeById(id) || {}).classicalClass || "unclaimed";
  }
  // Since an arrow carries its class through, the two ends of one agree
  // unless a direct classification of the reader's blocks that, so a class
  // conflict here means two of their own claims disagree.
  function designerArrowConflict(edge) {
    const fromId = edge.from, toId = edge.to;
    const a = storyNodeById(fromId), b = storyNodeById(toId);
    if (!a || !b) return null;
    szEffectiveClasses();
    const ca = activeClassOf(fromId), cb = activeClassOf(toId);
    const hard = ["weakly-NP-hard", "NP-hard-unresolved", "strongly-NP-hard"];
    if (ca === "P" && hard.includes(cb)) {
      return { general: a, specific: b, generalClass: ca, specificClass: cb,
        why: "an algorithm for " + a.notation + " would then solve the NP-hard " + b.notation + " in polynomial time" };
    }
    if ((ca === "weakly-NP-hard" || ca === "pseudo-open") && cb === "strongly-NP-hard" && edge.numbers !== "blowup") {
      return { general: a, specific: b, generalClass: ca, specificClass: cb,
        why: "the pseudo-polynomial algorithm for " + a.notation + " would then solve the strongly NP-hard " + b.notation + " in pseudo-polynomial time" };
    }
    // Otherwise, field by field against the reduction rules: a special case
    // can narrow a field but never widen it. Only for an arrow the reader
    // said IS a restriction (or a padding, which narrows fields too): a
    // reduction of another kind, or one they are not sure about, may
    // widen a field and still be a reduction. A field whose rules only say
    // the two values are unrelated (or say nothing) is not counted -- the
    // rules are incomplete, so silence is not a contradiction.
    if (!["restriction", "padding"].includes(edge.kind)) return null;
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

  // Every field a problem vector can carry: the problem-builder form's own
  // fields (its three sections are exactly the non-parameter fields), plus
  // any field seen in a corpus vector, in case the two ever drift apart.
  let SZ_VECTOR_FIELDS = null;
  function szVectorFields() {
    if (!SZ_VECTOR_FIELDS || SZ_VECTOR_FIELDS.data !== DATA_SZ) {
      const fields = new Set((DATA_SZ.notationForm || []).map((f) => f.field));
      (DATA_SZ.nodes || []).forEach((node) => Object.keys(node.vector || {}).forEach((f) => fields.add(f)));
      SZ_VECTOR_FIELDS = { data: DATA_SZ, fields: Array.from(fields) };
    }
    return SZ_VECTOR_FIELDS.fields;
  }

  // A parameterized claim supersedes the corpus for its own problem, and then
  // travels the way parameterized results always travel here: a hardness
  // (W[1], W[2], para-NP) upward to the problems that generalize it, an
  // upper bound (P, FPT, XP) downward to its special cases -- and only along
  // arrows that keep THAT parameter bounded (szParamSafeFor). Returns, for
  // every problem the claims reach, what they say about each parameter.
  const PARAM_UPPER_BOUNDS = ["P", "FPT", "XP"];
  let SZ_PARAM_CLAIMS = null;
  function szParamClaimMap() {
    if (SZ_PARAM_CLAIMS) return SZ_PARAM_CLAIMS;
    const out = {};
    if (!DATA_SZ) return out;
    const record = (id, param, value) => {
      const forNode = out[id] || (out[id] = {});
      // A direct claim on a problem always beats one that merely reached it.
      if (!forNode[param] || (!forNode[param].direct && value.direct)) forNode[param] = value;
    };
    const all = loadUserClassifications();
    Object.keys(all).forEach((claimedId) => {
      const params = (all[claimedId] || {}).params || {};
      Object.keys(params).forEach((param) => {
        const claim = params[param];
        record(claimedId, param, { classId: claim.classId, source: claim.source, direct: true, from: claimedId });
        const upward = !PARAM_UPPER_BOUNDS.includes(claim.classId);
        const seen = new Set([claimedId]);
        let frontier = [claimedId];
        while (frontier.length) {
          const next = [];
          frontier.forEach((current) => {
            DATA_SZ.edges.forEach((e) => {
              const step = upward ? (e.to === current ? e.from : null) : (e.from === current ? e.to : null);
              if (!step || seen.has(step)) return;
              const general = upward ? step : current;
              const specific = upward ? current : step;
              if (szParamSafeFor(general, specific, param) !== true) return;
              seen.add(step);
              next.push(step);
              record(step, param, { classId: claim.classId, source: claim.source, direct: false, from: claimedId });
            });
          });
          frontier = next;
        }
      });
    });
    SZ_PARAM_CLAIMS = out;
    return out;
  }
  // What the reader's claims say about one parameter of one problem: their
  // own claim, or one that reached it along parameter-safe arrows.
  // ... or one that follows from a claim about a DIFFERENT parameter of the
  // same problem. That is containment between the parameter sets themselves,
  // the nesting the panel's diagram draws: #d+#p bounds everything #p bounds
  // and more. Bounding fewer things can only make a problem harder, so
  // hardness for the bigger set carries to every subset of it (para-NP-hard
  // for #d+#p means para-NP-hard for #p), while an algorithm needing only
  // the smaller set still runs when more is bounded, so FPT/XP/P carries the
  // other way, to every superset.
  const paramParts = (label) =>
    new Set(String(label).split("+").map((t) => t.trim()).filter(Boolean));
  const paramSubsetOf = (a, b) => a.size < b.size && Array.from(a).every((t) => b.has(t));
  // Is `a` bounded by a function of `b`? By containment (a's measures are
  // among b's) or along the reader's parameter arrows, in any combination
  // -- `labels` are the other labels a chain may pass through.
  function paramGeneralizes(a, b, labels) {
    if (a === b) return false;
    const edges = loadSzParamEdges();
    const pool = new Set([a, b].concat(labels || []));
    edges.forEach((e) => { pool.add(e.from); pool.add(e.to); });
    const seen = new Set([a]);
    const stack = [a];
    while (stack.length) {
      const x = stack.pop();
      const px = paramParts(x);
      pool.forEach((y) => {
        if (seen.has(y)) return;
        if (paramSubsetOf(px, paramParts(y)) || edges.some((e) => e.from === x && e.to === y)) {
          seen.add(y);
          stack.push(y);
        }
      });
    }
    return seen.has(b);
  }
  function userParamClass(nodeId, param) {
    const forNode = szParamClaimMap()[nodeId] || {};
    if (forNode[param]) return forNode[param];
    const labels = Object.keys(forNode);
    let implied = null;
    labels.forEach((other) => {
      if (implied) return;
      const claim = forNode[other];
      // An upper bound (P, FPT, XP) comes DOWN from a parameter this one
      // bounds; hardness comes UP from a parameter that bounds this one.
      const carries = PARAM_UPPER_BOUNDS.includes(claim.classId)
        ? paramGeneralizes(other, param, labels)
        : paramGeneralizes(param, other, labels);
      if (carries) implied = Object.assign({}, claim, { direct: false, viaParam: other });
    });
    return implied;
  }

  // What a problem's results imply for its other parameters, to a fixpoint,
  // along two relations between labels. Containment: a label that bounds
  // MORE measures (#d+#p+#w) is bounded by one that bounds fewer (#d+#p),
  // so an algorithm for the smaller label holds for the larger one, and
  // hardness for the larger holds for the smaller. The reader's parameter
  // arrows (`from` is bounded by a function of `to`) work the same way. So:
  // FPT and XP travel down, W[1], W[2] and para-NP up. Each carried line
  // keeps its citation and says what brought it. Containment only fills in
  // labels the problem already has results for; an arrow may add one.
  const PARAM_HARDNESS = ["W1", "W2", "paraNP"];
  function szParamDerivedResults(params) {
    const labels = new Set(params.map((r) => canonicalParamLabel(r.param)));
    const relations = loadSzParamEdges().map((e) => ({ from: canonicalParamLabel(e.from), to: canonicalParamLabel(e.to), arrow: e }));
    const list = Array.from(labels);
    list.forEach((a) => list.forEach((b) => {
      if (a !== b && paramSubsetOf(paramParts(a), paramParts(b))) relations.push({ from: a, to: b, arrow: null });
    }));
    if (!relations.length) return [];
    const keyOf = (r, label) => label + "\u0001" + (r.bibkey || r.bound) + "\u0001" + (r.inheritedFrom || "") + "\u0001" + (r.derivedFrom || r.param);
    const have = {};
    params.forEach((r) => { have[keyOf(r, canonicalParamLabel(r.param))] = true; });
    const out = [];
    const all = params.slice();
    let added = true;
    while (added) {
      added = false;
      all.slice().forEach((r) => {
        const label = canonicalParamLabel(r.param);
        const cls = r.complexityClass;
        if (!cls) return;
        relations.forEach((e) => {
          const target = PARAM_HARDNESS.includes(cls) && e.to === label ? e.from
            : PARAM_UPPER_BOUNDS.includes(cls) && cls !== "P" && e.from === label ? e.to
            : null;
          if (!target || (!e.arrow && !labels.has(target))) return;
          const copy = Object.assign({}, r, {
            param: target,
            derivedFrom: r.derivedFrom || r.param,
            carriedBy: r.carriedBy || (e.arrow ? { kind: "arrow", from: e.arrow.from, to: e.arrow.to } : { kind: "containment", from: e.from, to: e.to }),
          });
          const k = keyOf(copy, target);
          if (have[k]) return;
          have[k] = true;
          out.push(copy);
          all.push(copy);
          added = true;
        });
      });
    }
    return out;
  }

  // ---- which measures an arrow keeps bounded -------------------------
  // A parameterized result only travels along an arrow that leaves the
  // parameter bounded: W[1]-hardness for #p carries up to a problem that
  // generalizes it only if the generalization still has #p under control.
  // The corpus's own inherited results are worked out by param_safe_tokens()
  // in scripts/convert_for_pzoo.py; this is that rule ported, because a
  // classification the reader makes here has to travel the same way and the
  // converter cannot be re-run in the browser. Validated against the corpus:
  // it reproduces every one of schedzoo's own inherited results.
  // NOTE: two copies of one rule. Exporting the per-arrow answer from the
  // converter into schedulingzoo.json would remove this duplicate -- worth
  // doing next time that file is regenerated.
  const PARAM_SAFE_ANY = true; // any one-field rule of this field keeps the instance as it is
  const PARAM_SAFE_FIELD_CHANGES = {
    "precedence relation": PARAM_SAFE_ANY,
    "processing times": PARAM_SAFE_ANY,
    "due date": PARAM_SAFE_ANY,
    "setup times": PARAM_SAFE_ANY,
    "batching": PARAM_SAFE_ANY,
    "number of jobs": PARAM_SAFE_ANY,
    "time lags": PARAM_SAFE_ANY,
    "communication delay": PARAM_SAFE_ANY,
    "transportation delays": PARAM_SAFE_ANY,
    "deadline": PARAM_SAFE_ANY,
    "job size": PARAM_SAFE_ANY,
    "machine sets": PARAM_SAFE_ANY,
  };
  // Padding release dates with r_j = 0 moves the windows [r_j, d_j] and the
  // slack, so window-based measures do not survive it.
  const RELEASE_PADDING_EXCLUDES = ["pw(I)", "slackmax"];
  // P inside Q is speeds 1, F inside J is the same instance; Q or P inside R
  // rescales the processing times, so measures of those do not survive.
  const TYPE_CHANGE_EXCLUDES = {
    "P|Q": [], "F|J": [],
    "Q|R": ["pmax", "#p", "rank((pij))", "slackmax"],
    "P|R": ["pmax", "#p", "rank((pij))", "slackmax"],
  };
  const WEIGHT_PADDING = ["\\sum (1-U_j)|\\sum w_j(1-U_j)", "\\sum C_j|\\sum w_jC_j",
    "\\sum T_j|\\sum w_jT_j", "\\sum F_j|\\sum w_jF_j", "F_{\\max}|\\max w_jF_j"];
  const DUE_DATE_PADDING = ["C_{\\max}|L_{\\max}", "\\sum C_j|\\sum T_j", "\\sum w_jC_j|\\sum w_jT_j"];
  const DUE_DATE_PADDING_EXCLUDES = ["pw(I)", "slackmax"];

  // true  -> every measure survives this arrow
  // Set   -> every measure except these survives
  // false -> the arrow carries no parameterized result at all
  function szParamSafeTokens(generalId, specificId) {
    const byId = szNodeIndex();
    const g = byId[generalId], sp = byId[specificId];
    if (!g || !sp) return false;
    const vg = g.vector || {}, vs = sp.vector || {};
    const excluded = new Set();
    const fields = szVectorFields();
    for (let i = 0; i < fields.length; i += 1) {
      const f = fields[i];
      const gv = vg[f] || "", sv = vs[f] || "";
      if (gv === sv) continue;
      const rules = (DATA_SZ.fieldReductions || {})[f] || [];
      const isRule = rules.some((pair) => pair[0] === sv && pair[1] === gv);
      if (PARAM_SAFE_FIELD_CHANGES[f] === PARAM_SAFE_ANY && isRule) continue;
      if (f === "release time" && sv === "" && gv === "r_j") {
        RELEASE_PADDING_EXCLUDES.forEach((t) => excluded.add(t));
        continue;
      }
      if (f === "type" && TYPE_CHANGE_EXCLUDES[sv + "|" + gv]) {
        TYPE_CHANGE_EXCLUDES[sv + "|" + gv].forEach((t) => excluded.add(t));
        continue;
      }
      if (f === "Objective function" && WEIGHT_PADDING.includes(sv + "|" + gv)) continue;
      if (f === "Objective function" && DUE_DATE_PADDING.includes(sv + "|" + gv)) {
        DUE_DATE_PADDING_EXCLUDES.forEach((t) => excluded.add(t));
        continue;
      }
      return false;
    }
    return excluded.size ? excluded : true;
  }
  function szParamSafeFor(generalId, specificId, param) {
    const safe = szParamSafeTokens(generalId, specificId);
    if (safe === false) return false;
    if (safe === true) return true;
    // A combined parameter (#p+#r) survives only if each part does.
    return String(param).split("+").every((t) => !safe.has(t.trim()));
  }

  let SZ_NODE_INDEX = null;
  function szNodeIndex() {
    if (!SZ_NODE_INDEX) {
      SZ_NODE_INDEX = {};
      (DATA_SZ ? DATA_SZ.nodes : []).forEach((n) => { SZ_NODE_INDEX[n.id] = n; });
    }
    return SZ_NODE_INDEX;
  }

  // Is the `specific` problem a particular case of the `general` one? The
  // same test The Scheduling Zoo's search makes: every field of the specific
  // problem must equal the general one's, or be a special case of it by that
  // field's reduction rules. A field with no rules (preemption, say) has to
  // match exactly, and an unrelated pair of values in any field means no.
  //
  // One-field rules only (DATA_SZ.fieldReductions). The two-field rules --
  // setup times under S1, fix_j in a shop, our machine-count rule -- are
  // already baked into DATA_SZ.edges between corpus problems, so a pair that
  // needs one of those is related only when both ends are corpus problems.
  function szVectorReduces(specific, general) {
    if (!specific || !general) return false;
    return szVectorFields().every((field) => {
      const relation = szFieldRelation(field, specific[field] || "", general[field] || "");
      return relation === "same" || relation === "narrower";
    });
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

  // `index` -1 adds a new arrow; otherwise it edits host.edges()[index].
  // `host` says whose arrows these are -- the designer's (the default) or
  // the Scheduling Zoo overview's -- since both draw arrows by hand and ask
  // exactly the same questions about them. See DESIGNER_EDGE_HOST.
  function showDesignerReductionDialog(edge, index, host) {
    host = host || DESIGNER_EDGE_HOST;
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
      host.edges().splice(index, 1);
      host.changed();
      host.notice("");
      close();
      host.rerender();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const overriddenBefore = new Set(hostOverridden(host).map((o) => o.id));
      const next = {
        from: edge.from, to: edge.to,
        kind: form.kind.value, numbers: form.numbers.value, params: form.params.value,
        safeParams: form.params.value === "some" ? Array.from(paramBox.querySelectorAll("input:checked")).map((i) => i.value) : [],
        note: form.note.value.trim(),
      };
      close();
      let at = index;
      const edges = host.edges();
      if (editing) edges[index] = next;
      else { edges.push(next); at = edges.length - 1; }
      host.changed();
      const implied = DATA_SZ.nodes.some((n) => n.id === next.from) && szDescendants(next.from).has(next.to);
      const reverse = DATA_SZ.nodes.some((n) => n.id === next.to) && szDescendants(next.to).has(next.from);
      host.notice((editing ? "Updated " : "Added ") + a.notation + " → " + b.notation + " (" + szReductionSummary(next) + ")." +
        (implied ? " The Scheduling Zoo's reductions already imply it." : "") +
        (reverse ? " The Scheduling Zoo records the opposite direction, so together they would make the two problems equivalent." : ""));
      host.rerender();
      const conflict = designerArrowConflict(next);
      if (conflict) showDesignerConflictDialog(conflict, at, host);
      else {
        // The arrow stands; what it moved against the literature is reported
        // the way a classification's overrides are.
        const fresh = hostOverridden(host).filter((o) => !overriddenBefore.has(o.id));
        if (fresh.length) showArrowOverrideAlert(next, fresh, at, host);
      }
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

  // The problems on a host's map whose class the reader's claims and arrows
  // have moved against the literature: the overview's whole list, or, for
  // the designer, the corpus problems on its map judged by its own classes.
  function hostOverridden(host) {
    if (host !== DESIGNER_EDGE_HOST) return szOverriddenByClaims();
    if (!DATA_SZ) return [];
    if (!SZ_EFFECTIVE_CORPUS) SZ_EFFECTIVE_CORPUS = computeEffectiveClassesForSz(DATA_SZ.nodes, DATA_SZ.edges, true);
    return storyProblemIds
      .filter((id) => !(storyNodeById(id) || {}).draft && szClassesDisagree(designerClassOf(id), SZ_EFFECTIVE_CORPUS[id]))
      .map((id) => ({ id: id, notation: storyNodeById(id).notation, now: designerClassOf(id), cited: SZ_EFFECTIVE_CORPUS[id],
        direct: !!userClassification(id, null) }));
  }

  // Shown when an arrow the reader just drew moves a problem against its
  // citations. Never blocked: the arrow is kept, and here is what followed.
  function showArrowOverrideAlert(edge, conflicts, edgeIndex, host) {
    const a = storyNodeById(edge.from), b = storyNodeById(edge.to);
    const backdrop = document.createElement("div");
    backdrop.className = "designer-dialog-backdrop";
    backdrop.innerHTML =
      '<div class="designer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="arrow-override-title">' +
      '<h3 id="arrow-override-title">That arrow contradicts ' +
      (conflicts.length === 1 ? "a published result" : conflicts.length + " published results") + "</h3>" +
      '<p class="designer-relations-empty" style="margin:0 0 0.7rem">Your arrow <b>' + escapeHtml(a.notation) + " → " +
      escapeHtml(b.notation) + "</b> says every " + escapeHtml(b.notation) + " instance is an instance of " +
      escapeHtml(a.notation) + ". Either that is wrong, or you have a result worth writing up. The arrow has been " +
      "kept and its class carries through: the problems it moved are glowing blue.</p>" +
      '<ul class="result-list">' +
      conflicts.slice(0, 6).map((c) =>
        "<li><b>" + escapeHtml(c.notation) + "</b> is cited as <b>" + escapeHtml(szClassLabel(c.cited)) +
        "</b>, but is now <b>" + escapeHtml(szClassLabel(c.now)) + "</b> because of the arrow.</li>").join("") +
      (conflicts.length > 6 ? "<li>and " + (conflicts.length - 6) + " more</li>" : "") +
      "</ul>" +
      '<div class="designer-dialog-actions">' +
      '<button type="button" class="map-history-btn" data-dialog="remove">Remove the arrow</button>' +
      '<button type="button" class="map-history-btn designer-dialog-report" data-dialog="keep">Keep it</button>' +
      "</div></div>";
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.querySelector('[data-dialog="keep"]').addEventListener("click", close);
    backdrop.querySelector('[data-dialog="remove"]').addEventListener("click", () => {
      host.edges().splice(edgeIndex, 1);
      host.changed();
      host.notice("");
      close();
      host.rerender();
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-dialog="keep"]').focus();
  }

  function showDesignerConflictDialog(c, edgeIndex, host) {
    host = host || DESIGNER_EDGE_HOST;
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
      host.edges().splice(edgeIndex, 1);
      host.changed();
      host.notice("");
      close();
      host.rerender();
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
      (node.draft ? '<span class="designer-draft-label">Draft node</span>' : "") +
      '<button type="button" class="reset-btn designer-details-btn" id="designer-details">Open details</button>' +
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

  // The classes the designer paints with: the same computation as the
  // overview's (computeEffectiveClassesForSz), over the corpus plus the
  // drafts on this map, related to it by the rules (designerRelationPairs),
  // with the reader's arrows -- the overview's, and this map's own -- as the
  // claims they are. A draft with no citation is settled by the arrows
  // around it in either direction: P down (an instance of a problem
  // solvable in polynomial time is still solvable once restricted),
  // hardness up (inheritedContribution); a draft the reader classified
  // keeps that class.
  let designerEffectiveCache = { key: null, classes: null };
  let DESIGNER_USER_AFFECTED = new Set();
  // The arrows that count on this map: every one drawn on the overview
  // (those are global claims) and the ones drawn here.
  function designerModelEdges() {
    return loadSzUserEdges().concat(designerUserEdges);
  }
  function designerEffectiveClasses() {
    const pairs = designerRelationPairs();
    const arrows = designerModelEdges();
    const cacheKey = storyProblemIds.slice().sort().join(",") + "|" + pairs.length + "|" +
      JSON.stringify(arrows.map((e) => [e.from, e.to, e.numbers || ""]));
    if (designerEffectiveCache.key === cacheKey) return designerEffectiveCache.classes;
    const drafts = storyProblemIds.filter((id) => (storyNodeById(id) || {}).draft).map((id) => storyNodeById(id));
    const affected = new Set();
    const classes = computeEffectiveClassesForSz(DATA_SZ.nodes.concat(drafts), pairs, false,
      { userEdges: arrows, affectedOut: affected });
    DESIGNER_USER_AFFECTED = affected;
    designerEffectiveCache = { key: cacheKey, classes: classes };
    return classes;
  }

  // WHY a drafted problem has the class it has -- the same two rules
  // designerEffectiveClasses applies, but keeping the problems that did the
  // settling so the panel can name them. A draft is the one kind of problem
  // whose class is pure inference, so this is the whole of its evidence.
  //
  // The witnesses are drawn from the rule-derived relations over the WHOLE
  // corpus, not just what is on the map: a draft is related to every problem
  // the notation places it against, whether or not the reader put it there.
  function designerClassReason(id) {
    const node = storyNodeById(id);
    if (!node || !node.draft) return null;
    const claim = userClassification(id, null);
    if (claim) {
      return { classId: claim.classId, own: true, via: [],
        summary: "your own classification -- nothing is inherited over it" };
    }
    const classId = designerEffectiveClasses()[id];
    if (!classId || classId === "unclaimed") return null;
    const label = szClassLabel(classId);
    const pairs = designerRelationPairs().concat(designerModelEdges());
    const named = (x) => (storyNodeById(x) || {}).notation || x;
    if (classId === "P") {
      // P travels DOWN: restricting a problem solvable in polynomial time
      // leaves it solvable in polynomial time.
      const via = pairs.filter((e) => e.to === id && designerClassOf(e.from) === "P").map((e) => e.from);
      if (via.length) {
        return { classId: classId, direction: "down", via: via,
          summary: "inherited: a special case of " + named(via[0]) + ", which is in P" +
            (via.length > 1 ? " (and " + (via.length - 1) + " more)" : "") };
      }
    }
    // Hardness travels UP: a hard special case makes the general problem
    // at least as hard.
    const via = pairs.filter((e) => e.from === id && inheritedContribution(designerClassOf(e.to)) === classId).map((e) => e.to);
    if (via.length) {
      return { classId: classId, direction: "up", via: via,
        summary: "inherited: generalizes " + named(via[0]) + ", which is " + szClassLabel(designerClassOf(via[0])) +
          (via.length > 1 ? " (and " + (via.length - 1) + " more)" : "") };
    }
    return { classId: classId, via: [], summary: "inherited, but the problems it came from are no longer here" };
  }

  // The same reasoning spelled out under the heading, with every problem
  // that settled it named and classified.
  function draftReasonHtml(reason) {
    if (reason.own) {
      return '<div class="detail-field"><h4>Where this classification comes from</h4>' +
        '<p style="margin:0">You classified this problem yourself, so that is what the map uses. Remove your ' +
        "classification to see what the reduction rules make of it instead.</p></div>";
    }
    if (!reason.via.length) {
      return '<div class="detail-field"><h4>Where this classification comes from</h4>' +
        '<p style="margin:0">' + escapeHtml(reason.summary) + "</p></div>";
    }
    const down = reason.direction === "down";
    return '<div class="detail-field"><h4>Where this classification comes from</h4>' +
      '<p style="margin:0 0 0.4rem">Nothing is cited about this problem. It takes its class from ' +
      (down
        ? "a problem it is a <b>special case of</b> -- restricting a problem solvable in polynomial time leaves it solvable in polynomial time"
        : "a <b>special case of it</b> -- an instance of the special case is an instance of this one, so this one is at least as hard") +
      ":</p><ul class='result-list'>" +
      reason.via.slice(0, 8).map((x) => {
        const cls = classicalClassById(designerClassOf(x));
        return "<li><b>" + escapeHtml((storyNodeById(x) || {}).notation || x) + "</b> &mdash; " +
          '<span style="color:' + (cls ? cls.color : "var(--fg)") + '">' + escapeHtml(szClassLabel(designerClassOf(x))) + "</span>" +
          '<span class="detail-class-aside"> &middot; ' + (down ? "this problem is a special case of it" : "a special case of this problem") + "</span></li>";
      }).join("") +
      (reason.via.length > 8 ? "<li>and " + (reason.via.length - 8) + " more</li>" : "") +
      "</ul></div>";
  }

  // The class to paint a problem in the designer with: a draft's inherited
  // one when the map settles it, otherwise the corpus class.
  function designerClassOf(id) {
    const node = storyNodeById(id);
    return designerEffectiveClasses()[id] ||
      szEffectiveClasses()[id] || (node && node.classicalClass) || "unclaimed";
  }

  let designerRelationCache = { key: null, pairs: null };
  function designerRelationPairs() {
    const cacheKey = DATA_SZ.edges.length + "|" + storyProblemIds.filter((id) => designerDraftNodes[id]).sort().join(",");
    if (designerRelationCache.key === cacheKey) return designerRelationCache.pairs;
    const pairs = (DATA_SZ.edges || []).map((edge) => ({ from: edge.from, to: edge.to }));
    const nodeById = new Map((DATA_SZ.nodes || []).map((node) => [node.id, node]));
    storyProblemIds.forEach((id) => { const node = storyNodeById(id); if (node) nodeById.set(id, node); });
    const nodes = Array.from(nodeById.values());
    // A drafted problem is in no precomputed edge, so relate it to the rest
    // by the rules themselves, field by field (szVectorReduces).
    const drafts = nodes.filter((node) => node.draft);
    drafts.forEach((draft) => nodes.forEach((other) => {
      if (draft.id === other.id) return;
      if (szVectorReduces(draft.vector, other.vector)) pairs.push({ from: other.id, to: draft.id });
      if (szVectorReduces(other.vector, draft.vector)) pairs.push({ from: draft.id, to: other.id });
    }));
    designerRelationCache = { key: cacheKey, pairs: pairs };
    return pairs;
  }

  function renderDesignerMap() {
    designerEffectiveClasses(); // fills DESIGNER_USER_AFFECTED before anything below reads it
    const nodeH = MAP_NODE_H_DEFAULT;
    const nodeW = Math.max(150, ...storyProblemIds.map((id) => measureTextWidthPx(storyNodeById(id).notation, MAP_NODE_FONT_SIZE_REM * 16) + 24));
    const positions = designerNodePositions(nodeW, nodeH);
    const hidden = MAP_HIDDEN_IDS[DESIGNER_MAP_ID] || new Set();
    const visibleIds = storyProblemIds.filter((id) => !hidden.has(id));
    const width = Math.max(900, ...Object.values(positions).map((p) => p.left + nodeW + MAP_MARGIN));
    const height = Math.max(480, ...Object.values(positions).map((p) => p.top + nodeH + MAP_MARGIN));
    const marker = (id, style) => '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="' + STEALTH_ARROW_PATH + '" style="' + style + '" /></marker>';
    const arrowDef = "<defs>" + marker("designer-map-arrow", "fill:" + MAP_EDGE_COLOR) + marker("designer-user-arrow", "fill:var(--accent)") +
      marker("designer-conflict-arrow", "fill:" + SZ_EDGE_FLAGGED_COLOR) +
      marker("designer-claim-arrow", "fill:" + USER_CLASS_RING) + "</defs>";
    const dBox = (p) => p && { cx: p.cx, cy: p.cy, halfW: nodeW / 2, halfH: nodeH / 2 };
    const dPortOf = edgePorts(designerMapEdges().concat(designerUserEdges), (id) => dBox(positions[id]));
    const lines = designerMapEdges().map((edge) => {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b) return "";
      const port = dPortOf(edge);
      const d = edgePathD(dBox(a), dBox(b), 5, port.pa, port.pb);
      // An arrow derived from the reduction rules still turns red when the
      // classifications at its two ends contradict each other -- the same
      // rule the hand-drawn arrows below are judged by, and the same one the
      // Scheduling Zoo map uses. Reclassifying a problem yourself is what
      // usually causes this.
      const conflict = szClassConflict(designerClassOf(edge.from), designerClassOf(edge.to),
        (storyNodeById(edge.from) || {}).notation || edge.from,
        (storyNodeById(edge.to) || {}).notation || edge.to);
      // Blue where a classification of the reader's reaches, red where two
      // of them cannot both hold -- a contradiction outranks the blue.
      const claimTouched = !conflict && (
        userClassification(edge.from, null) || userClassification(edge.to, null) ||
        DESIGNER_USER_AFFECTED.has(edge.from) || DESIGNER_USER_AFFECTED.has(edge.to));
      const stroke = conflict ? SZ_EDGE_FLAGGED_COLOR : claimTouched ? USER_CLASS_RING : MAP_EDGE_COLOR;
      const markerId = conflict ? "designer-conflict-arrow" : claimTouched ? "designer-claim-arrow" : "designer-map-arrow";
      return '<path data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '" data-pa="' + port.pa + '" data-pb="' + port.pb + '" fill="none" d="' + d +
        '" stroke="' + stroke + '" stroke-width="' + (conflict || claimTouched ? "2.6" : "2") + '"' +
        (conflict ? ' stroke-dasharray="6,3"' : "") +
        ' marker-end="url(#' + markerId + ')">' +
        (conflict ? "<title>" + escapeHtml("Contradiction: " + conflict) + "</title>" : "") +
        "</path>";
    }).join("") +
    // Arrows added by hand: dashed, in the accent color, or red when they
    // conflict with The Scheduling Zoo's results. Click one to remove it.
    designerUserEdges.map((edge, i) => {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b || hidden.has(edge.from) || hidden.has(edge.to)) return "";
      const port = dPortOf(edge);
      const conflict = !!designerArrowConflict(edge);
      const ends = 'data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '" data-pa="' + port.pa + '" data-pb="' + port.pb +
        '" fill="none" d="' + edgePathD(dBox(a), dBox(b), 5, port.pa, port.pb) + '"';
      return '<g class="designer-user-edge" data-user-edge="' + i + '"><title>' + escapeHtml("Added by you: " + szReductionSummary(edge) + (conflict ? " -- conflicts with The Scheduling Zoo's data" : "") + ". Click to edit or remove.") + '</title>' +
        '<path class="designer-user-edge-hit" ' + ends + ' />' +
        '<path ' + ends + ' style="stroke:' + (conflict ? SZ_EDGE_FLAGGED_COLOR : "var(--accent)") + '" stroke-width="2.4" stroke-dasharray="7,4" marker-end="url(#' +
        (conflict ? "designer-conflict-arrow" : "designer-user-arrow") + ')" /></g>';
    }).join("");
    const nodes = visibleIds.map((id) => {
      const p = storyNodeById(id);
      const cc = classicalClassById(designerClassOf(id));
      const pos = positions[id];
      const bg = classBg(cc, "var(--panel-bg)", MAP_NODE_RING);
      const text = cc && cc.fill ? fillTextColor(cc) : null;
      return '<a class="map-node' + (cc && !cc.fill ? " outline" : "") + (userClassification(id, null) ? " user-classified" : "") + (DESIGNER_USER_AFFECTED.has(id) ? " user-affected" : "") + (designerArrowMode ? (designerArrowMode.from === id ? " arrow-origin" : "") : (id === designerSelectedId ? " designer-selected" : "")) + '" data-problem-id="' + escapeHtml(id) + '" href="javascript:void(0)" style="left:' + pos.left + 'px;top:' + pos.top + 'px;width:' + nodeW + 'px;height:' + nodeH + 'px;background:' + bg + ';border-color:' + (cc ? cc.color : "#868e96") + ';border-style:' + (cc ? (cc.border || "solid") : "solid") + (text ? ';color:' + text : "") + ';font-size:' + MAP_NODE_FONT_SIZE_REM + 'rem">' + escapeHtml(p.notation) + '</a>';
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
      '<p class="map-hint"><span class="map-hint-icon">i</span> Click a node to select it, double-click one for its citations and results. Drag nodes to arrange them. Drag a node past the diagram edge to hide it; Undo, Redo, or Restore hidden brings it back.</p>';
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
    }, () => !!designerArrowMode, (id) => {
      // While an arrow is being drawn the second click is not a second
      // endpoint -- a problem can't be a special case of itself.
      if (designerArrowMode) return;
      // Drafts open too: the panel shows where their class comes from,
      // which is the one thing a drafted problem really needs explaining.
      if (storyNodeById(id)) openSchedulingZooPanel(id);
    });
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
    fitMapCanvasSoon(view);
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
      const bg = classBg(cc, "var(--panel-bg)");
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

  const BACK_TO_MAPS = '<a class="wiki-back" href="#/zoo-maps">&larr; Back to problem maps</a>';
  function renderDesign() {
    if (!DATA_SZ) {
      els.viewDesign.innerHTML = '<div class="design-page"><a class="wiki-back" href="#/zoo-maps">&larr; Back to problem maps</a><h2 class="page-title">Problem Map Designer</h2><p class="design-intro">Loading Scheduling Zoo problems…</p></div>';
      loadSzData().then(() => {
        szEffectiveClasses();
        renderDesign();
      });
      return;
    }
    szEffectiveClasses();
    const dropdownUi = captureDropdownUi(els.viewDesign);
    // Adding or removing a problem re-renders the whole page, which would
    // otherwise scroll it -- the results list changes height under the
    // cursor. Put the page back where the reader left it.
    const scrollY = window.scrollY;
    els.viewDesign.innerHTML = '<div class="design-page">' + BACK_TO_MAPS + '<h2 class="page-title">Problem Map Designer</h2>' + designerMapBarHtml() + renderDesignerMap() + designerRelationControls() + renderDesignerSearch() + '</div>';
    enableDesignerMapBar();
    enableDesignerMap();
    enableDesignerRelations();
    enableDesignerSearch();
    restoreDropdownUi(els.viewDesign, dropdownUi);
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    persistDesignerDraft();
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

    fitMapCanvasSoon(els.viewDesign);
  }

  // Small helper so the classical-status line can show a colored pill for
  // an inherited-only classicalClass id (no problem object to hang it off).
  function classPillHtmlForClassicalId(classId) {
    const cc = classicalClassById(classId);
    if (!cc) return "";
    return (
      '<span class="class-pill" style="background:' + classBg(cc, "var(--panel-bg)") +
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
        return '<path data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" fill="none" stroke="' + MAP_EDGE_COLOR + '" stroke-width="1.75" marker-end="url(#' + arrowId + ')" />';
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
        const inset = cls && cls.fill === "inset" && !(r && r.xpBound);
        const bg = inset ? "var(--panel-bg)" : cls && cls.opacity ? mixWithPanelBg(cls.color, cls.opacity) : filled ? cls.color : "var(--panel-bg)";
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
          (inset ? '<rect x="' + SZ_PT_RING + '" y="' + SZ_PT_RING + '" width="' + (PARAM_TREE_NODE_W - 2 * SZ_PT_RING) + '" height="' + (PARAM_TREE_NODE_H - 2 * SZ_PT_RING) + '" rx="2" style="fill:' + cls.color + '" />' : "") +
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
    svg.querySelectorAll("path[data-from]").forEach((line) => {
      const a = svg.querySelector('g.param-node[data-param="' + cssEscape(line.dataset.from) + '"]');
      const b = svg.querySelector('g.param-node[data-param="' + cssEscape(line.dataset.to) + '"]');
      if (!a || !b) return;
      const box = (g) => ({ cx: parseFloat(g.dataset.x) + PARAM_TREE_NODE_W / 2, cy: parseFloat(g.dataset.y) + PARAM_TREE_NODE_H / 2,
        halfW: PARAM_TREE_NODE_W / 2, halfH: PARAM_TREE_NODE_H / 2 });
      line.setAttribute("d", edgePathD(box(a), box(b), 4, 0, 0));
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
  // Measured by laying the text out in a hidden span, NOT with canvas
  // measureText. Firefox rounds every glyph's advance to a whole device
  // pixel in canvas but not in DOM layout: on a Retina window at
  // devicePixelRatio 1.818 that is ~0.3px per character, so Firefox called
  // a 16-character notation 96.88px where Chrome and Safari both said
  // 91.94px. These widths decide node widths, node widths decide block
  // widths, and block widths decide band splitting, wrapping and packing --
  // so that 5.4% made Firefox draw a different, 230px taller, far messier
  // diagram from the same data. Laid out in the DOM the three browsers
  // agree to a tenth of a pixel (91.94 / 92.05), and rounding to whole
  // pixels here puts them on the same integer.
  //
  // Scaling a big measurement down instead (measure at 20x, divide by 20)
  // does NOT work: -apple-system is San Francisco, which is optically
  // sized, and the Display cut used above ~20px is ~11% tighter than the
  // Text cut -- it measures the wrong typeface.
  const MAP_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const _textWidths = new Map();
  let _measureBox = null;

  // Measures every string that isn't cached yet in ONE reflow: all the
  // spans are appended before any width is read. Reading each one as it is
  // added instead makes the browser re-lay-out the page every time -- 235ms
  // for the overview's 719 notations, against 11ms batched.
  function warmTextWidths(texts, fontPx) {
    if (!document.body) return;
    const missing = [];
    const seen = new Set();
    texts.forEach((text) => {
      const key = fontPx + "|" + text;
      if (_textWidths.has(key) || seen.has(key)) return;
      seen.add(key);
      missing.push(text);
    });
    if (!missing.length) return;
    if (!_measureBox) {
      _measureBox = document.createElement("div");
      _measureBox.setAttribute("aria-hidden", "true");
      _measureBox.style.cssText =
        "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre;" +
        "font-weight:600;font-family:" + MAP_FONT_STACK + ";";
      document.body.appendChild(_measureBox);
    }
    _measureBox.style.fontSize = fontPx + "px";
    _measureBox.textContent = "";
    const spans = missing.map((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      _measureBox.appendChild(span);
      _measureBox.appendChild(document.createElement("br"));
      return span;
    });
    spans.forEach((span, i) => {
      _textWidths.set(fontPx + "|" + missing[i], Math.round(span.getBoundingClientRect().width));
    });
    _measureBox.textContent = "";
  }

  function measureTextWidthPx(text, fontPx) {
    const key = fontPx + "|" + text;
    const cached = _textWidths.get(key);
    if (cached !== undefined) return cached;
    warmTextWidths([text], fontPx);
    const measured = _textWidths.get(key);
    if (measured !== undefined) return measured;
    // No document to lay out in (called before body exists): canvas is
    // wrong in Firefox by the margin above, but it is better than nothing.
    if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
    const ctx = _measureCanvas.getContext("2d");
    ctx.font = "600 " + fontPx + "px " + MAP_FONT_STACK;
    return Math.round(ctx.measureText(text).width);
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
    // "|" too: bare, it is an em dash in text mode (OT1), so P|Mj|Cmax printed as P—Mj—Cmax.
    return String(s).replace(/[Σ≤≥−σλαβγ∞∈≠_%&#$^—–‘’“”|]/g, (c) => c === "|" ? "\\textbar{}" : (LATEX_CHAR_MAP[c] || c));
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
          (cc && cc.fill === "inset" ? ", fill=white, path picture={\\fill[" + colorName(cc.color) + "] ([shift={(0.12cm,0.12cm)}]path picture bounding box.south west) rectangle ([shift={(-0.12cm,-0.12cm)}]path picture bounding box.north east);}" : fillName ? ", fill=" + fillName : ", fill=white") + "}"
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
    // Routed like the live view, with the same ports (edgeRoute / edgePorts).
    const boxOf = (id) => positions[id] && { cx: positions[id].cx, cy: positions[id].cy, halfW: halfW, halfH: halfH };
    const portOf = edgePorts(edges, boxOf);
    const edgeLines = edges.map((e) => {
      const port = portOf(e);
      return edgeTikz(boxOf(e.from), boxOf(e.to), 6, port.pa, port.pb, SCALE);
    });

    const colorDefs = Array.from(usedColors.entries()).map(
      ([hex, name]) => "\\definecolor{" + name + "}{HTML}{" + hex + "}"
    );

    const tikzsetLines =
      "\\tikzset{\n" +
      "  pnode/.style={rounded corners=2pt, minimum width=" + (nodeW / SCALE).toFixed(2) + "cm" +
      ", minimum height=" + (nodeH / SCALE).toFixed(2) + "cm, align=center, font=\\large, text=black, line width=0.1cm},\n" +
      "  sedge/.style={->, gray!70, line width=0.1cm, shorten >=3pt},\n" +
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
        (cc && cc.fill === "inset" ? ", fill=white, path picture={\\fill[" + colorName(cc.color) + "] ([shift={(0.12cm,0.12cm)}]path picture bounding box.south west) rectangle ([shift={(-0.12cm,-0.12cm)}]path picture bounding box.north east);}" : fillName ? ", fill=" + fillName : ", fill=white") + "}"
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
    // Routed like the live view, with the same ports (edgeRoute / edgePorts).
    const boxOf = (id) => positions[id] && { cx: positions[id].cx, cy: positions[id].cy, halfW: positions[id].w / 2, halfH: positions[id].h / 2 };
    const portOf = edgePorts(edgesList.filter((e) => boxOf(e.from) && boxOf(e.to)), boxOf);
    const edgeLines = edgesList
      .map((e) => {
        const a = boxOf(e.from), b = boxOf(e.to);
        if (!a || !b) return "";
        const port = portOf(e);
        return edgeTikz(a, b, 6, port.pa, port.pb, SCALE);
      })
      .filter(Boolean);

    const colorDefs = Array.from(usedColors.entries()).map(
      ([hex, name]) => "\\definecolor{" + name + "}{HTML}{" + hex + "}"
    );

    const tikzsetLines =
      "\\tikzset{\n" +
      "  pnode/.style={rounded corners=2pt, align=center, font=\\small, text=black, line width=0.1cm},\n" +
      "  sedge/.style={->, gray!70, line width=0.1cm, shorten >=3pt},\n" +
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

    const mBox = (p) => p && { cx: p.cx, cy: p.cy, halfW: nodeW / 2, halfH: nodeH / 2 };
    const mPortOf = edgePorts(mapEdges(map).filter((e) => !(hiddenIds && (hiddenIds.has(e.from) || hiddenIds.has(e.to)))), (id) => mBox(positions[id]));
    const linesSvg = mapEdges(map)
      .map((e) => {
        if (hiddenIds && (hiddenIds.has(e.from) || hiddenIds.has(e.to))) return "";
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return "";
        const axis = axisById(e.axis) || (e.axis ? { label: e.axis } : null);
        const port = mPortOf(e);
        return (
          '<path data-from="' + escapeHtml(e.from) + '" data-to="' + escapeHtml(e.to) +
          '" data-pa="' + port.pa + '" data-pb="' + port.pb + '" fill="none" d="' + edgePathD(mBox(a), mBox(b), 5, port.pa, port.pb) +
          '" stroke="' + MAP_EDGE_COLOR + '" stroke-width="2" marker-end="url(#map-arrow)">' +
          (axis ? "<title>" + escapeHtml(axis.label) + "</title>" : "") +
          "</path>"
        );
      })
      .join("");

    const nodesHtml = visibleNodes
      .map((n) => {
        const p = problemById(n.problemId);
        if (!p) return "";
        const pos = positions[n.problemId];
        const cc = classicalClassById(effective[n.problemId]);
        const bg = classBg(cc, "var(--panel-bg)", MAP_NODE_RING);
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
          (classBg(c, "transparent", 2)) + ";border:2px " + (c.border || "solid") + " " + c.color +
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
      '<p class="map-hint"><span class="map-hint-icon">i</span> Double-click a node for its citations and ' +
      "parameterized results. Drag a node past the diagram's edge to hide it, " +
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
    fitMapCanvasSoon(els.viewMap);
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
      .querySelectorAll('path[data-from="' + cssEscape(id) + '"], path[data-to="' + cssEscape(id) + '"]')
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
  // Scale a diagram to fit BEFORE the browser paints whenever its view is
  // already on screen. Going through setTimeout leaves one painted frame
  // where the diagram is full size and flush left (fitMapCanvasToWidth sets
  // both the transform and the centering margin), which reads as a jitter
  // every time a view re-renders -- and the designer re-renders on every
  // click, since selecting a node redraws it. The deferred call is still
  // needed the first time a hidden view is shown: route() un-hides it right
  // after render, so until then clientWidth is 0 and there is no width to
  // fit into.
  function fitMapCanvasSoon(viewEl) {
    if (viewEl && viewEl.clientWidth > 0) fitMapCanvasToWidth(viewEl);
    else setTimeout(() => fitMapCanvasToWidth(viewEl), 0);
  }

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
  // Timestamp of the last click on any map node, shared across renders --
  // see the click handler below for why it can't live in the closure.
  const MAP_DOUBLE_CLICK_MS = 400;
  let MAP_LAST_NODE_CLICK = { id: null, at: 0 };
  function enableMapNodeDragging(canvas, nodeW, nodeH, mapId, viewEl, onSelect, dragDisabled, onOpen) {
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
      // The dragged box's centre is the one passed in (its style is not
      // written yet); the other end is read off the page.
      const boxOf = (pid) => {
        if (pid === id) return { cx: cx, cy: cy, halfW: halfW, halfH: halfH };
        const el = canvas.querySelector('.map-node[data-problem-id="' + cssEscape(pid) + '"]');
        return el ? { cx: parseFloat(el.style.left) + halfW, cy: parseFloat(el.style.top) + halfH, halfW: halfW, halfH: halfH } : null;
      };
      svg.querySelectorAll('path[data-from="' + cssEscape(id) + '"], path[data-to="' + cssEscape(id) + '"]').forEach((line) => {
        const a = boxOf(line.dataset.from), b = boxOf(line.dataset.to);
        if (!a || !b) return;
        line.setAttribute("d", edgePathD(a, b, 5, +line.dataset.pa || 0, +line.dataset.pb || 0));
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
      // DOUBLE click opens the side panel, in place rather than navigating
      // (a real page nav would be jarring while reviewing a map). Single
      // click is left to the view: the designer selects the node with it,
      // and on a plain map it does nothing, so arranging a diagram never
      // throws a panel over the top of it. Dragging suppresses both via
      // drag.moved below.
      //
      // Detected from timestamps instead of a "dblclick" listener because
      // the designer re-renders the entire view on the first click (to move
      // the selection), which replaces this element before a native
      // dblclick could be dispatched on it. Hence MAP_LAST_NODE_CLICK at
      // module scope: it has to outlive the closure each render throws away.
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (drag && drag.moved) return;
        const id = el.dataset.problemId;
        const now = Date.now();
        const doubled = MAP_LAST_NODE_CLICK.id === id && now - MAP_LAST_NODE_CLICK.at < MAP_DOUBLE_CLICK_MS;
        // Reset after opening, so a third click doesn't count as another
        // double with the second.
        MAP_LAST_NODE_CLICK = doubled ? { id: null, at: 0 } : { id: id, at: now };
        if (doubled) {
          (onOpen || openProblemPanel)(id);
          return;
        }
        if (onSelect) onSelect(id);
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
      // The dragged box's centre is the one passed in (its style is not
      // written yet); the other end is read off the page.
      const boxOf = (pid) => {
        if (pid === id) return { cx: cx, cy: cy, halfW: halfW, halfH: halfH };
        const el = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(pid) + '"]');
        if (!el) return null;
        const h = halfSizeOf(pid);
        return { cx: parseFloat(el.style.left) + h.halfW, cy: parseFloat(el.style.top) + h.halfH, halfW: h.halfW, halfH: h.halfH };
      };
      svg.querySelectorAll('path[data-sz-from="' + cssEscape(id) + '"], path[data-sz-to="' + cssEscape(id) + '"]').forEach((line) => {
        const a = boxOf(line.dataset.szFrom), b = boxOf(line.dataset.szTo);
        if (!a || !b) return;
        line.setAttribute("d", edgePathD(a, b, 3, +line.dataset.pa || 0, +line.dataset.pb || 0));
      });
    }

    // The nodes moving in this drag: the whole selection when the node
    // under the cursor belongs to it, otherwise just that node.
    function dragGroupFor(id) {
      if (!SZ_SELECTED_IDS.has(id)) return [id];
      return Array.from(SZ_SELECTED_IDS).filter((x) => !SZ_HIDDEN_IDS.has(x));
    }
    function markSelected(id, on) {
      const el = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(id) + '"]');
      if (el) el.classList.toggle("sz-selected", on);
    }
    canvas.querySelectorAll(".sz-node").forEach((el) => {
      el.classList.toggle("sz-selected", SZ_SELECTED_IDS.has(el.dataset.szId));
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        // While an arrow is being drawn a node is a target to click, not
        // something to move -- see szArrowPick in the click handler.
        if (SZ_ARROW_MODE) return;
        const id = el.dataset.szId;
        const group = dragGroupFor(id).map((gid) => {
          const gel = canvas.querySelector('.sz-node[data-sz-id="' + cssEscape(gid) + '"]');
          return gel && { id: gid, el: gel, left0: parseFloat(gel.style.left), top0: parseFloat(gel.style.top),
            halfW: gel.offsetWidth / 2, halfH: gel.offsetHeight / 2 };
        }).filter(Boolean);
        drag = {
          el,
          id: id,
          startX: e.clientX,
          startY: e.clientY,
          left0: parseFloat(el.style.left),
          top0: parseFloat(el.style.top),
          halfW: el.offsetWidth / 2,
          halfH: el.offsetHeight / 2,
          moved: false,
          group: group,
        };
      });
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (drag && drag.moved) return;
        const id = el.dataset.szId;
        if (SZ_ARROW_MODE) { szArrowPick(id); return; }
        // Shift- (or cmd/ctrl-) click builds the selection instead of
        // opening the panel; a plain click clears it and opens the panel as
        // before.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          if (SZ_SELECTED_IDS.has(id)) { SZ_SELECTED_IDS.delete(id); markSelected(id, false); }
          else { SZ_SELECTED_IDS.add(id); markSelected(id, true); }
          szUpdateHistoryButtons();
          return;
        }
        if (SZ_SELECTED_IDS.size) {
          Array.from(SZ_SELECTED_IDS).forEach((x) => markSelected(x, false));
          SZ_SELECTED_IDS = new Set();
          szUpdateHistoryButtons();
        }
        openSchedulingZooPanel(id);
      });
    });

    // ---- drag a box over empty canvas to select everything inside it ----
    // Positions are read and written in canvas units, so every client
    // coordinate is divided by the canvas's scale first (the whole diagram
    // is drawn shrunk -- see fitMapCanvasToWidth); without that the box
    // lands nowhere near the cursor on a map that has been scaled down.
    let marquee = null;
    const toCanvas = (clientX, clientY) => {
      const scale = parseFloat(canvas.dataset.scale) || 1;
      const r = canvas.getBoundingClientRect();
      return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
    };
    const nodeBoxes = () => Array.from(canvas.querySelectorAll(".sz-node"))
      .filter((el) => !el.classList.contains("node-hidden"))
      .map((el) => ({ el: el, id: el.dataset.szId,
        left: parseFloat(el.style.left), top: parseFloat(el.style.top),
        w: el.offsetWidth, h: el.offsetHeight }));

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest(".sz-node")) return;   // a node drag, not a box
      if (SZ_ARROW_MODE) return;                  // picking an arrow's ends
      const start = toCanvas(e.clientX, e.clientY);
      const box = document.createElement("div");
      box.className = "sz-marquee";
      canvas.appendChild(box);
      marquee = { start: start, box: box, additive: e.shiftKey || e.metaKey || e.ctrlKey, moved: false };
      if (!marquee.additive) {
        SZ_SELECTED_IDS.forEach((id) => markSelected(id, false));
        SZ_SELECTED_IDS = new Set();
      }
    });

    document.addEventListener("pointermove", (e) => {
      if (!marquee) return;
      const now = toCanvas(e.clientX, e.clientY);
      const left = Math.min(marquee.start.x, now.x), top = Math.min(marquee.start.y, now.y);
      const width = Math.abs(now.x - marquee.start.x), height = Math.abs(now.y - marquee.start.y);
      if (width > 3 || height > 3) marquee.moved = true;
      marquee.box.style.left = left + "px";
      marquee.box.style.top = top + "px";
      marquee.box.style.width = width + "px";
      marquee.box.style.height = height + "px";
      // Anything the box touches counts, so a node only half covered is in.
      nodeBoxes().forEach((n) => {
        const hit = n.left < left + width && left < n.left + n.w && n.top < top + height && top < n.top + n.h;
        const selected = hit || (marquee.additive && SZ_SELECTED_IDS.has(n.id));
        n.el.classList.toggle("sz-selected", selected);
      });
    });

    document.addEventListener("pointerup", () => {
      if (!marquee) return;
      const box = marquee.box;
      const wasDrag = marquee.moved;
      marquee = null;
      box.remove();
      if (!wasDrag) { szUpdateHistoryButtons(); return; }
      SZ_SELECTED_IDS = new Set(
        Array.from(canvas.querySelectorAll(".sz-node.sz-selected")).map((el) => el.dataset.szId)
      );
      szUpdateHistoryButtons();
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
      // Every node in the group moves by the same delta, so a selection
      // keeps its shape.
      drag.group.forEach((g) => {
        const left = g.left0 + dx, top = g.top0 + dy;
        g.el.style.left = left + "px";
        g.el.style.top = top + "px";
        updateEdgesFor(g.id, left + g.halfW, top + g.halfH, g.halfW, g.halfH);
      });
      // Dragging past the diagram's own frame arms the node -- or the whole
      // group -- for deletion; dropping it there hides them (and their
      // edges) from this view only.
      const outOfFrame = nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY);
      drag.group.forEach((g) => g.el.classList.toggle("delete-armed", outOfFrame));
      if (wrap) wrap.classList.toggle("delete-armed", outOfFrame);
    });

    document.addEventListener("pointerup", (e) => {
      if (wrap) wrap.classList.remove("delete-armed");
      if (drag && drag.moved && nodeDraggedOutOfFrame(wrap, e.clientX, e.clientY)) {
        // Snap back to the pre-drag position (and re-anchor its edges there)
        // BEFORE hiding -- setSzNodeHidden just toggles display:none, it
        // doesn't touch left/top, so without this the node would reappear
        // wherever it was dropped (off-canvas) instead of where it was.
        drag.group.forEach((g) => {
          g.el.style.left = g.left0 + "px";
          g.el.style.top = g.top0 + "px";
          updateEdgesFor(g.id, g.left0 + g.halfW, g.top0 + g.halfH, g.halfW, g.halfH);
          SZ_HIDDEN_IDS.add(g.id);
          setSzNodeHidden(canvas, g.id, true);
          g.el.classList.remove("delete-armed", "sz-selected");
          SZ_SELECTED_IDS.delete(g.id);
        });
        // One stack entry for the whole group, so one Undo restores it all.
        SZ_HIDDEN_STACK.push(drag.group.length === 1 ? drag.group[0].id : drag.group.map((g) => g.id));
        SZ_HIDDEN_REDO_STACK = [];
        szUpdateHistoryButtons();
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
  // ---- routed arrows -------------------------------------------------
  // Out of the box straight, one diagonal, into the box straight, with
  // rounded bends, each arrow at a port of its own along the box's edge --
  // the style of the concept maps on laxarchive.org. Nothing about the
  // layout changes: a long arrow still passes behind the boxes between its
  // ends. ROUTED_ARROWS false gives back the centre-to-centre line every
  // map drew before.
  const ROUTED_ARROWS = true;
  const ARROW_STUB = 12, ARROW_BEND = 5, ARROW_PORT_GAP = 14;
  // a, b: { cx, cy, halfW, halfH }. gap: how far short of b's edge the
  // head stops (the number the old pullBackToRect call used). pa, pb: port
  // offsets along the edge the arrow leaves and enters by (edgePorts).
  // The waypoints of an arrow: four when routed (box edge, end of the stub,
  // start of the other stub, box edge), two for the straight line. `bend`
  // is the corner radius to round the two middle points with.
  function edgeRoute(a, b, gap, pa, pb) {
    pa = pa || 0; pb = pb || 0;
    if (ROUTED_ARROWS && a && b) {
      const s = b.cy >= a.cy ? 1 : -1;
      const x0 = a.cx + pa, y0 = a.cy + s * a.halfH;
      const x3 = b.cx + pb, y3 = b.cy - s * b.halfH - s * gap;
      // The stubs take what room there is between the two boxes, up to
      // ARROW_STUB each; with less than a few pixels (the same row, or
      // overlapping boxes) it is the straight line below.
      const stub = Math.min(ARROW_STUB, (s * (y3 - y0)) / 2);
      const y1 = y0 + s * stub, y2 = y3 - s * stub;
      if (stub >= 3) {
        const dx = x3 - x0, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(dx) < 0.5 || len < 1) return { points: [{ x: x0, y: y0 }, { x: x3, y: y3 }], bend: 0 };
        // The bend is rounded off the stub, and never more than half of it,
        // so a straight piece of stub always shows.
        return { points: [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x3, y: y2 }, { x: x3, y: y3 }],
          bend: Math.min(ARROW_BEND, len / 2, stub / 2) };
      }
    }
    const tip = pullBackToRect(a.cx, a.cy, b.cx, b.cy, b.halfW, b.halfH, gap);
    return { points: [{ x: a.cx, y: a.cy }, { x: tip.x, y: tip.y }], bend: 0 };
  }
  function edgePathD(a, b, gap, pa, pb) {
    const r1 = (v) => Math.round(v * 10) / 10;
    const route = edgeRoute(a, b, gap, pa, pb);
    const P = route.points;
    if (P.length < 4) return "M" + r1(P[0].x) + "," + r1(P[0].y) + " L" + r1(P[1].x) + "," + r1(P[1].y);
    const r = route.bend;
    const s = P[1].y >= P[0].y ? 1 : -1;
    const dx = P[2].x - P[1].x, dy = P[2].y - P[1].y, len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len, uy = dy / len;
    return "M" + r1(P[0].x) + "," + r1(P[0].y) + " L" + r1(P[1].x) + "," + r1(P[1].y - s * r) +
      " Q" + r1(P[1].x) + "," + r1(P[1].y) + " " + r1(P[1].x + ux * r) + "," + r1(P[1].y + uy * r) +
      " L" + r1(P[2].x - ux * r) + "," + r1(P[2].y - uy * r) +
      " Q" + r1(P[2].x) + "," + r1(P[2].y) + " " + r1(P[2].x) + "," + r1(P[2].y + s * r) +
      " L" + r1(P[3].x) + "," + r1(P[3].y);
  }
  // The same arrow for a TikZ figure: the waypoints as a polyline, the
  // bends rounded by TikZ itself. `scale` is the export's px-per-cm.
  function edgeTikz(a, b, gap, pa, pb, scale) {
    const route = edgeRoute(a, b, gap, pa, pb);
    const pt = (q) => "(" + (q.x / scale).toFixed(2) + "," + (-q.y / scale).toFixed(2) + ")";
    const opts = route.bend ? "sedge, rounded corners=" + (route.bend / scale).toFixed(2) + "cm" : "sedge";
    return "\\draw[" + opts + "] " + route.points.map(pt).join(" -- ") + ";";
  }
  // A port for every arrow: the arrows leaving a box are spread along its
  // edge in the order of where they go, those entering it in the order of
  // where they come from, so several arrows into one box arrive side by
  // side instead of on one point. Returns a lookup edge -> { pa, pb }.
  function edgePorts(edges, boxOf) {
    const key = (e) => e.from + "\u0000" + e.to;
    const outs = {}, ins = {}, ports = {};
    edges.forEach((e) => {
      if (!boxOf(e.from) || !boxOf(e.to)) return;
      (outs[e.from] = outs[e.from] || []).push(e);
      (ins[e.to] = ins[e.to] || []).push(e);
    });
    const spread = (byNode, side) => Object.keys(byNode).forEach((id) => {
      const box = boxOf(id);
      const other = (e) => boxOf(side === "pa" ? e.to : e.from);
      const list = byNode[id].slice().sort((x, y) => other(x).cx - other(y).cx);
      const k = list.length;
      const step = Math.min(ARROW_PORT_GAP, Math.max(0, (2 * box.halfW - 10) / k));
      list.forEach((e, i) => { (ports[key(e)] = ports[key(e)] || { pa: 0, pb: 0 })[side] = Math.round((i - (k - 1) / 2) * step * 10) / 10; });
    });
    spread(outs, "pa");
    spread(ins, "pb");
    return (e) => ports[key(e)] || { pa: 0, pb: 0 };
  }

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
