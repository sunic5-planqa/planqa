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
