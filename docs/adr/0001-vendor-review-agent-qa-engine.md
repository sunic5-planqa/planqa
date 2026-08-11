- Title: Vendor `planqa-agent`'s review-agent as the QA engine instead of building one in-repo
- Status: Accepted
- Date: 2026-08-08
- Context: `POST /documents/{id}/qa-jobs` and its two follow-up endpoints had been 501 stubs since
  the backend's initial scaffold — "QA 엔진 핵심 로직" stayed the top `### Next` item across nearly
  every progress.md entry for this project. A separate teammate-owned repo,
  `sunic5-planqa/planqa-agent` (branch `feature/review-agent`), already has a working, tested
  rulebook-based review pipeline (`review_document(doc_id, text, rulebook, screen_llm, confirm_llm,
  profile) -> ReviewResult`) with its own Gemini client, 2-stage screen→confirm flow, dedupe, and a
  `gemini_lite` prompt profile. This backend also had an earlier, unfinished attempt at the same
  thing (`qa_engine/llm/{base,gemini}.py`) — an async Gemini client with no screener/confirmer/
  pipeline built on top, unused anywhere in the app.
- Options:
  1. Finish the in-repo `qa_engine/llm/` client and build the screening/confirming/pipeline logic
     from scratch on top of it (async-native throughout).
  2. Add `planqa-agent` as a git submodule or a `uv` path/git dependency, importing `planqa_review`
     directly.
  3. Vendor (copy) the review-agent's runtime-relevant source files into
     `backend/src/sunnic_backend/qa_engine/review_agent/`, rewriting imports to the local package
     path, and run its synchronous pipeline inside `asyncio.to_thread` from the FastAPI job handler.
- Decision: Option 3.
  - Option 1 means re-deriving prompts/logic that already exist and are tested elsewhere — pure
    duplicated effort with no upside, and two independently-drifting implementations of the same
    thing across two repos.
  - Option 2 (submodule/path dependency) keeps a live link to a repo this backend doesn't control
    the release cadence of; a breaking change upstream (e.g. review-agent's own CLI/benchmark
    dependencies, or a refactor mid-experiment) would surface here without warning. This backend
    only needs a small, stable slice of review-agent (the pipeline + gemini_lite profile), not its
    CLI, benchmark harness, or golden-dataset scoring tools.
  - Option 3 pulls in only that slice, so the backend's own dependency list (`pyproject.toml`)
    didn't need to grow at all (`google-genai` was already a dependency; `httpx`/`openpyxl`/
    `python-dotenv`, needed only by the CLI/ollama/benchmark parts, were left behind). The copied
    files keep their upstream shape (same function/class names, same file boundaries) so future
    re-syncs stay a diffable copy-and-reapply rather than a rewrite — the only structural change is
    the import prefix (`planqa_review.` → `sunnic_backend.qa_engine.review_agent.`). review-agent's
    `LLMClient.complete_json` is synchronous (its retry backoff uses `time.sleep`), so the whole
    `review_document(...)` call is wrapped in `asyncio.to_thread` at the FastAPI job-handler layer
    instead of rewriting review-agent's client to be async — keeping the vendored code untouched
    was valued over an async rewrite this backend doesn't strictly need (FastAPI's thread pool
    already isolates it from the event loop).
- Consequences:
  - No new dependency surface, and `uv.lock` didn't change.
  - The old unused `qa_engine/llm/{base,gemini}.py` scaffold and its test were deleted — superseded
    outright rather than kept alongside a second Gemini client.
  - Re-syncing with upstream `planqa-agent` changes is a manual, occasional copy — there's no CI or
    tooling enforcing the two stay aligned. If review-agent's pipeline signature or `Issue` schema
    changes, `backend/src/sunnic_backend/api/qa_jobs.py`'s mapping layer (`_to_issue_record`) needs
    a matching update.
  - Per-tier progress reporting (`QAJobStatusResponse.current_category`) isn't implemented — the
    vendored `review_document` runs all tiers before returning, with no progress callback. Adding
    one would mean modifying the vendored `pipeline.py`, which trades off the "diffable copy"
    property above; left as a known gap (see progress.md `### Next`).
  - `backend/src/sunnic_backend/qa_engine/review_agent/**` is exempted from ruff's `B023`/`UP047`
    (see `pyproject.toml`) rather than being reshaped to satisfy rules upstream doesn't enforce —
    the same diffability trade-off.

## Update — 2026-08-10 re-sync from `planqa-agent`'s `dev` branch

