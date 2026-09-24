#!/usr/bin/env python3
"""Convert the Scheduling Zoo's bib+notation.xml data into a JSON graph for
the Parameterized Scheduling Zoo's "Scheduling Zoo overview" view.

Key fix vs the first version: schedulingzoo's own data model treats "X" and
"X [y]" as two unrelated problem vectors (the bracket occupies real fields
in the "Parameterized complexity" section). That conflates a base problem
with a parameterized RESULT about it -- exactly the bug this site's own
model keeps separate (classicalClass vs a per-parameter results list). So:
merge every "X [y]" into base problem X, keep y as one of X's parameterized
results, and compute the generalization graph only over the base (non-
parameter) fields.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

# Usage: python3 scripts/convert_for_pzoo.py  (from anywhere)
# schedzoo's own repo is a git submodule at <repo>/schedulingzoo, left exactly
# as its authors ship it. Its extract.py reads "bib/..." relative to the
# working directory, so run from there, and write the result straight into
# the site's data folder.
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SZ_DIR = os.path.join(REPO_DIR, "schedulingzoo")
OUT_FILE = os.path.join(REPO_DIR, "data", "schedulingzoo.json")
os.chdir(SZ_DIR)
sys.path.insert(0, SZ_DIR)
import extract
import tools

NOTATION_FILE = "bib/notation.xml"


def latex_to_plain(s):
    """Convert this corpus's LaTeX-ish notation into plain Unicode text,
    matching the parameterized zoo's own display style (no MathJax/KaTeX
    anywhere on that site -- everything is plain text with real Unicode
    symbols)."""
    s = s.replace("\\\\", "")
    # (1-U_j) / (1-U_{ij}) is this corpus's "late/rejected" indicator --
    # exactly what the parameterized zoo already calls U_j (opposite sign
    # convention, same meaning). Collapse it before the generic subscript
    # pass so "w_j(1-U_j)" becomes "wjUj".
    s = re.sub(r"\(1-U_(\{[^{}]*\}|[A-Za-z0-9])\)", r"U_\1", s)
    repl = [
        (r"\\max", "max"), (r"\\min", "min"), (r"\\infty", "∞"),
        (r"\\geq", "≥"), (r"\\leq", "≤"), (r"\\in", "∈"), (r"\\neq", "≠"),
        (r"\\ldots", "…"), (r"\\subseteq", "⊆"), (r"\\cdot", "·"), (r"\\sum", "Σ"), (r"\\#", "#"),
        (r"\\chi", "χ"),
        (r"\\bar\s*d_j", "d̄j"), (r"\\bar\s*d", "d̄"),
        (r"\\textrm\{([^}]*)\}", r"\1"),
        # Only ever reached from prose explanations, never from a notation
        # string: \prec is how notation.xml writes the precedence relation
        # ("if $i\prec j$"), \mu the job shop's machine assignment, and
        # \not the negation of the \in just below it. Without these the
        # backslash-stripping at the end of this function silently glued
        # the command name onto the text ("if iprec j then ...").
        (r"\\prec", "≺"), (r"\\mu", "μ"), (r"\\not\s*\\in", "∉"),
        # \cal is a font, not a symbol: drop it but keep what it wrapped,
        # braces and all, so the subscript passes below still see "M_j".
        (r"\\cal\s*\{([^}]*)\}", r"\1"), (r"\\cal\s*", ""),
    ]
    for pat, to in repl:
        s = re.sub(pat, to, s)
    for _ in range(3):
        s = re.sub(r"([A-Za-z\\#∞])_\{([^{}]*)\}", r"\1\2", s)
        s = re.sub(r"([A-Za-z\\#∞])_([A-Za-z0-9])", r"\1\2", s)
    s = s.replace("{", "").replace("}", "")
    s = s.replace("\\", "")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("Σ ", "Σ")
    s = re.sub(r"\s*([≤≥∈≠∉≺])\s*", r"\1", s)
    s = re.sub(r"\s*\|\s*", "|", s)
    return s


DOI_PREFIX = re.compile(r"^\s*(?:https?://)?(?:dx\.)?doi\.org/", re.I)


# DOIs found by scripts/resolve_dois.py for the papers the .bib files give
# no URL or DOI for (most of them); see that script.
_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "doi_cache.json")
DOI_CACHE = json.load(open(_CACHE_PATH)) if os.path.exists(_CACHE_PATH) else {}


def doi_url(doi):
    """A resolvable link from a bibtex DOI field.

    BibTeX's doi field holds the bare identifier (10.xxxx/yyyy), and 20 of the
    corpus's 27 entries have it that way -- but 7 store a whole
    https://doi.org/... URL instead, which turns the obvious
    "https://doi.org/" + doi into https://doi.org/https://doi.org/10...., a
    link that 404s. So strip the prefix if it is already there. Reported
    upstream rather than corrected there; see the data note on this site.
    """
    if not doi:
        return None
    return "https://doi.org/" + DOI_PREFIX.sub("", doi).strip()


def bound_to_plain(s):
    return re.sub(r"\$([^$]*)\$", lambda m: latex_to_plain(m.group(1)), s)


def explanation_to_plain(s):
    """One <choice explanation=...> as displayable text.

    notation.xml's <aliases> section defines abbreviations (SETUP, TIMELAG,
    COMMUNICATIONDELAY) that stand in for a whole sentence inside an
    explanation, and schedzoo expands them with its own extract.unalias --
    so we call theirs rather than either re-describing the concept or
    shipping the raw placeholder, which is what the reader saw before
    ("equal setup times. SETUP").
    """
    return bound_to_plain(extract.unalias(s))


extract.read_bibtex()  # internally calls read_xml()
extract.make_reductions_transitive()

simple_reductions = extract.simple_reductions
complex_reductions = extract.complex_reductions
ref = extract.ref

# ---- which fields belong to the "Parameterized complexity" section
tree = ET.parse(NOTATION_FILE).getroot()
param_fields = set()
for section in tree[1]:
    if section.attrib.get("id") == "Parameters":
        for field in section:
            param_fields.add(field.attrib["name"])
core_fields = [f for f in extract.fields if f not in param_fields]
print(f"# param fields: {sorted(param_fields)}", file=sys.stderr)

# ---- the machine-environment ("type") field's own choices, straight from
# notation.xml's own <choice value=... explanation=...> -- schedzoo's own
# documentation text for what each of 1/P/Q/R/O/F/J actually means, kept
# verbatim (converted to plain text) rather than us re-describing it, per
# the request to retain and surface schedzoo's own explanation strings.
# bound_to_plain (not latex_to_plain) since these are prose WITH inline
# $..$ math spans, not one bare LaTeX expression like a notation string.
machine_env_explanations = {}
for section in tree[1]:
    for field in section:
        if field.attrib.get("name") == "type":
            for choice in field:
                machine_env_explanations[choice.attrib["value"]] = explanation_to_plain(choice.attrib.get("explanation", ""))

# ---- same idea, but for EVERY field -- used to explain, per edge, exactly
# which dimension(s) a generalization relaxes and what each side of that
# dimension means (schedzoo's own wording again, not ours). Keyed per-field
# (not the flat global `extract.explanation`, which collides different
# fields' empty/"no constraint" choices onto the same '' key).
field_choice_explanations = {}
for section in tree[1]:
    for field in section:
        name = field.attrib.get("name")
        if not name:
            continue
        field_choice_explanations[name] = {
            choice.attrib["value"]: explanation_to_plain(choice.attrib.get("explanation", "")) for choice in field
        }



# ---- LaTeX accents in bib fields -> Unicode -----------------------------
# Authors' names in the bibliography are TeX ("D{\'a}niel", "F{\u{a}}nic{\u{a}}",
# "B{\l}a{\.z}ewicz"); the site shows them as text, so they are decoded here.
# Combining marks + NFC give the precomposed letter where one exists.
_TEX_COMBINING = {"'": "\u0301", '"': "\u0308", "`": "\u0300", "^": "\u0302", "~": "\u0303",
                  "v": "\u030c", "u": "\u0306", "c": "\u0327", ".": "\u0307", "H": "\u030b", "=": "\u0304",
                  "r": "\u030a", "k": "\u0328"}
_TEX_LETTERS = {"\\i": "\u0131", "\\j": "\u0237", "\\l": "\u0142", "\\L": "\u0141", "\\ss": "\u00df",
                "\\o": "\u00f8", "\\O": "\u00d8", "\\aa": "\u00e5", "\\AA": "\u00c5", "\\ae": "\u00e6",
                "\\AE": "\u00c6", "\\oe": "\u0153", "\\OE": "\u0152"}
_TEX_ACCENT_RE = re.compile(r"\\([\'\"`^~=.]|[vucHrk](?![a-zA-Z]))\s*(?:\{\s*(\\i|\\j|[a-zA-Z])\s*\}|(\\i|\\j|[a-zA-Z]))")
def detex(s):
    """Decode the TeX accents and special letters a bib field may carry."""
    if not s:
        return s
    import unicodedata
    def acc(m):
        base = m.group(2) or m.group(3)
        # \'\i is an i whose dot the accent replaces: the plain letter composes.
        base = {"\\i": "i", "\\j": "j"}.get(base, _TEX_LETTERS.get(base, base))
        return base + _TEX_COMBINING[m.group(1)]
    prev = None
    while prev != s:
        prev = s
        s = _TEX_ACCENT_RE.sub(acc, s)
    for cmd, ch in _TEX_LETTERS.items():
        s = re.sub(re.escape(cmd) + r"(?![a-zA-Z])\s*(\{\})?", ch, s)
    s = s.replace("{", "").replace("}", "")
    return unicodedata.normalize("NFC", s)

def reduces(src, dst):
    """Is src problem a particular case of dst problem? (ported from search.py)"""
    failed = []
    for key in src:
        arc = (src[key], dst[key])
        if arc[0] != arc[1] and arc not in simple_reductions[key]:
            failed.append(key)
    if not failed:
        return True
    failed_set = set(failed)
    for support in complex_reductions:
        if failed_set.issubset(set(support)):
            S = tuple(src[f] for f in support)
            D = tuple(dst[f] for f in support)
            if (S, D) in complex_reductions[support]:
                return True
    return False


# ---- group every result by BASE problem (bracket stripped), collecting
# both its classical (no-bracket) results and its parameterized (bracket)
# results separately.
bases = {}  # base_name -> {"core_vec":..., "classical":[...], "params":[...]}
for (problem_vec, css_class, problem_name, bound, key) in extract.results:
    base_name = problem_name
    param_label = None
    if base_name.endswith("]") and "[" in base_name:
        i = base_name.index("[")
        param_label = latex_to_plain(base_name[i + 1:-1]).replace(";", "+")
        base_name = base_name[:i].rstrip()

    if base_name not in bases:
        core_vec = dict(problem_vec)
        for f in param_fields:
            core_vec[f] = ""
        bases[base_name] = {"core_vec": core_vec, "classical": [], "params": []}
    entry = bases[base_name]

    bib = ref[key]
    citation = {
        "kind": css_class,
        "bound": bound_to_plain(bound),
        "bibkey": key,
        "author": detex(tools.getattr(bib, "author")),
        "title": tools.clean_bib(tools.getattr(bib, "title")),
        "year": tools.getattr(bib, "year"),
        "url": bib.get("URL") or doi_url(bib.get("DOI")) or doi_url((DOI_CACHE.get(key) or {}).get("doi")),
    }
    if param_label:
        citation["param"] = param_label
        entry["params"].append(citation)
    else:
        entry["classical"].append(citation)

print(f"# raw base problem strings (after merging parameterized variants): {len(bases)}", file=sys.stderr)

# ---- some raw base-problem strings are the SAME problem, just typed with
# their restriction tokens in a different order in the source Annote text
# (schedzoo does not canonicalize this) -- e.g. "P|pj=p;rj|..." vs
# "P|rj;pj=p|...". Left alone, these become two separate nodes with
# identical core vectors, which both breaks the merge (same problem shown
# twice) and corrupts the reduces()/Hasse-reduction step below (two nodes
# whose vectors are literally equal reduce to EACH OTHER, a 2-cycle that
# can suppress real edges to their common specializations/generalizations).
# Canonicalize by the core vector itself and merge any raw strings that
# collide onto one node, picking the spelling with the most citations as
# the display name (ties broken alphabetically) since that's the most
# common attributed name.
def canon_key(core_vec):
    return tuple(sorted((f, core_vec[f]) for f in core_fields))

by_canon = {}
for base_name, entry in bases.items():
    by_canon.setdefault(canon_key(entry["core_vec"]), []).append(base_name)

merged_bases = {}
rename = {}  # raw base_name -> canonical display name
for key, raw_names in by_canon.items():
    raw_names.sort(key=lambda n: (-(len(bases[n]["classical"]) + len(bases[n]["params"])), n))
    display = raw_names[0]
    entry = {"core_vec": bases[display]["core_vec"], "classical": [], "params": []}
    for n in raw_names:
        rename[n] = display
        entry["classical"].extend(bases[n]["classical"])
        entry["params"].extend(bases[n]["params"])
    merged_bases[display] = entry

if len(merged_bases) != len(bases):
    print(f"# collapsed {len(bases) - len(merged_bases)} duplicate-order base strings "
          f"({len(bases)} -> {len(merged_bases)})", file=sys.stderr)
    for key, raw_names in by_canon.items():
        if len(raw_names) > 1:
            print(f"#   merged {raw_names} -> {rename[raw_names[0]]!r}", file=sys.stderr)

bases = merged_bases
names = list(bases.keys())
print(f"# base problems (final): {len(names)}", file=sys.stderr)
print(f"# result lines: {len(extract.results)}", file=sys.stderr)
print(f"# bib entries: {len(ref)}", file=sys.stderr)

def all_pairwise_edges():
    edges = []
    for a in names:
        va = bases[a]["core_vec"]
        for b in names:
            if a == b:
                continue
            vb = bases[b]["core_vec"]
            if reduces(va, vb):
                # va is a particular case of vb (vb more general): the edge
                # should read general -> specific, matching every other map
                # on this site (arrowhead points at the more specific
                # problem).
                edges.append((b, a))
    return edges

# ---- schedzoo's OWN reduction rules exactly as shipped, which is also our
# baseline: every edge drawn is compared against these, so an edge one of our
# added rules below makes possible can be marked as ours.
#
# This file used to correct two of schedzoo's rules here -- the setup-time
# chain under a single server, and the multiprocessor-task rule "" -> fix_j
# -- because each put a problem cited as polynomial above one cited NP-hard.
# Both corrections were sent upstream and merged (schedulingzoo PR #14), as
# were the form conditions and the "in in $P$" typo this file used to work
# around, so all four are gone from here: the submodule now ships them, and
# carrying our own copy would mean silently applying a fix twice if upstream
# ever revisited it.
schedzoo_pairs = set(all_pairwise_edges())
baseline_pairs = schedzoo_pairs

# ---- OUR OWN added reduction rules, same gap as the machine-count one
# below: the "processing times" field has rules BETWEEN restrictions
# (p_j=1 -> p_j=p, p_j=1 -> p_j\in\{1,2\}, p_{ij}=1 -> p_{ij}=p) but almost
# none FROM a restriction to the unrestricted field -- only the two values
# that encode something else entirely (p_{ij}\in\{p_j,\infty\} and
# p_{kj}=p_j) reduce to "". So equal or unit processing times were not a
# special case of arbitrary ones: Q||Cmax did not generalize Q|p_j=p|Cmax.
# Sound in every environment and for every objective in this corpus: an
# instance with all p_j equal (or all in {1,2}) IS an instance with
# arbitrary processing times, no padding or transformation involved -- the
# restriction is on the input, not on what a schedule may do. Only the three
# rules to "" are stated; p_j=1 -> "" and p_{ij}=1 -> "" then follow from
# schedzoo's own rules by transitivity. Checked before adding: of the 205
# relations this makes possible, none places a problem cited P above one
# cited NP-hard, and none places a pseudo-polynomial one above a strongly
# NP-hard one (the check that caught the S1 setup-time rule).
OUR_PROCESSING_TIME_RULES = [("p_j=p", ""), ("p_j\\in\\{1,2\\}", ""), ("p_{ij}=p", "")]
for pair in OUR_PROCESSING_TIME_RULES:
    simple_reductions["processing times"].add(pair)
extract.transitive_closure(simple_reductions["processing times"])

after_processing_pairs = set(all_pairwise_edges())
print(f"# processing-time rules: added {len(after_processing_pairs - baseline_pairs)} pairwise edges, "
      f"removed {len(baseline_pairs - after_processing_pairs)}", file=sys.stderr)

# ---- OUR OWN added reduction rule, layered on top of (never replacing)
# schedzoo's own data: "number of machines" has ZERO reduction rules in
# schedzoo's own notation.xml (confirmed: simple_reductions["number of
# machines"] == set()) -- not even m=2 being a special case of arbitrary m,
# let alone the chain below. Mathematically sound regardless of machine
# environment (P/Q/R: the extra machine(s) can simply be left unused; O/F/J:
# pad every job with a zero-duration operation on the extra machine) -- an
# m-machine algorithm/schedule always still works when more machines are
# available, for every regular objective in this corpus (Cmax, sum of
# completion/tardiness/flow times, Lmax, throughput -- none of them ever
# get WORSE with more machines to choose from). Chain, not just "-> arbitrary"
# directly, so e.g. "3" also generalizes "2" and "1", not only "" -- '1' here
# is schedzoo's own internal stand-in for single-machine problems (see the
# "no reduction rule connects 1 to P" data note below).
OUR_MACHINE_COUNT_RULES = [("1", "2"), ("2", "3"), ("3", "4"), ("4", "5"), ("5", "")]
for pair in OUR_MACHINE_COUNT_RULES:
    simple_reductions["number of machines"].add(pair)
extract.transitive_closure(simple_reductions["number of machines"])

augmented_edges = all_pairwise_edges()

# ---- OUR OWN third added rule: eligibility sets into unrelated machines.
# schedzoo has the rule "M_j;R -> ;R" (an unrelated-machines problem WITH
# eligibility sets is a special case of one without: p_ij = infinity encodes
# M_j) and it has P in Q in R -- but the two are never composed, because a
# complex rule only fires when the fields it does not mention are equal, and
# P|M_j| differs from R|| in the type as well. So R||X does not generalize
# P|M_j|X for ANY objective X here (R||Cmax, R||sum w_jC_j and R||sum w_jZ_j
# all missed it), although it is the textbook encoding: give job j the
# processing time p_j on every machine i in M_j and infinity elsewhere; for
# Q, p_j / s_i. It keeps the number of machines, the due dates, the weights
# and the release dates untouched, and changes only the processing times,
# so the measures of those (p_max, #p, ...) are the ones a parameterized
# result must not cross -- exactly the exclusions the P/Q-inside-R type
# change already carries (see TYPE_CHANGE_EXCLUDES).
#
# Stated as the two composed pairs, not as a new principle, and accepted
# only where they are the WHOLE difference between two problems (type and
# machine sets, nothing else): stacked on a further relaxation it would be
# an unchecked combination, the discipline kept below for the machine-count
# rule. Longer relations still arrive by transitivity through such pairs.
OUR_ELIGIBILITY_RULES = [(("M_j", "P"), ("", "R")), (("M_j", "Q"), ("", "R"))]
complex_reductions[("machine sets", "type")].update(OUR_ELIGIBILITY_RULES)
_with_eligibility = all_pairwise_edges()


def _diff_fields(general_id, specific_id):
    va, vb = bases[general_id]["core_vec"], bases[specific_id]["core_vec"]
    return {f for f in core_fields if va[f] != vb[f]}


eligibility_edges = {
    pair for pair in set(_with_eligibility) - set(augmented_edges)
    if _diff_fields(*pair) == {"type", "machine sets"}
}
print(f"# eligibility rule: {len(eligibility_edges)} new arrows "
      f"({len(set(_with_eligibility) - set(augmented_edges)) - len(eligibility_edges)} "
      f"stacked candidates left to transitivity)", file=sys.stderr)

# ---- restrict our own rule to SOLE-field cases only: letting it COMBINE
# with a simultaneous relaxation of some other field produced edges that
# contradict the endpoints' own direct citations -- 27 of 197 multi-field
# candidates did under schedzoo's rules as shipped, ALL of them involving
# S1 (e.g. P;S1|sj=s;pj=p|SwjUj "generalizing" P2;S1|pj=1|SwjUj, cited P
# and NP-hard). That turned out to be the setup-time rule corrected above:
# with the correction, 0 of the 170 remaining multi-field candidates
# contradict. The 74 sole-field candidates never did. Kept for now anyway,
# until the combined edges are reviewed on their own. So: only accept a
# new-because-of-us edge when "number of machines" is the sole differing
# field; never let it stack with another relaxation we haven't individually
# checked -- the exact discipline schedzoo's own reduction data lacks (see
# the "number of machines" data note).
def sole_diff_field(general_id, specific_id):
    va, vb = bases[general_id]["core_vec"], bases[specific_id]["core_vec"]
    diffs = [f for f in core_fields if va[f] != vb[f]]
    return diffs[0] if len(diffs) == 1 else None

excluded_multi_field = 0
full_edges = []
for pair in list(augmented_edges) + sorted(eligibility_edges):
    if pair in after_processing_pairs:
        full_edges.append(pair)
    elif sole_diff_field(*pair) == "number of machines" or pair in eligibility_edges:
        full_edges.append(pair)
    else:
        excluded_multi_field += 1

print(f"# full pairwise edges (general -> specific): {len(full_edges)}", file=sys.stderr)
print(f"# of which newly possible only because of our added machine-count rule: "
      f"{len(set(full_edges) - after_processing_pairs)}", file=sys.stderr)
print(f"# excluded: new edges that combined our rule with another relaxation "
      f"(unverified in combination): {excluded_multi_field}", file=sys.stderr)

full_set = set(full_edges)
by_src = {}
for (a, b) in full_edges:
    by_src.setdefault(a, []).append(b)

def is_redundant(a, b):
    for c in by_src.get(a, []):
        if c != a and c != b and (c, b) in full_set:
            return True
    return False

hasse_edges = [(a, b) for (a, b) in full_edges if not is_redundant(a, b)]
print(f"# edges after Hasse reduction: {len(hasse_edges)}", file=sys.stderr)

# ---- classify each node's CLASSICAL (non-parameterized) status into this
# site's own 5-tier model (P / weakly-NP-hard / NP-hard-unresolved /
# strongly-NP-hard / unclaimed), instead of schedzoo's own flat binary
# lower/upper split (schedzoo tags a result "lower" purely by keyword-
# matching the bound text against ['NP','hard','>=','\\geq',' no
# ','cannot','ETH'] -- it has no P-vs-weakly-vs-strongly notion at all).
# This is OUR added interpretation layer, computed only from phrasings
# schedzoo already uses consistently in its own bound text -- we do not
# edit their source data, only read it more precisely than they do.
# Deliberately conservative: only schedzoo's own small set of clean,
# unambiguous canonical phrases are matched (confirmed by inspecting the
# corpus: "is in P" x252, "is in Ppseudo" x29, "is strongly NP-hard" x299,
# "is NP-hard"/"is NP-complete" x76 cover the vast majority of citations).
# Anything else -- approximation ratios, APX-hardness, W[x]-hardness,
# competitive ratios -- does NOT establish exact classical P/NP-hard status
# by itself, so it is deliberately left unclassified ("unclaimed") rather
# than guessed at. One more pattern IS safe to add though: a citation that
# explicitly asserts EXACT solvability with a concrete polynomial runtime
# ("is solvable in O(n^5)", "can be solved in time O(n)", "is solvable by a
# linear program of size O(nm)") is just as much a "P" claim as "is in P"
# phrased differently -- found by checking that every such "solvable"-
# verb-anchored citation in the corpus is a genuine exact-solvability claim,
# never an approximation/competitive-ratio one (those are phrased with
# "has a/an ... approximation" or "-competitive", never "solvable").
RE_STRONG = re.compile(r"strongly NP-(hard|complete)", re.I)
RE_HARD = re.compile(r"\bis NP-(hard|complete)\b", re.I)
# "is (in )?P". This used to also accept a leading "in", to tolerate the
# "in in $P$" typo in Simons:83 (P|pj=p;rj|Lmax); that typo is fixed upstream
# (schedulingzoo PR #14), so the pattern no longer has to carry it.
RE_P = re.compile(r"^is (in )?P\b(?!seudo)")
RE_SOLVABLE_POLY = re.compile(r"\b(is |can be )?(solved|solvable) (in|by)\b[^.]*(O\(|polynomial time\b)", re.I)
RE_PSEUDO = re.compile(r"^is (in )?Ppseudo\b")

def classify_classical(classical):
    has_strong = any(r["kind"] == "lower" and RE_STRONG.search(r["bound"]) for r in classical)
    has_hard = any(r["kind"] == "lower" and RE_HARD.search(r["bound"]) for r in classical)
    has_pseudo = any(r["kind"] == "upper" and RE_PSEUDO.search(r["bound"]) for r in classical)
    has_p = any(r["kind"] == "upper" and (RE_P.search(r["bound"]) or RE_SOLVABLE_POLY.search(r["bound"])) for r in classical)
    if has_strong:
        return "strongly-NP-hard"
    if has_hard and has_pseudo:
        return "weakly-NP-hard"
    if has_hard:
        return "NP-hard-unresolved"
    if has_p:
        return "P"
    # A pseudo-polynomial algorithm and nothing else: an upper bound, the
    # hardness question open -- its own class, not "unclaimed".
    if has_pseudo:
        return "pseudo-open"
    return "unclaimed"


# ---- classify each PARAMETERIZED-result citation into this site's own
# FPT/XP/W[1]/W[2]/para-NP-hard vocabulary (the same complexityClasses used
# throughout the rest of the site), instead of taking schedzoo's flat
# lower/upper tag at face value. This matters because schedzoo's own
# "bounded number of machines" field (and similarly-shaped constant-value
# parameters) means "the parameter is fixed to SOME constant" -- a
# classical question ("is this poly for every fixed m?", i.e. XP) -- not
# "is this FPT w.r.t. m" in the modern parameterized-complexity sense.
# Schedzoo's own bound text actually distinguishes the two IN PRACTICE
# (confirmed against the corpus): "is fixed parameter tractable" only ever
# appears for genuine modern-FPT-theory citations, while a bare constant-
# parameter citation says "is in P" / "is in P_pseudo" instead -- so we
# read that distinction back out rather than treating both as equally
# "positive" (previously: any "upper" citation was painted green,
# incorrectly implying FPT for a citation that only established XP).
RE_FPT = re.compile(r"fixed[- ]parameter tractable", re.I)
RE_W2 = re.compile(r"W\[2\]-hard", re.I)
RE_W1 = re.compile(r"W\[1\]-hard", re.I)
RE_PARA_NP = re.compile(r"para-NP-(complete|hard)|unless\s+FPT\s*=\s*para-NP", re.I)
RE_PARAM_HARD = re.compile(r"\bis (strongly )?NP-(hard|complete)\b", re.I)


def classify_param_result(kind, bound):
    if kind == "lower":
        if RE_PARA_NP.search(bound) or RE_PARAM_HARD.search(bound):
            # NP-hard even when the parameter is held to a constant -- by
            # definition para-NP-hard, whether schedzoo phrased it as that
            # directly or just as "is NP-hard" on a [param]-tagged entry.
            return "paraNP"
        if RE_W2.search(bound):
            return "W2"
        if RE_W1.search(bound):
            return "W1"
        return None  # fine-grained ETH-style runtime bounds etc -- not classified
    else:
        if RE_FPT.search(bound):
            return "FPT"
        if RE_P.search(bound) or RE_PSEUDO.search(bound):
            # Constant-parameter classical result (see comment above) --
            # mathematically exactly XP's definition (poly time for every
            # fixed value of the parameter), NOT a claim that FPT holds.
            return "XP"
        return None  # approximation ratios, ad-hoc runtimes, etc.

# ---- emit JSON
nodes = []
# ---- the beta ("Constraints") fields, exported per node so the site can
# filter on them (precedence shape, batching, multiprocessor, no-wait, ...)
# rather than only on machine environment / objective / preemption. Only
# fields that are actually SET on at least one problem are worth carrying;
# a field left at "" everywhere would just be dead weight in the JSON.
# Machine environment, objective and preemption are excluded here because
# they already have their own dedicated top-level keys above.
SETTINGS_FIELDS = [
    f for f in core_fields
    if f not in ("type", "number of machines", "Objective function", "preemption")
    and any(bases[n]["core_vec"].get(f) for n in bases)
]
print(f"# settings fields exported: {SETTINGS_FIELDS}", file=sys.stderr)

class_counts = {}
for name in names:
    entry = bases[name]
    cv = entry["core_vec"]
    cc = classify_classical(entry["classical"])
    # An ONLINE problem is not measured on the P/NP-hard scale at all: its
    # jobs are revealed at their release times, so what limits an algorithm
    # is what it does not yet know, not how long it may compute. Its results
    # are competitive ratios, and those hold unconditionally -- an adversary
    # argument beats an algorithm with an NP oracle just as well, so none of
    # it turns on P != NP. Every one of these problems came out "unclaimed"
    # before, which the site renders as "open": a plain misstatement, since
    # several have a TIGHT competitive ratio (1|online-rj;pj=1;dj<=rj+2|SwjUj
    # is exactly the golden ratio). Only applied when the wording classifier
    # found nothing, so a genuine NP-hardness citation on an online problem
    # would still win.
    if cc == "unclaimed" and cv.get("release time") == "online-r_j":
        cc = "online"
    class_counts[cc] = class_counts.get(cc, 0) + 1
    nodes.append({
        "id": name,
        "notation": latex_to_plain(name),
        "objective": latex_to_plain(cv.get("Objective function", "")),
        "preemption": cv.get("preemption", ""),  # "" | "pmtn" | "restarts"
        # schedzoo's own parser canonicalizes "1|.." (single machine) down to
        # type='P' + number of machines='1' internally -- there's no actual
        # type='1' in its parsed vectors, even though notation.xml's own form
        # schema (and every classical paper) treats "1 machine" as its own
        # distinct, most-asked-about case. Undo that canonicalization here so
        # the filter shows what a user actually expects.
        "machineEnv": "1" if cv.get("number of machines") == "1" else cv.get("type", ""),
        # field name -> raw schedzoo value, only for fields this problem
        # actually sets (an unset field means "no such constraint", which
        # the filter treats as its own selectable state).
        "settings": {f: cv[f] for f in SETTINGS_FIELDS if cv.get(f)},
        # every core field this problem sets, raw -- lets the site compare two
        # problems field by field against fieldReductions below
        "vector": {f: cv[f] for f in core_fields if cv.get(f)},
        "classicalClass": cc,
        "classical": entry["classical"],
        "params": [dict(r, complexityClass=classify_param_result(r["kind"], r["bound"])) for r in entry["params"]],
    })
print(f"# classicalClass breakdown: {class_counts}", file=sys.stderr)

# ---- for each edge, record exactly which core field(s) differ between the
# general and specific node, with both sides' own schedzoo explanation text
# -- lets the site answer "why does this arrow exist?" (which dimension is
# being relaxed, in schedzoo's own words) instead of just asserting it.
def field_explanation(field, value):
    return field_choice_explanations.get(field, {}).get(value, "")

edges = []
for (a, b) in hasse_edges:
    va, vb = bases[a]["core_vec"], bases[b]["core_vec"]
    diffs = [
        {
            "field": f,
            "generalValue": latex_to_plain(va[f]),
            "generalExplanation": field_explanation(f, va[f]),
            "specificValue": latex_to_plain(vb[f]),
            "specificExplanation": field_explanation(f, vb[f]),
        }
        for f in core_fields
        if va[f] != vb[f]
    ]
    # True only when this exact (general, specific) pair was NOT reachable
    # under schedzoo's own rules as shipped. addedBy names the rule of ours
    # that made it reachable, in the order they were applied:
    # OUR_PROCESSING_TIME_RULES or OUR_MACHINE_COUNT_RULES. Frontend renders these green with that rule's
    # note; never marks an edge schedzoo's own data already implied.
    # (The two correction rules that used to appear here are upstream now --
    # see the baseline above -- so edges they explain are schedzoo's own.)
    added = (a, b) not in schedzoo_pairs
    added_by = None
    if added:
        if (a, b) in after_processing_pairs:
            added_by = "processing-times"
        elif (a, b) in eligibility_edges:
            added_by = "eligibility"
        else:
            added_by = "machine-count"
    edges.append({"from": a, "to": b, "diffs": diffs, "addedByUs": added, "addedBy": added_by})

# ---- OUR inference: carry parameterized HARDNESS (W[1], W[2], para-NP)
# from a special case up to the problems that generalize it -- but only along
# arrows known to keep the parameter bounded, which a plain "is a special
# case" arrow does not guarantee by itself (see Documentation > Arrow rule
# types). Deliberately conservative: an arrow carries a result only when
# every field it changes is one of the kinds below, the change is one of
# The Scheduling Zoo's own one-field rules, and every measure in the
# parameter is safe for that change. Positive results (FPT, XP) travel the
# other way, DOWN the same arrows, in the pass after this one; approximation
# results follow in the pass after that. Nothing is carried across machine
# counts, the online model, preemption or objective changes that only hold
# at a single threshold.
#
# How a general instance is built from the special one, per field:
# - the same instance, read with a wider value (a chain is an order, p_j=1 is
#   p_j=p with p=1, ...): every measure keeps its value -> all parameters
# - padding with data that is constant (weights 1, due dates 0, speeds 1,
#   eligible sets = all machines, sizes 1, delays 0): count parameters
#   become 1 and maxima become constants -- still bounded -- except the
#   measures built from the data being padded, listed as excluded
ALL_PARAMS = None  # every parameter is safe
PARAM_SAFE_FIELD_CHANGES = {
    # field: None = any one-field rule of that field keeps the instance as is
    "precedence relation": ALL_PARAMS,
    "processing times": ALL_PARAMS,
    "due date": ALL_PARAMS,
    "setup times": ALL_PARAMS,
    "batching": ALL_PARAMS,
    "number of jobs": ALL_PARAMS,
    "time lags": ALL_PARAMS,
    "communication delay": ALL_PARAMS,
    "transportation delays": ALL_PARAMS,
    "deadline": ALL_PARAMS,
    "job size": ALL_PARAMS,
    "machine sets": ALL_PARAMS,
}
# Padding release dates with r_j = 0 changes the time windows [r_j, d_j] and
# the slack d_j - r_j - p_j, so the window-based measures are not safe.
RELEASE_PADDING_EXCLUDES = {"pw(I)", "slackmax"}
# Machine environments: P inside Q is speeds 1 (same processing times); F
# inside J is the same instance. Q or P inside R rescales processing times
# (p_ij = p_j / s_i), so measures of the processing times are not safe.
TYPE_CHANGE_EXCLUDES = {("P", "Q"): set(), ("F", "J"): set(),
                        ("Q", "R"): {"pmax", "#p", "rank((pij))", "slackmax"},
                        ("P", "R"): {"pmax", "#p", "rank((pij))", "slackmax"}}
# Objectives, (specific, general): only paddings that give exactly the same
# objective value on every schedule -- weights 1 (X inside wX) and due dates
# 0 (completion time inside lateness/tardiness). Threshold-only rules (Cmax
# inside ΣUj, Lmax inside ΣTj) and flow-time rules (which need r_j = 0) are
# not carried.
_WEIGHT_PADDING = {("\\sum (1-U_j)", "\\sum w_j(1-U_j)"), ("\\sum Z_j", "\\sum w_jZ_j"), ("\\sum C_j", "\\sum w_jC_j"),
                   ("\\sum T_j", "\\sum w_jT_j"), ("\\sum F_j", "\\sum w_jF_j"), ("F_{\\max}", "\\max w_jF_j")}
_DUE_DATE_PADDING = {("C_{\\max}", "L_{\\max}"), ("\\sum C_j", "\\sum T_j"), ("\\sum w_jC_j", "\\sum w_jT_j")}
DUE_DATE_PADDING_EXCLUDES = {"pw(I)", "slackmax"}
# Machine counts in the shops (O/F/J, where the count is the number of
# operations per job): the instance with fewer machines is the instance with
# more machines whose extra operations have length zero, so due dates, weights
# and every count measure keep their value (#p gains the value 0, still
# bounded) and completion times do not change. That is exact only while
# nothing constrains what a zero-length operation may be or what surrounds
# it, so the arrow is carried only when none of these settings is in use:
# they fix the processing times (a zero would break p_ij=1 or p_ij=p), or
# add a delay, a resource or a wait around every operation.
SHOP_TYPES = {"O", "F", "J"}
ZERO_OPERATION_BLOCKERS = ("processing times", "setup times", "transportation delays", "robot", "server",
                           "batching", "time lags", "communication delay", "job size", "recirculation",
                           "no-wait", "no-idle")


def param_safe_tokens(general_id, specific_id):
    """The measures an arrow keeps bounded: ALL_PARAMS, a set of excluded
    measures (everything else is safe), or False when the arrow is not
    carried at all."""
    vg, vs = bases[general_id]["core_vec"], bases[specific_id]["core_vec"]
    excluded = set()
    for f in core_fields:
        g, s = vg[f], vs[f]
        if g == s:
            continue
        if f in PARAM_SAFE_FIELD_CHANGES and (s, g) in simple_reductions[f]:
            continue
        if f == "release time" and (s, g) == ("", "r_j"):
            excluded |= RELEASE_PADDING_EXCLUDES
            continue
        if f == "type" and (s, g) in TYPE_CHANGE_EXCLUDES:
            excluded |= TYPE_CHANGE_EXCLUDES[(s, g)]
            continue
        if f == "machine sets" and (s, g) == ("M_j", "") and vg["type"] == "R" and vs["type"] in ("P", "Q"):
            # OUR eligibility rule: p_ij = infinity encodes M_j, so the
            # instance keeps its machines, due dates and weights; the type
            # change to R contributes the processing-time exclusions itself.
            continue
        if (f == "number of machines" and vg["type"] == vs["type"] and vg["type"] in SHOP_TYPES
                and (s, g) in simple_reductions[f] and not any(vg[x] for x in ZERO_OPERATION_BLOCKERS)):
            continue
        if f == "Objective function" and (s, g) in _WEIGHT_PADDING:
            continue
        if f == "Objective function" and (s, g) in _DUE_DATE_PADDING:
            excluded |= DUE_DATE_PADDING_EXCLUDES
            continue
        return False
    return excluded


PARAM_HARDNESS_RANK = {"W1": 1, "W2": 2, "paraNP": 3}
parents_of = {}
for (a, b) in hasse_edges:
    parents_of.setdefault(b, []).append(a)
node_by_id = {n["id"]: n for n in nodes}
inherited_count = 0
for source in nodes:
    for r in source["params"]:
        cls = r.get("complexityClass")
        if cls not in PARAM_HARDNESS_RANK:
            continue
        tokens = set(r["param"].split("+"))
        canon = "+".join(sorted(tokens))
        # breadth-first up the arrows, so each problem records the shortest
        # chain the result reaches it by
        seen, frontier = {source["id"]}, [[source["id"]]]
        while frontier:
            next_frontier = []
            for path in frontier:
                for parent in parents_of.get(path[-1], []):
                    if parent in seen:
                        continue
                    safe = param_safe_tokens(parent, path[-1])
                    if safe is False or (safe is not ALL_PARAMS and tokens & safe):
                        continue
                    seen.add(parent)
                    target = node_by_id[parent]
                    chain = path + [parent]
                    own = [x for x in target["params"] if "+".join(sorted(x["param"].split("+"))) == canon
                           and PARAM_HARDNESS_RANK.get(x.get("complexityClass"), 0) >= PARAM_HARDNESS_RANK[cls]]
                    already = [x for x in target.setdefault("inheritedParams", [])
                               if "+".join(sorted(x["param"].split("+"))) == canon
                               and PARAM_HARDNESS_RANK[x["complexityClass"]] >= PARAM_HARDNESS_RANK[cls]]
                    if not own and not already:
                        target["inheritedParams"].append(dict(r, inheritedFrom=source["id"], via=list(reversed(chain)), direction="up"))
                        inherited_count += 1
                    next_frontier.append(chain)
            frontier = next_frontier

# ---- the same inference the other way for POSITIVE parameterized results
# (FPT, XP): an algorithm for a problem is an algorithm for every special
# case of it, so these travel DOWN the arrows -- along exactly the same
# parameter-safe arrows as above, since the special case has to keep the
# measure the result is stated for. FPT outranks XP, so an XP result never
# shadows an FPT one already there, and vice versa.
PARAM_POSITIVE_RANK = {"XP": 1, "FPT": 2}
children_of = {}
for (a, b) in hasse_edges:
    children_of.setdefault(a, []).append(b)


def canon_param(x):
    return "+".join(sorted(x["param"].split("+")))


inherited_positive = 0
for source in nodes:
    for r in source["params"]:
        cls = r.get("complexityClass")
        if cls not in PARAM_POSITIVE_RANK:
            continue
        tokens = set(r["param"].split("+"))
        canon = canon_param(r)
        seen, frontier = {source["id"]}, [[source["id"]]]
        while frontier:
            next_frontier = []
            for path in frontier:
                for child in children_of.get(path[-1], []):
                    if child in seen:
                        continue
                    safe = param_safe_tokens(path[-1], child)
                    if safe is False or (safe is not ALL_PARAMS and tokens & safe):
                        continue
                    seen.add(child)
                    target = node_by_id[child]
                    chain = path + [child]  # general -> ... -> specific already
                    own = [x for x in target["params"] if canon_param(x) == canon
                           and PARAM_POSITIVE_RANK.get(x.get("complexityClass"), 0) >= PARAM_POSITIVE_RANK[cls]]
                    already = [x for x in target.setdefault("inheritedParams", []) if canon_param(x) == canon
                               and PARAM_POSITIVE_RANK.get(x.get("complexityClass"), 0) >= PARAM_POSITIVE_RANK[cls]]
                    if not own and not already:
                        target["inheritedParams"].append(dict(r, inheritedFrom=source["id"], via=chain, direction="down"))
                        inherited_positive += 1
                    next_frontier.append(chain)
            frontier = next_frontier
for n in nodes:
    n.setdefault("inheritedParams", [])
print(f"# inherited parameterized hardness results: {inherited_count} "
      f"(on {sum(1 for n in nodes if any(x['direction'] == 'up' for x in n['inheritedParams']))} problems)", file=sys.stderr)
print(f"# inherited parameterized positive results: {inherited_positive} "
      f"(on {sum(1 for n in nodes if any(x['direction'] == 'down' for x in n['inheritedParams']))} problems)", file=sys.stderr)

# ---- approximation results travel the same arrows: what an algorithm
# achieves (an upper result: a scheme, a ratio) holds for every special
# case, what cannot be achieved (a lower one: APX-hard, inapproximable)
# holds for every generalization. Only arrows on which the objective value
# is identical on every schedule qualify, since a ratio means nothing
# across an objective shift -- and those are exactly the arrows
# param_safe_tokens does not refuse (its exclusion sets are about
# parameters, so they do not matter here). Kept on the node as
# inheritedApprox, with the chain, so the panel can show where it came from.
APPROX_LINE = re.compile(r"PTAS|approximat|APX-hard|inapprox", re.I)
inherited_approx = 0
for source in nodes:
    for r in source["classical"]:
        if not APPROX_LINE.search(r.get("bound", "")):
            continue
        down = r.get("kind") == "upper"
        step = children_of if down else parents_of
        seen, frontier = {source["id"]}, [[source["id"]]]
        while frontier:
            next_frontier = []
            for path in frontier:
                for nxt in step.get(path[-1], []):
                    if nxt in seen:
                        continue
                    general, specific = (path[-1], nxt) if down else (nxt, path[-1])
                    if param_safe_tokens(general, specific) is False:
                        continue
                    seen.add(nxt)
                    target = node_by_id[nxt]
                    chain = path + [nxt]
                    next_frontier.append(chain)
                    if any(x["bound"] == r["bound"] for x in target["classical"]) or \
                       any(x["bound"] == r["bound"] for x in target.setdefault("inheritedApprox", [])):
                        continue
                    target["inheritedApprox"].append(dict(r, inheritedFrom=source["id"],
                                                          via=chain if down else list(reversed(chain)),
                                                          direction="down" if down else "up"))
                    inherited_approx += 1
            frontier = next_frontier
for n in nodes:
    n.setdefault("inheritedApprox", [])
print(f"# inherited approximation results: {inherited_approx} "
      f"(on {sum(1 for n in nodes if n['inheritedApprox'])} problems)", file=sys.stderr)

# ---- the settings filter's own menu data: for every exported beta field,
# the values that actually occur in this corpus (with schedzoo's own
# explanation text, and how many problems use each), so the UI can build a
# grouped picker without hard-coding a value list that would silently drift
# out of date whenever the corpus changes.
settings_fields = []
for f in SETTINGS_FIELDS:
    counts = {}
    for n in bases:
        v = bases[n]["core_vec"].get(f)
        if v:
            counts[v] = counts.get(v, 0) + 1
    settings_fields.append({
        "field": f,
        "count": sum(counts.values()),
        "values": [
            {
                "value": v,
                "label": latex_to_plain(v),
                "count": c,
                "explanation": field_explanation(f, v),
            }
            for v, c in sorted(counts.items(), key=lambda kv: -kv[1])
        ],
    })

# ---- The Scheduling Zoo's problem-builder form, as notation.xml defines it:
# every field in order, with its values and its `requires` condition. A
# problem there is one radio choice per field (so at most one value per
# field), a field or value is only offered while its condition holds, and
# the name is written in this field order -- so this is what decides which
# problems are well-formed, and that two orderings of the same settings are
# the same problem. The site uses it to only let complete, well-formed
# problems be drafted. The hidden "interface" field and the parameter
# section are left out: drafts are always "advanced" and never bracketed.
notation_form = []
for section_index, section in enumerate(tree[1]):
    if section.attrib.get("id") == "Parameters":
        continue
    for field in section:
        if field.attrib.get("hide"):
            continue
        notation_form.append({
            "field": tools.correctxml(field.attrib["name"]),
            "slot": {"Machine": "alpha", "Constraints": "beta", "Objective": "gamma"}.get(
                section.attrib.get("name", "").split(" ")[0], ""),
            "requires": field.attrib.get("requires", ""),
            "separation": field.attrib.get("separation", "True") != "False",
            "choices": [
                {
                    "value": tools.correctxml(c.attrib["value"]),
                    "label": latex_to_plain(tools.correctxml(c.attrib["value"])),
                    "requires": c.attrib.get("requires", ""),
                    # schedzoo's own wording for what this value means, so the
                    # site can explain any part of a problem's name (the panel
                    # makes every token of the alpha|beta|gamma heading
                    # hoverable). Keyed off the RAW xml attributes, the same
                    # keys field_choice_explanations was built from -- not the
                    # correctxml'd ones above, which would miss where the two
                    # differ. Same text the per-edge diffs and the settings
                    # menu already carry; this is simply the complete set, so
                    # nothing has to be re-described in the site's own code.
                    "explanation": field_choice_explanations.get(
                        field.attrib["name"], {}).get(c.attrib["value"], ""),
                }
                for c in field
            ],
        })
assert {f["slot"] for f in notation_form} == {"alpha", "beta", "gamma"}, "notation.xml's form sections changed"

# ---- two corrections to these conditions used to live here (p_{ij}=1 and
# p_{ij}=p left F out, and "(P or Q or 1)" was unparseable to an evaluator
# that splits on spaces). Both are upstream now, with a third of schedzoo's
# own, so the conditions are taken as shipped -- every problem in the corpus
# satisfies them, which the check below enforces rather than assumes.
#
# The whitespace pass stays: it is not a correction but normalisation for
# OUR evaluator, which splits a condition into space-separated atoms. Every
# condition in notation.xml today is already spaced, so this is a no-op on
# the current file and simply keeps a future unspaced one from being read as
# one unknown atom.
#
# It pads a parenthesis only where it stands ALONE at the edge of a
# token -- "(P or Q)" -- and leaves one inside an atom untouched: the
# two-stage flexible flow shop is literally called FF(1,m), and padding
# its parentheses split that atom into "FF", "(", "1,m" and ")", which no
# choice of machine environment then satisfies.
_PAREN_OPEN = re.compile(r"(^|\s)\(")
_PAREN_CLOSE = re.compile(r"\)(?=\s|$)")
for f in notation_form:
    for c in [f] + f["choices"]:
        req = _PAREN_CLOSE.sub(" ) ", _PAREN_OPEN.sub(r"\1 ( ", c["requires"]))
        c["requires"] = re.sub(r"\s+", " ", req).strip()

out = {
    "nodes": nodes,
    "notationForm": notation_form,
    # per core field, every (particular, general) value pair the one-field
    # reduction rules give -- The Scheduling Zoo's own, with our added
    # processing-time and machine-count rules, transitively closed. Used by the site
    # to tell when a hand-drawn arrow runs against the rules in some field.
    "fieldReductions": {f: sorted([list(pair) for pair in simple_reductions[f]]) for f in core_fields if simple_reductions[f]},
    "edges": edges,
    "machineEnvExplanations": machine_env_explanations,
    "settingsFields": settings_fields,
}
with open(OUT_FILE, "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print(f"wrote {os.path.relpath(OUT_FILE, REPO_DIR)}", file=sys.stderr)
