"""Genera el forest plot de MAE de conteo por detector (line_crossing vs tiled_crossing)
con barras de IC95, replicando la figura del MDPI. Salida: assets/counting-mae-forest.png."""

import matplotlib.pyplot as plt

# (detector, line_crossing MAE, ci_half, tiled_crossing MAE, ci_half)
# Ordenado por MAE de tiled_crossing ascendente (YOLOv9s mejor arriba).
data = [
    ("YOLOv9s", 61.9, 9.25, 22.8, 9.95),
    ("YOLOv11s", 67.7, 8.4, 25.5, 12.2),
    ("YOLOv11n", 57.5, 8.35, 28.0, 13.4),
    ("YOLOv10m", 61.3, 9.55, 29.2, 14.85),
    ("YOLO26l", 65.9, 8.0, 33.1, 16.75),
    ("YOLOv8s", 67.8, 9.6, 33.2, 14.55),
    ("YOLOv9t", 60.5, 7.35, 35.9, 14.8),
    ("YOLOv11m", 74.5, 8.85, 36.8, 16.15),
    ("YOLOv8l", 71.4, 8.9, 37.2, 14.4),
    ("YOLOv9c", 74.9, 8.2, 41.1, 13.45),
    ("YOLOv10l", 67.6, 9.45, 45.5, 13.2),
    ("YOLOv10s", 66.6, 9.3, 47.7, 11.65),
    ("YOLOv11l", 78.0, 7.85, 47.8, 13.45),
    ("YOLO26s", 67.1, 7.8, 47.9, 14.15),
    ("YOLOv8m", 68.3, 8.4, 53.4, 10.9),
    ("YOLOv8n", 76.6, 5.8, 57.9, 13.25),
    ("YOLO26n", 74.7, 6.5, 62.1, 11.65),
    ("YOLOv9m", 69.7, 7.05, 62.8, 7.7),
    ("YOLOv10n", 76.3, 6.95, 71.6, 5.25),
    ("YOLO26m", 67.1, 6.0, 72.4, 9.05),
]

labels = [d[0] for d in data]
line_mae = [d[1] for d in data]
line_ci = [d[2] for d in data]
tiled_mae = [d[3] for d in data]
tiled_ci = [d[4] for d in data]

# y: arriba = primero de la lista (YOLOv9s)
y = list(range(len(data)))[::-1]

fig, ax = plt.subplots(figsize=(8.5, 9))

ax.errorbar(line_mae, y, xerr=line_ci, fmt="o", color="#1f4e9c",
            markersize=5, capsize=3, elinewidth=1, label="line_crossing")
ax.errorbar(tiled_mae, y, xerr=tiled_ci, fmt="s", color="#c0392b",
            markersize=5, capsize=3, elinewidth=1, label="tiled_crossing")

ax.set_yticks(y)
ax.set_yticklabels(labels, fontsize=9)
ax.set_xlabel("MAE de conteo (%)", fontsize=11)
ax.set_xlim(0, 100)
ax.set_xticks(range(0, 101, 10))
ax.grid(axis="x", linestyle=":", alpha=0.5)
ax.legend(loc="lower right", framealpha=0.9, fontsize=10)

fig.tight_layout()
fig.savefig("/home/pqbas/labinm/robot-platform/assets/counting-mae-forest.png", dpi=150)
print("ok")
