from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

DEFAULT_VIEW_CONFIG = Path(__file__).resolve().parents[1] / "config" / "catalog-view-descriptors.json"


@dataclass(frozen=True)
class ViewDescriptor:
    stem_suffix: str
    slug_suffix: str
    priority: int
    kind: str


def load_view_descriptors(path: Path | None = None) -> tuple[ViewDescriptor, ...]:
    config_path = path or DEFAULT_VIEW_CONFIG
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"configuração de vistas ausente: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON de vistas inválido: {config_path}: {exc}") from exc

    raw = data.get("descriptors") if isinstance(data, dict) else None
    if data.get("version") != 1 or not isinstance(raw, list) or not raw:
        raise RuntimeError(f"configuração de vistas inválida: {config_path}")

    descriptors: list[ViewDescriptor] = []
    seen_stems: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise RuntimeError(f"descritor de vista inválido: {config_path}")
        stem_suffix = str(item.get("stemSuffix") or "").strip().casefold()
        slug_suffix = str(item.get("slugSuffix") or "").strip().casefold()
        kind = str(item.get("class") or "").strip()
        priority = item.get("priority")
        if (
            not stem_suffix
            or not slug_suffix.startswith("-")
            or not isinstance(priority, int)
            or priority < 0
            or kind not in {"directional", "framing"}
        ):
            raise RuntimeError(f"descritor de vista inválido: {item!r}")
        if stem_suffix in seen_stems:
            raise RuntimeError(f"descritor de vista duplicado: {stem_suffix}")
        seen_stems.add(stem_suffix)
        descriptors.append(ViewDescriptor(stem_suffix, slug_suffix, priority, kind))

    return tuple(sorted(descriptors, key=lambda item: (-len(item.stem_suffix), item.priority, item.stem_suffix)))


VIEW_DESCRIPTORS = load_view_descriptors()
VIEW_ANCHOR_PRIORITY = {item.stem_suffix: item.priority for item in VIEW_DESCRIPTORS}


def stem_view_descriptor(source_stem: str) -> tuple[str, ViewDescriptor] | None:
    normalized = re.sub(r"[-_]+", " ", source_stem).strip()
    lowered = normalized.casefold()
    for descriptor in VIEW_DESCRIPTORS:
        marker = f" {descriptor.stem_suffix}"
        if lowered.endswith(marker):
            base = normalized[: -len(marker)].strip(" -_")
            return (base, descriptor) if base else None
    return None


def slug_view_descriptor(slug: str) -> tuple[str, ViewDescriptor] | None:
    normalized = slug.strip().casefold()
    for descriptor in VIEW_DESCRIPTORS:
        if normalized.endswith(descriptor.slug_suffix):
            base = normalized[: -len(descriptor.slug_suffix)].strip("-")
            return (base, descriptor) if base else None
    return None


def candidate_confidence(descriptors: Iterable[ViewDescriptor]) -> str:
    items = tuple(descriptors)
    directional = {item.stem_suffix for item in items if item.kind == "directional"}
    return "high" if len(directional) >= 2 else "review"
