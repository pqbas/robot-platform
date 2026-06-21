"""Sidecar (re)upload gating — the predicate that fixes the truncated-replay bug.

The detection sidecar ({uuid}.jsonl) is written incrementally by the
counting-worker AFTER recording ends, so uploading it before the count finishes
ships a partial file (server replay freezes mid-video). These cases pin the
decision of WHEN the sidecar is eligible to (re)upload.

Run: PYTHONPATH=src/back python -m pytest src/back/tests/test_sidecar_upload_gating.py
"""

from back.services.sync_recordings_upload import _sidecar_needs_upload


def test_mid_count_partial_sidecar_is_not_uploaded():
    # The original race: count still running → JSONL is partial → must NOT push.
    assert _sidecar_needs_upload("counting", None) is False
    assert _sidecar_needs_upload("pending", None) is False


def test_done_and_never_uploaded_is_pushed():
    # Complete sidecar that hasn't been sent (or born NULL post-migration) → push.
    # This is also what repairs already-truncated server copies.
    assert _sidecar_needs_upload("done", None) is True


def test_static_uncounted_sidecars_are_pushed():
    # none/error are NOT mid-count: their sidecar (e.g. an old live-counted
    # session) is static and complete locally, while the server copy may be
    # truncated. Must be eligible — this was the bug where the sync button did
    # nothing for status='none' recordings.
    assert _sidecar_needs_upload("none", None) is True
    assert _sidecar_needs_upload("error", None) is True


def test_done_and_already_uploaded_is_not_repushed():
    # Clean: count done and sidecar already sent → nothing to do.
    assert _sidecar_needs_upload("done", "2026-06-20T17:00:00Z") is False


def test_recount_clears_flag_so_it_repushes():
    # After a re-count the poller clears detections_uploaded_at → dirty again.
    assert _sidecar_needs_upload("done", "2026-06-20T17:00:00Z") is False
    assert _sidecar_needs_upload("done", None) is True


def test_already_pushed_static_sidecar_is_not_repushed():
    # Once any static sidecar is sent, it isn't re-pushed until something
    # clears the flag (a re-count) — avoids redundant transfers.
    assert _sidecar_needs_upload("none", "2026-06-20T17:00:00Z") is False
    assert _sidecar_needs_upload("error", "2026-06-20T17:00:00Z") is False
