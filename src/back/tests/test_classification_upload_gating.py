"""Classification (re)upload gating — the predicate deciding WHEN a recording's
ripeness jsonl + crops are eligible to (re)push to the server.

Mirror of ``test_sidecar_upload_gating`` but with the extra ``uploaded_at`` gate:
the server derives the sidecar/crops paths from the recording's server-side
``file_path``, which is only rewritten on MP4 upload — so classification must
never leave before the MP4 has landed.

Run: PYTHONPATH=src python -m pytest src/back/tests/test_classification_upload_gating.py
"""

from back.services.sync_recordings_upload import _classifications_need_upload

_UP = "2026-07-07T12:00:00Z"  # a non-null uploaded_at (MP4 already landed)


def test_mid_classify_partial_jsonl_is_not_uploaded():
    # Worker still writing the jsonl → partial → must NOT push, even post-MP4.
    assert _classifications_need_upload("classifying", None, _UP) is False
    assert _classifications_need_upload("pending", None, _UP) is False


def test_done_and_never_uploaded_is_pushed():
    # Complete results that haven't been sent (or born NULL) → push.
    assert _classifications_need_upload("done", None, _UP) is True


def test_static_none_and_error_are_reconciled():
    # none (no classifier) / error are not mid-classify: eligible so the loop
    # reconciles them once and stops re-scanning.
    assert _classifications_need_upload("none", None, _UP) is True
    assert _classifications_need_upload("error", None, _UP) is True


def test_mp4_not_yet_uploaded_blocks_classification():
    # The extra gate vs the detection sidecar: without the MP4 on the server the
    # crops/jsonl paths can't resolve → wait for the MP4 (next cycle).
    assert _classifications_need_upload("done", None, None) is False


def test_already_uploaded_is_not_repushed():
    assert _classifications_need_upload("done", _UP, _UP) is False
    assert _classifications_need_upload("none", _UP, _UP) is False


def test_reclassify_clears_flag_so_it_repushes():
    # After a reclassify the poller clears classifications_uploaded_at → dirty.
    assert _classifications_need_upload("done", _UP, _UP) is False
    assert _classifications_need_upload("done", None, _UP) is True
