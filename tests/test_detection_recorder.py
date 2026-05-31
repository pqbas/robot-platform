"""Tests for back.services.detection_recorder JSONL logging."""

import json

import pytest

from back.services import detection_recorder


@pytest.fixture(autouse=True)
def _clean_state():
    """Ensure no file handle leaks between tests."""
    detection_recorder.stop()
    yield
    detection_recorder.stop()


def _read_lines(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def test_start_creates_file(tmp_path):
    detection_recorder.start("abc", str(tmp_path))
    assert (tmp_path / "abc.jsonl").exists()


def test_record_writes_valid_line(tmp_path):
    detection_recorder.start("abc", str(tmp_path))
    detection_recorder.record(
        [{"class_name": "naranja", "confidence": 0.9, "bbox": [0.1, 0.2, 0.3, 0.4], "track_id": 5}]
    )
    lines = _read_lines(tmp_path / "abc.jsonl")
    assert len(lines) == 1
    row = lines[0]
    assert row["frame"] == 0
    assert isinstance(row["t"], float)
    assert row["dets"] == [
        {"cls": "naranja", "conf": 0.9, "bbox": [0.1, 0.2, 0.3, 0.4], "track_id": 5}
    ]


def test_record_empty_advances_frame(tmp_path):
    detection_recorder.start("abc", str(tmp_path))
    detection_recorder.record([])
    detection_recorder.record([])
    lines = _read_lines(tmp_path / "abc.jsonl")
    assert [row["frame"] for row in lines] == [0, 1]
    assert all(row["dets"] == [] for row in lines)


def test_record_after_stop_is_noop(tmp_path):
    detection_recorder.start("abc", str(tmp_path))
    detection_recorder.record([])
    detection_recorder.stop()
    detection_recorder.record([])  # no file open: must not raise, must not write
    lines = _read_lines(tmp_path / "abc.jsonl")
    assert len(lines) == 1
    assert detection_recorder.is_active() is False


def test_start_twice_overwrites_and_resets(tmp_path):
    detection_recorder.start("abc", str(tmp_path))
    detection_recorder.record([])
    detection_recorder.record([])
    detection_recorder.start("abc", str(tmp_path))  # same uuid: overwrite, reset
    detection_recorder.record([])
    lines = _read_lines(tmp_path / "abc.jsonl")
    assert [row["frame"] for row in lines] == [0]
