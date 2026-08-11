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
    viewGlossary: document.getElementById("view-glossary"),
    viewReferences: document.getElementById("view-references"),
    navLinks: document.querySelectorAll(".site-nav a"),
  };

  const EMPTY_BETA_TOKEN = "∅";
  const VIEWS = { "/": els.viewSearch, "/glossary": els.viewGlossary, "/references": els.viewReferences };

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

    let matched = null;
    let problemMatch = /^\/problem\/(.+)$/.exec(path);

    if (problemMatch) {
      renderProblemPage(decodeURIComponent(problemMatch[1]));
      els.viewProblem.hidden = false;
      matched = null; // no top-level nav item highlighted
    } else if (VIEWS[path]) {
      VIEWS[path].hidden = false;
      if (path === "/glossary") renderGlossary();
      if (path === "/references") renderReferences();
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
    let illustrative = 0, total = 0;
    DATA.problems.forEach((p) =>
      p.results.forEach((r) => {
        total++;
        if (r.confidence === "illustrative") illustrative++;
      })
    );
    els.bannerCount.textContent = illustrative + " of " + total + " result cells";
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
            (result.confidence === "illustrative"
              ? '<span class="conf-flag" title="Illustrative — not verified">•</span>'
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
      detailField(
        "Confidence",
        result.confidence === "verified"
          ? "Verified — cites a known published result."
          : "Illustrative — placeholder standing in for a real result; verify before relying on it."
      ) +
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

    const resultsHtml = p.results.length
      ? '<ul class="result-list">' +
        p.results
          .map((r) => {
            const param = paramById(r.parameter);
            const cls = classById(r.class);
            return (
              '<li class="result-row">' +
              '<div class="param-name">' + (param ? param.symbol : r.parameter) +
              '<span class="sym">' + (param ? param.name : "") + "</span></div>" +
              '<div class="result-body"><p>' + (r.note || "") + "</p>" +
              '<p>' + citeLinks(r.referenceKeys) + "</p></div>" +
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

    els.viewProblem.innerHTML =
      '<div class="wiki-page">' +
      '<a class="wiki-back" href="#/">&larr; Back to search</a>' +
      "<h2>" + p.notation + "</h2>" +
      '<p class="wiki-alphabetagamma">' + p.name + "</p>" +
      '<div class="wiki-status"><b>Classical (unparameterized) status</b>' + escapeHtml(p.classicalStatus) + "</div>" +
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