Upstream restructured significantly since the initial vendor (`feature/review-agent` → `dev`,
`sunic5-planqa/planqa-agent` PRs #5–#12): `schema.py`/`rulebook.py` moved into a separate
`packages/planqa-schemas` package, `review-agent` itself moved under `services/review-agent`, and
a new pluggable "structure" was added — `structures/category_screen.py` — which replaces the old
profile-based `pipeline.review_document(..., profile)` as this backend's call target:

- **`related_location` landed** (the field requested in
  [sunic5-planqa/planqa-agent#4](https://github.com/sunic5-planqa/planqa-agent/issues/4)) — `qa_jobs.py`'s
  `_frame_type()` no longer permanently falls back to `object` for LG/LF/GA; it now genuinely
  returns `range` whenever confirm names a second location. `dedupe.py` was updated in lockstep
  (two relational findings with different `related_location` are no longer collapsed into one).
- **The 4 tiers now run concurrently** (`ThreadPoolExecutor`, one cloned `LLMClient` per tier) —
  `LLMClient` gained a `clone(*, tier=...)` method for this. Its default implementation re-reads
  credentials from `os.environ` instead of reusing the `api_keys` passed at construction, which this
  backend never populates process-wide (settings come from `.env` via pydantic-settings, not real
  env vars) — worked around in `qa_jobs.py` with a small local subclass (`_ScopedClient`) that
  overrides `clone()` to thread the explicit keys through, rather than mutating `os.environ` (which
  was tried first and rejected — it leaked across requests/tests, see the commit that fixed it).
- **`TIER_CATEGORIES` was corrected upstream** — the version this backend had vendored was missing
  several category→tier assignments (e.g. Document tier was missing TC/TM entirely). Re-vendoring
  fixed this as a side effect, not something this backend could have caught on its own.
- Screening now sees only category labels, not rule text — confirm picks the specific `rule_id`
  out of that category's full rule set. Dropped `models/gemini_lite/*` and the old
  `pipeline.review_document` call path entirely (pipeline.py itself is still vendored — kept only
  for the shared `ReviewResult` dataclass).
- Re-validated live against the vendored `DOC-001` fixture: 22 issues, zero tier errors, real
  `related_location` values present on LG/LF/GA findings (was 44 issues pre-re-sync on the same
  document/model — see progress.md's 2026-08-09 investigation into that discrepancy, still not
  fully explained, but the corrected `TIER_CATEGORIES` and category-based screening both plausibly
  contribute).

## Update — 2026-08-10 re-sync to `bundled_screen_hybrid`

Upstream swapped its default structure again — `structures/category_screen.py` is gone, replaced by
`structures/bundled_screen_hybrid.py` (plus a new sibling data file, `structures/fewshot_bank.py`,
of curated violation/exception examples). Re-vendored the same file set as before, minus `category_screen.py`/
`llm/gemini.py` (genuinely unused — this backend calls Anthropic directly, not upstream's env-var-driven
`llm/factory.py`), plus `structures/fewshot_bank.py`:

- **Only two passes now, not four concurrent tiers**: `review_document()` runs a Paragraph pass (most
  categories) then a Document pass (relational categories LG/LF/GA, plus two specific absence-check
  rules LG-01/TC-02) — sequentially, not via `ThreadPoolExecutor`. **`LLMClient.clone()` no longer
  exists at all** — the `_ScopedClient` workaround from the last re-sync (see update above) is gone;
  `qa_jobs.py` now constructs `AnthropicClient` directly.
- **`_categories_for_progress` reworked to match** — the old 4-group (Document/Logical Unit/Paragraph/
  Sentence) cosmetic checklist no longer corresponded to anything real (Logical Unit and Sentence
  aren't queried by this structure at all). Replaced with 2 groups (Paragraph/Document, split by the
  same `_RANGE_CATEGORIES` set `_frame_type` already uses) that fill **in real execution order**
  (Paragraph to 100% before Document starts moving) rather than in lockstep — lockstep was specifically
  built for the *concurrent* 4-tier case, which no longer applies now that execution really is
  sequential.
- **`llm/base.py` gained built-in JSON repair** (`_repair_json` — fixes stray backslashes and trailing
  commas inside a model's JSON response) and `AnthropicClient.complete_json` now retries once on a
  malformed/empty response instead of failing the whole call. This directly addresses the "Paragraph
  tier 위계에서 Claude가 malformed JSON 응답" issue flagged as a live, unresolved observation in
  progress.md's 2026-08-09 Claude-switch entry.
- **`document.py` gained `resolve_reported_level()`** — confirm can now report a finding at a *coarser*
  level than the chunk it was actually scoped to (e.g. a Paragraph-tier candidate whose real scope is
  the whole Logical Unit), never finer. `_to_issue_record` needed no change — it already just uses
  whatever `location`/`level` the vendored `Issue` carries.
- Not vendored (not on this backend's import path): `cli.py`, `run_stats.py`, `diff_report.py`,
  `eval_service_notify.py`, `llm/factory.py`, `llm/ollama.py`, `models/gemini_lite/*` — this backend
  imports `bundled_screen_hybrid.review_document` directly (same as it did for `category_screen`
  before) and never touches upstream's `STRUCTURES` registry, but `structures/__init__.py` is still
  kept (updated to point at the new module) purely for diffability.

## Update — 2026-08-10 re-sync: bundled_screen_hybrid's 2 passes parallelized

Same day, immediate follow-up upstream (`sunic5-planqa/planqa-agent` PRs #23–#25): the Paragraph and
Document passes — sequential as of the update above — now run concurrently via `ThreadPoolExecutor`
(falls back to a direct call when only one pass is actually active, skipping thread-pool overhead).

- **`instrumentation.isolate_client(llm, *, key=None)`** changed shape: calls `llm.isolate(key)` when
  the client defines one (test doubles that need to route scripted responses by branch identity), else
  falls back to `copy.copy(llm)` + a fresh `usage` list for real backends. **This backend's
  `AnthropicClient` needed zero changes** — the `copy.copy()` fallback already does the right thing
  (shares the underlying `anthropic.Anthropic` HTTP client by reference, isolates only the usage-
  tracking list), and `qa_jobs.py::_run_review_sync` already just constructs plain `AnthropicClient`
  instances (simplified in the update above, once `clone()` disappeared) — no `isolate()` override
  needed there either.
- `qa_jobs.py::_categories_for_progress` reverted from "fill Paragraph to 100% before Document starts"
  back to lockstep (all groups advance together) — the sequential-fill logic added in the previous
  update was correct for that update's sequential execution, but wrong again now that the two passes
  are concurrent. Re-measured live against DOC-001 (Claude Haiku→Sonnet): 63.1s (vs. 120.3s sequential,
  vs. 66.1s under the original 4-tier-concurrent `category_screen`) — `_ESTIMATED_DURATION_SECONDS`
  reverted 35s → 20s to match.
- Vendored test double (`tests/qa_engine/review_agent/conftest.py::ScriptedLLM`) swapped its dead
  `tier_responses`/`clone()` shape for `keyed_responses`/`isolate()`, matching the new
  `isolate_client` contract — `isolate()` now raises a clear error if called with a key but no
  `keyed_responses` configured, instead of silently falling back to the shared (racy) instance.

## Update — 2026-08-11 re-sync: GA/TC/MI category-boundary prompt fix

In response to alpha-test feedback filed as [planqa-agent#26](https://github.com/sunic5-planqa/planqa-agent/issues/26)
(GA↔TC and TC↔MI misclassification), upstream landed a prompt-only fix
([planqa-agent#27](https://github.com/sunic5-planqa/planqa-agent/pull/27)) — exactly the
"cheapest to re-sync" category this ADR's own file-boundary/import-rewrite trade-off was meant
to reward. `structures/bundled_screen_hybrid.py` gained a `_CATEGORY_BOUNDARY_NOTES` constant
(GA-vs-TC and TC-vs-MI boundary explanations) inserted into both `_SCREEN_HYBRID_SYSTEM` and
`_CONFIRM_HYBRID_SYSTEM`. Re-vendoring this was a pure copy — the only diff from upstream is the
`planqa_review.` → `sunnic_backend.qa_engine.review_agent.` import-path rewrite this ADR already
expects every re-sync to need; no other file touched, no test changes needed (144/144 still pass).

## Update — 2026-08-12 re-sync: vendor `llm/gemini.py`, switch screen_llm to Gemini Flash-Lite

User request to move the screening (1차) pass from Claude Haiku to Gemini Flash-Lite for cost —
`llm/gemini.py` still existed upstream (never deleted there, only unused/skipped on our side
per this ADR's original entry) as a `GeminiClient` implementing the same `LLMClient.complete_json`
protocol as `AnthropicClient`, so this was a straight vendor rather than new code. `google-genai`
was already a `pyproject.toml` dependency and `config.py` already parsed `GEMINI_API_KEYS` — both
leftover scaffolding from before this backend vendored review-agent at all (see this ADR's
original Context) — so the only new setting needed was `SUNNIC_GEMINI_MODEL` (default
`gemini-flash-lite-latest`, matching upstream's own `DEFAULT_MODEL`).

- `GeminiClient` has no `.isolate()` method, so `instrumentation.isolate_client()`'s duck-typed
  fallback (`copy.copy()` + fresh `usage` list) handles it automatically — same zero-code-change
  outcome as `AnthropicClient` got when concurrent dispatch was added (see the 2026-08-10 update
  above). `GeminiClient`'s own `_current`/`_current_lock` (multi-key round-robin state) are
  deliberately shared-by-reference across that shallow copy by design (see the class's own
  comment) — nothing about isolate_client needed to accommodate this specially.
- `qa_jobs.py`: `screen_llm` now `GeminiClient(model=settings.sunnic_gemini_model,
  api_keys=settings.gemini_api_keys)`; `confirm_llm` (Sonnet, 2차) unchanged. `_verify_mi_finding`/
  `_verify_ae_finding`/`/issues/similarity-check` still use Anthropic Haiku — those are separate
  verification features this request didn't touch, not part of the review_document screen/confirm
  pipeline.
- `render.yaml` gained `GEMINI_API_KEYS` (secret, `sync: false`) and `SUNNIC_GEMINI_MODEL` (fixed
  value) — production still needs this key set manually in the Render dashboard, same as
  `ANTHROPIC_API_KEY` was.
- Diff from upstream: import-path rewrite only (now covered by the `I001` per-file-ignore added
  alongside `B023`/`C408`/`UP047`, since upstream's own import-sort convention doesn't match ours
  and reformatting it would fight future re-vendors, same reasoning as the existing ignores).
