import torch


class ObjectCounter:
    def __init__(self, count_mode: str, threshold: int, direction: str):
        self.LIST_0: list[int] = []
        self.LIST_1: list[int] = []
        self.count_mode = count_mode
        self.threshold = threshold
        self.direction = direction

        if direction == "top2down":
            self.count_condition = lambda y: y > threshold
        elif direction == "down2top":
            self.count_condition = lambda y: y < threshold
        elif direction == "left2right":
            self.count_condition = lambda x: x > threshold
        elif direction == "right2left":
            self.count_condition = lambda x: x < threshold
        else:
            raise ValueError(f"Invalid direction: {direction}")

    def update(self, prediction: list) -> None:
        if not isinstance(prediction, list):
            return
        if prediction[0].boxes.shape[0] == 0:
            return
        if prediction[0].boxes.id is None:
            return

        boxes = prediction[0].boxes.xywh.cpu()
        centers = boxes[:, :2]
        track_ids = prediction[0].boxes.id.int().cpu().reshape(-1, 1)
        to_count = torch.cat((track_ids, centers), 1)
        set_0, set_1 = set(self.LIST_0), set(self.LIST_1)

        for obj_id, x, y in to_count:
            self._process_object(obj_id, x, y, set_0, set_1)

        self.LIST_0, self.LIST_1 = list(set_0), list(set_1)

    def _process_object(self, obj_id, x, y, set_0: set, set_1: set) -> None:
        obj_id = obj_id.item()
        if self.count_mode == "horizontal":
            if self.count_condition(x.item()):
                set_0.add(obj_id)
                set_1.discard(obj_id)
            elif obj_id in set_0:
                set_1.add(obj_id)
        elif self.count_mode == "vertical":
            if self.count_condition(y.item()):
                set_0.add(obj_id)
                set_1.discard(obj_id)
            elif obj_id in set_0:
                set_1.add(obj_id)

    def get_count(self) -> int:
        return len(self.LIST_1)

    def get_pending_count(self, prediction: list) -> int:
        """Count objects currently tracked but not yet in LIST_1 (crossed but not counted)."""
        if not isinstance(prediction, list):
            return 0
        if prediction[0].boxes.shape[0] == 0:
            return 0
        if prediction[0].boxes.id is None:
            return 0

        set_1 = set(self.LIST_1)
        track_ids = prediction[0].boxes.id.int().cpu().flatten().tolist()
        return sum(1 for tid in track_ids if tid not in set_1)

    def reset(self) -> None:
        self.LIST_0.clear()
        self.LIST_1.clear()
