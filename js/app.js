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
          btn.style.background = cls ? cls.color : "#868e96";
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
      '<div class="detail-class-badge" style="background:' + (cls ? cls.color : "#868e96") + '">' +
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
  }

  function detailField(label, value) {
    if (!value) return "";
    return '<div class="detail-field"><h4>' + label + "</h4><p>" + escapeHtml(value) + "</p></div>";
  }
  function detailFieldHtml(label, html) {
    return '<div class="detail-field"><h4>' + label + "</h4><p>" + html + "</p></div>";
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

    const effectiveResults = effectiveResultsForProblem(p.id);
    const resultsHtml = effectiveResults.length
      ? '<ul class="result-list">' +
        effectiveResults
          .map((r) => {
            const param = paramById(r.parameter);
            const cls = classById(r.class);
            return (
              '<li class="result-row">' +
              '<div class="param-name">' + (param ? param.symbol : r.parameter) +
              '<span class="sym">' + (param ? param.name : "") + "</span></div>" +
              '<div class="result-body"><p>' + (r.note || "") + "</p>" +
              '<p>' + citeLinks(r.referenceKeys) +
              (r.confidence ? ' <span class="conf-dot ' + escapeHtml(r.confidence) + '" title="' +
                escapeHtml(confidenceLabel(r.confidence)) + '"></span> <em style="color:var(--muted);font-size:0.8em">' +
                escapeHtml(r.confidence) + "</em>" : "") +
              "</p></div>" +
              '<span class="class-pill" style="background:' + (cls ? cls.color : "#868e96") + '">' +
              (cls ? cls.label : r.class) + "</span>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p style="color:var(--muted)">No parameterized results recorded for this problem yet.</p>';

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

    const cc = classicalClassById(effectiveClassForProblem(p.id));
    const ccBadge = cc
      ? '<span class="class-pill" style="background:' +
        (cc.fill ? cc.color : "var(--panel-bg)") +
        ";border:2px " + (cc.border || "solid") + " " + cc.color + ";color:" + (cc.fill ? "#111" : "var(--fg)") +
        '">' + cc.label + "</span> "
      : "";

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

  function computeEffectiveClasses(map) {
    const effective = {};
    const visiting = new Set();
    function resolve(problemId) {
      if (effective[problemId] !== undefined) return effective[problemId];
      const p = problemById(problemId);
      let result = p ? p.classicalClass : null;
      if ((!result || result === "unclaimed") && !visiting.has(problemId)) {
        visiting.add(problemId);
        let best = null;
        map.edges.forEach((e) => {
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
        map.edges.forEach((e) => {
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

    const linesSvg = map.edges
      .map((e) => {
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return "";
        const axis = axisById(e.axis);
        const tip = pullBackPoint(a.cx, a.cy, b.cx, b.cy, nodeH / 2 + 8);
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

    const axisLabelsHtml = (map.axisLabels || [])
      .map((a) => {
        const left = MAP_MARGIN + (a.col - 1) * MAP_COL_W;
        const top = MAP_MARGIN + a.row * MAP_ROW_H + (a.col - 1) * colStagger;
        return '<div class="map-axis-label" style="left:' + left + "px;top:" + top + 'px">' + escapeHtml(a.text) + "</div>";
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
      '<div class="map-page-header"><h2>' + escapeHtml(map.title) + "</h2><p>" + escapeHtml(map.description || "") +
      '</p><p class="map-drag-hint">Drag any node to declutter overlapping edges — layout is per-session, not saved.</p></div>' +
      '<div class="map-canvas-wrap"><div class="map-canvas" style="width:' + width + "px;height:" + height + 'px">' +
      '<svg class="map-edge-svg" width="' + width + '" height="' + height + '">' + arrowDef + linesSvg + "</svg>" +
      axisLabelsHtml + nodesHtml +
      "</div></div>" +
      '<div class="map-legend">' + classLegendHtml + "</div>" +
      excludedHtml +
      "</div>";

    enableMapNodeDragging(els.viewMap.querySelector(".map-canvas"), nodeW, nodeH);
  }

  function enableMapNodeDragging(canvas, nodeW, nodeH) {
    if (!canvas) return;
    const svg = canvas.querySelector(".map-edge-svg");
    let drag = null; // { el, startX, startY, left0, top0, moved }

    canvas.querySelectorAll(".map-node").forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        drag = {
          el,
          id: el.dataset.problemId,
          startX: e.clientX,
          startY: e.clientY,
          left0: parseFloat(el.style.left),
          top0: parseFloat(el.style.top),
          moved: false,
        };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener("pointermove", (e) => {
        if (!drag || drag.el !== el) return;
        const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        const left = drag.left0 + dx, top = drag.top0 + dy;
        el.style.left = left + "px";
        el.style.top = top + "px";
        const cx = left + nodeW / 2, cy = top + nodeH / 2;
        svg.querySelectorAll('line[data-from="' + cssEscape(drag.id) + '"]').forEach((line) => {
          line.setAttribute("x1", cx);
          line.setAttribute("y1", cy);
          // source moved; recompute the arrow tip's pullback relative to the (unmoved) target center
          const targetEl = canvas.querySelector('.map-node[data-problem-id="' + cssEscape(line.dataset.to) + '"]');
          if (targetEl) {
            const tcx = parseFloat(targetEl.style.left) + nodeW / 2, tcy = parseFloat(targetEl.style.top) + nodeH / 2;
            const tip = pullBackPoint(cx, cy, tcx, tcy, nodeH / 2 + 8);
            line.setAttribute("x2", tip.x);
            line.setAttribute("y2", tip.y);
          }
        });
        svg.querySelectorAll('line[data-to="' + cssEscape(drag.id) + '"]').forEach((line) => {
          const x1 = parseFloat(line.getAttribute("x1")), y1 = parseFloat(line.getAttribute("y1"));
          const tip = pullBackPoint(x1, y1, cx, cy, nodeH / 2 + 8);
          line.setAttribute("x2", tip.x);
          line.setAttribute("y2", tip.y);
        });
      });
      el.addEventListener("pointerup", (e) => {
        if (drag && drag.el === el && drag.moved) {
          const suppressClick = (ev) => {
            ev.preventDefault();
            el.removeEventListener("click", suppressClick);
          };
          el.addEventListener("click", suppressClick);
        }
        drag = null;
      });
    });
  }

  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  // Point along the a->b segment, pulled back from b by `dist`, so the
  // arrowhead lands just outside the target node's box instead of being
  // hidden underneath it.
  function pullBackPoint(ax, ay, bx, by, dist) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const d = Math.min(dist, len - 1);
    return { x: bx - (dx / len) * d, y: by - (dy / len) * d };
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
