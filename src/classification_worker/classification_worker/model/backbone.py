"""Frozen CNN encoder — vendored from
``mlops-classification-blueberry/src/nn/backbone.py`` (Encoder only).

The ripeness classifier is this encoder (frozen) + a linear probe
(StandardScaler + LogisticRegression) reduced to numpy. ``embed`` returns the
(B, latent_dim) vector by global-average-pooling the 8x8 latent map; the numpy
probe (see ``processor.py``) turns that into class logits. The Decoder from the
training repo is omitted — inference never reconstructs.
"""

from __future__ import annotations

import torch
from torch import nn

from classification_worker.model.layers import ConvBNAct, ResBlock


class Encoder(nn.Module):
    """ResNet reducido con SiLU. Mapea (B, 3, 128, 128) a (B, latent_dim, 8, 8);
    ``embed`` aplica global average pooling para el vector (B, latent_dim).

    La capacidad debe ser identica a la del entrenamiento para que los pesos
    congelados (encoder.pt) carguen en strict mode.
    """

    def __init__(self, latent_dim: int = 128, dropout: float = 0.0) -> None:
        super().__init__()
        self.latent_dim = latent_dim
        self.stage1 = nn.Sequential(ConvBNAct(3, 32, stride=2), ResBlock(32))                    # 64x64
        self.stage2 = nn.Sequential(ConvBNAct(32, 64, stride=2), ResBlock(64))                   # 32x32
        self.stage3 = nn.Sequential(ConvBNAct(64, 128, stride=2), ResBlock(128))                 # 16x16
        self.stage4 = nn.Sequential(ConvBNAct(128, latent_dim, stride=2), ResBlock(latent_dim))  # 8x8
        self.drop = nn.Dropout2d(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = self.stage4(x)
        return self.drop(x)

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        """Vector (B, latent_dim) por global average pooling del mapa 8x8."""
        feat = self.forward(x)
        return feat.mean(dim=(2, 3))
