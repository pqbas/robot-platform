class ObjectCounter:
    def __init__(self, count_mode: str, threshold: float, direction: str):
        # All coords (cx, cy) and threshold live in normalized [0, 1] space —
        # the inference worker divides centroids by frame W/H before sending,
        # so the comparison is resolution-independent at every layer.
        self.LIST_0: list[int] = []
        self.LIST_1: list[int] = []
        self.count_mode = count_mode
        self.direction = direction
        self.threshold = threshold

        if direction == "top2down":
            self.count_condition = lambda y: y > self.threshold
        elif direction == "down2top":
            self.count_condition = lambda y: y < self.threshold
        elif direction == "left2right":
            self.count_condition = lambda x: x > self.threshold
        elif direction == "right2left":
            self.count_condition = lambda x: x < self.threshold
        else:
            raise ValueError(f"Invalid direction: {direction}")

    def update(self, tracking_data: list[dict]) -> None:
        if not tracking_data:
            return

        set_0, set_1 = set(self.LIST_0), set(self.LIST_1)

        for obj in tracking_data:
            self._process_object(obj["track_id"], obj["cx"], obj["cy"], set_0, set_1)

        self.LIST_0, self.LIST_1 = list(set_0), list(set_1)

    def _process_object(self, obj_id: int, x: float, y: float, set_0: set, set_1: set) -> None:
        # set_0: tracks ever seen on the "before" side (legitimate crossers).
        # set_1: tracks currently counted (on the "after" side after crossing).
        # Cruce forward -> set_1.add (+1). Regreso -> set_1.discard (-1).
        coord = x if self.count_mode == "horizontal" else y
        if self.count_condition(coord):
            # After-side: only count tracks that were first seen on before-side.
            if obj_id in set_0:
                set_1.add(obj_id)
        else:
            # Before-side: register as legitimate, discount if it had crossed.
            set_0.add(obj_id)
            set_1.discard(obj_id)

    def get_count(self) -> int:
        return len(self.LIST_1)

    def get_pending_count(self, tracking_data: list[dict]) -> int:
        """Count objects currently tracked but not yet in LIST_1."""
        if not tracking_data:
            return 0
        set_1 = set(self.LIST_1)
        return sum(1 for obj in tracking_data if obj["track_id"] not in set_1)

    def reset(self) -> None:
        self.LIST_0.clear()
        self.LIST_1.clear()
