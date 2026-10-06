from __future__ import annotations

import json
import re
from pathlib import Path

COUNT_SUFFIX = re.compile(r"\s*\[\d+\]\s*$")
OK_PREFIX = re.compile(r"^OK\s*-\s*", re.IGNORECASE)
DEFAULT_PUBLIC_SCOPE_CONFIG = Path(__file__).resolve().parents[1] / "config" / "public-catalog-roots.json"


def load_public_top_level_categories(path: Path | None = None) -> tuple[str, ...]:
    config_path = path or DEFAULT_PUBLIC_SCOPE_CONFIG
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"configuração de raízes públicas ausente: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON de raízes públicas inválido: {config_path}: {exc}") from exc

    categories = data.get("categories") if isinstance(data, dict) else None
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(categories, list) or not categories:
        raise RuntimeError(f"configuração de raízes públicas inválida: {config_path}")

    normalized: list[str] = []
    seen: set[str] = set()
    for value in categories:
        if not isinstance(value, str) or not value.strip():
            raise RuntimeError(f"categoria pública inválida em: {config_path}")
        name = value.strip()
        key = name.casefold()
        if key in seen:
            raise RuntimeError(f"categoria pública duplicada em: {config_path}: {name}")
        if "/" in name or "\\" in name or name in {".", ".."}:
            raise RuntimeError(f"categoria pública insegura em: {config_path}: {name}")
        seen.add(key)
        normalized.append(name)
    return tuple(normalized)


PUBLIC_TOP_LEVEL_CATEGORIES = load_public_top_level_categories()
PUBLIC_TOP_LEVEL_KEYS = frozenset(name.casefold() for name in PUBLIC_TOP_LEVEL_CATEGORIES)


def clean_folder(value: str) -> str:
    return COUNT_SUFFIX.sub("", OK_PREFIX.sub("", value)).strip()


def is_public_top_level_category(value: str) -> bool:
    return clean_folder(value).casefold() in PUBLIC_TOP_LEVEL_KEYS
