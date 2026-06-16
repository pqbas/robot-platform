"""Parity/behavior tests for the worker's ObjectCounter copy.

The worker's object_counter.py is a verbatim copy of
``back/services/perception/object_counter.py``. These cases pin the
line-crossing semantics so the copy can't silently drift from the backend's:
a track only counts once it is first seen on the before-side and then crosses
to the after-side; crossing back discounts it.
"""

from counting_worker.object_counter import ObjectCounter


def _frame(*objs):
    return [{"track_id": tid, "cx": cx, "cy": cy} for (tid, cx, cy) in objs]


def test_single_left_to_right_crossing_counts_once():
    c = ObjectCounter("horizontal", 0.5, "left2right")
    c.update(_frame((1, 0.2, 0.5)))  # before-side
    c.update(_frame((1, 0.4, 0.5)))  # still before
    c.update(_frame((1, 0.6, 0.5)))  # crossed -> count
    c.update(_frame((1, 0.8, 0.5)))  # stays counted
    assert c.get_count() == 1


def test_after_side_without_before_does_not_count():
    # A track that only ever appears past the line was never a legit crosser.
    c = ObjectCounter("horizontal", 0.5, "left2right")
    c.update(_frame((1, 0.7, 0.5)))
    c.update(_frame((1, 0.9, 0.5)))
    assert c.get_count() == 0


def test_crossing_back_discounts():
    c = ObjectCounter("horizontal", 0.5, "left2right")
    c.update(_frame((1, 0.2, 0.5)))
    c.update(_frame((1, 0.6, 0.5)))  # +1
    assert c.get_count() == 1
    c.update(_frame((1, 0.3, 0.5)))  # back -> -1
    assert c.get_count() == 0


def test_multiple_tracks_counted_independently():
    c = ObjectCounter("horizontal", 0.5, "left2right")
    c.update(_frame((1, 0.2, 0.5), (2, 0.1, 0.5)))
    c.update(_frame((1, 0.6, 0.5), (2, 0.7, 0.5)))
    assert c.get_count() == 2


def test_vertical_top2down():
    c = ObjectCounter("vertical", 0.5, "top2down")
    c.update(_frame((1, 0.5, 0.2)))  # before (top)
    c.update(_frame((1, 0.5, 0.8)))  # crossed down -> count
    assert c.get_count() == 1


def test_right2left_direction():
    c = ObjectCounter("horizontal", 0.5, "right2left")
    c.update(_frame((1, 0.8, 0.5)))  # before (right)
    c.update(_frame((1, 0.3, 0.5)))  # crossed left -> count
    assert c.get_count() == 1


def test_invalid_direction_raises():
    import pytest

    with pytest.raises(ValueError):
        ObjectCounter("horizontal", 0.5, "diagonal")
