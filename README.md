# The Parameterized Scheduling Zoo

A faceted browser for the *parameterized* complexity of machine scheduling
problems — inspired by [The Scheduling Zoo](https://schedulingzoo.lip6.fr/search.php)
(T'kindt et al., LIP6), adapted for problems that are classified per
*parameter* (FPT, W[1]-hard, XP, para-NP-hard, open, ...) rather than with a
single verdict.

## Structure

- `data/problems.json` — the dataset. Each problem carries classical α|β|γ
  notation plus a list of `results`, one per parameterization
  (`{parameter, class, reference, note, confidence}`).
- `index.html` / `css/style.css` / `js/app.js` — a static, no-build UI:
  facet chips to filter problems by α/β/γ, a color-coded complexity matrix
  (problems × parameters), and a click-through detail panel per cell.

No build step, no framework — edit and refresh.

## Running locally

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## About the seed data

The dataset currently shipped is a **prototype seed**, not a vetted research
database. Each result cell carries a `confidence` field:

- `verified` — cites a landmark, checkable published result (e.g. Bodlaender
  & Fellows 1995 on precedence-constrained scheduling being W[2]-hard in the
  number of machines).
- `illustrative` — a plausible placeholder standing in for a real result,
  included to demonstrate how the UI renders that complexity class. These
  need to be checked against the literature (a good starting point is Mnich
  & van Bevern, *"Parameterized complexity of machine scheduling: 15 open
  problems"*, Computers & Operations Research, 2018) before being trusted.

To extend the dataset, add entries to `data/problems.json` following the
existing shape — no code changes needed unless you introduce a new
complexity class or parameter, in which case add it to the `complexityClasses`
or `parameters` arrays at the top of the file.
