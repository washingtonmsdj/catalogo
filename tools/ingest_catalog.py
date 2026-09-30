#!/usr/bin/env python3
"""Tonecos catalog ingestion analyzer.

Scans an existing folder hierarchy without mutating source files. It produces a
resumable manifest containing integrity, hashes, dimensions and a quality score,
then groups exact/visual duplicate candidates and recommends the best source.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".jfif"}
COUNT_SUFFIX = re.compile(r"\s*\[\d+\]\s*$")
OK_PREFIX = re.compile(r"^OK\s*-\s*", re.IGNORECASE)


@dataclass
class ImageRecord:
    path: str
    size: int
    mtime_ns: int
    status: str
    error: str | None
    sha256: str | None
    dhash: str | None
    width: int | None
    height: int | None
    megapixels: float | None
    sharpness: float | None
    quality_score: float | None
    category: str | None
    franchise: str | None
    model_key: str
    duplicate_group: str | None = None
    canonical: bool = True


def clean_folder(value: str) -> str:
    return COUNT_SUFFIX.sub("", OK_PREFIX.sub("", value)).strip()


def iter_images(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            yield path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dhash_image(image: Image.Image) -> str:
    sample = ImageOps.grayscale(image).resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(sample.getdata())
    value = 0
    bit = 0
    for row in range(8):
        offset = row * 9
        for col in range(8):
            if pixels[offset + col] > pixels[offset + col + 1]:
                value |= 1 << bit
            bit += 1
    return f"{value:016x}"


def sharpness_score(image: Image.Image) -> float:
    sample = ImageOps.grayscale(image)
    sample.thumbnail((900, 900), Image.Resampling.LANCZOS)
    edges = sample.filter(ImageFilter.FIND_EDGES)
    stat = ImageStat.Stat(edges)
    return round(float(stat.var[0]) ** 0.5, 3)


def quality_score(width: int, height: int, sharpness: float, suffix: str) -> float:
    mp = (width * height) / 1_000_000
    resolution = min(55.0, 55.0 * math.log1p(mp) / math.log1p(12.0))
    detail = min(35.0, sharpness * 1.2)
    format_bonus = {".png": 10.0, ".tif": 10.0, ".tiff": 10.0, ".webp": 8.0, ".avif": 8.0, ".jpg": 7.0, ".jpeg": 7.0}.get(suffix.lower(), 5.0)
    return round(resolution + detail + format_bonus, 3)


def taxonomy(root: Path, path: Path) -> tuple[str | None, str | None, str]:
    rel = path.relative_to(root)
    folders = [clean_folder(part) for part in rel.parts[:-1]]
    category = folders[0] if folders else None
    franchise = folders[1] if len(folders) > 1 else None
    # Preserve the entire parent hierarchy: same character names in distinct
    # franchises must never be merged just because their leaf folder matches.
    model_key = " / ".join(folders) if folders else path.stem
    return category, franchise, model_key


def analyze(root: Path, path: Path) -> ImageRecord:
    stat = path.stat()
    rel = str(path.relative_to(root))
    category, franchise, model_key = taxonomy(root, path)
    try:
        if stat.st_size <= 0:
            raise ValueError("arquivo vazio")
        digest = sha256_file(path)
        with Image.open(path) as verify_image:
            verify_image.verify()
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = image.size
            perceptual = dhash_image(image)
            sharpness = sharpness_score(image)
        return ImageRecord(
            path=rel, size=stat.st_size, mtime_ns=stat.st_mtime_ns,
            status="OK", error=None, sha256=digest, dhash=perceptual,
            width=width, height=height, megapixels=round(width * height / 1_000_000, 3),
            sharpness=sharpness, quality_score=quality_score(width, height, sharpness, path.suffix),
            category=category, franchise=franchise, model_key=model_key,
        )
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        return ImageRecord(
            path=rel, size=stat.st_size, mtime_ns=stat.st_mtime_ns,
            status="ERRO", error=f"{type(exc).__name__}: {exc}", sha256=None, dhash=None,
            width=None, height=None, megapixels=None, sharpness=None, quality_score=None,
            category=category, franchise=franchise, model_key=model_key,
        )


def hamming(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def choose_canonical(records: list[ImageRecord]) -> ImageRecord:
    return max(records, key=lambda item: (item.quality_score or -1, item.width or 0, item.height or 0, item.size))


def mark_duplicates(records: list[ImageRecord], visual_threshold: int) -> list[dict]:
    groups: list[dict] = []
    valid = [record for record in records if record.status == "OK" and record.sha256 and record.dhash]

    # Exact duplicates are scoped to a model gallery. The same binary image may
    # legitimately be referenced by two different models (for example a shared
    # diorama). Removing it globally would make one model lose its image.
    exact: dict[tuple[str, str], list[ImageRecord]] = defaultdict(list)
    for record in valid:
        exact[(record.model_key, record.sha256 or "")].append(record)
    exact_counter = 0
    for (model_key, digest), members in exact.items():
        if len(members) < 2:
            continue
        exact_counter += 1
        group_id = f"exact-{exact_counter:06d}"
        canonical = choose_canonical(members)
        for member in members:
            member.duplicate_group = group_id
            member.canonical = member is canonical
        groups.append({
            "id": group_id,
            "kind": "exact",
            "model_key": model_key,
            "sha256": digest,
            "canonical": canonical.path,
            "members": [m.path for m in members],
        })

    # Visual comparison is intentionally scoped to one model hierarchy. This
    # avoids merging unrelated characters that happen to have similar silhouettes.
    by_model: dict[str, list[ImageRecord]] = defaultdict(list)
    for record in valid:
        if not record.duplicate_group:
            by_model[record.model_key].append(record)

    visual_counter = 0
    for model_key, members in by_model.items():
        remaining = set(range(len(members)))
        while remaining:
            seed_index = remaining.pop()
            cluster = [seed_index]
            frontier = [seed_index]
            while frontier:
                current = frontier.pop()
                near = [idx for idx in remaining if hamming(members[current].dhash or "0", members[idx].dhash or "0") <= visual_threshold]
                for idx in near:
                    remaining.remove(idx)
                    frontier.append(idx)
                    cluster.append(idx)
            if len(cluster) < 2:
                continue
            visual_counter += 1
            group_id = f"visual-{visual_counter:06d}"
            cluster_records = [members[idx] for idx in cluster]
            canonical = choose_canonical(cluster_records)
            for member in cluster_records:
                member.duplicate_group = group_id
                member.canonical = member is canonical
            groups.append({
                "id": group_id, "kind": "visual_candidate", "model_key": model_key,
                "threshold": visual_threshold, "canonical": canonical.path,
                "members": [m.path for m in cluster_records],
            })
    return groups


def load_checkpoint(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return {row["path"]: row for row in (json.loads(line) for line in handle if line.strip())}


def record_from_checkpoint(row: dict) -> ImageRecord:
    allowed = ImageRecord.__dataclass_fields__.keys()
    return ImageRecord(**{key: row.get(key) for key in allowed})


def write_outputs(output: Path, records: list[ImageRecord], groups: list[dict]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "manifest.jsonl"
    with manifest.open("w", encoding="utf-8") as handle:
        for record in sorted(records, key=lambda item: item.path.casefold()):
            handle.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

    with (output / "duplicates.json").open("w", encoding="utf-8") as handle:
        json.dump(groups, handle, ensure_ascii=False, indent=2)

    fields = ["path", "status", "width", "height", "megapixels", "quality_score", "model_key", "duplicate_group", "canonical", "error"]
    with (output / "manifest.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in sorted(records, key=lambda item: item.path.casefold()):
            row = asdict(record)
            writer.writerow({key: row.get(key) for key in fields})

    summary = {
        "images": len(records),
        "ok": sum(record.status == "OK" for record in records),
        "errors": sum(record.status != "OK" for record in records),
        "duplicate_groups": len(groups),
        "duplicate_members": sum(len(group["members"]) for group in groups),
        "canonical_images": sum(record.status == "OK" and record.canonical for record in records),
        "models_detected": len({record.model_key for record in records}),
    }
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Analisa um catálogo sem modificar os arquivos de origem.")
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".catalog-ingest"))
    parser.add_argument("--visual-threshold", type=int, default=6)
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    root = args.source.resolve()
    if not root.is_dir():
        parser.error(f"pasta não encontrada: {root}")
    if not 0 <= args.visual_threshold <= 16:
        parser.error("--visual-threshold deve ficar entre 0 e 16")

    old = {} if args.no_resume else load_checkpoint(args.output / "manifest.jsonl")
    records: list[ImageRecord] = []
    paths = sorted(iter_images(root), key=lambda item: str(item).casefold())
    print(f"TOTAL={len(paths)} CHECKPOINT={len(old)}")

    for index, path in enumerate(paths, 1):
        rel = str(path.relative_to(root))
        stat = path.stat()
        cached = old.get(rel)
        if cached and cached.get("size") == stat.st_size and cached.get("mtime_ns") == stat.st_mtime_ns:
            record = record_from_checkpoint(cached)
            # Duplicate decisions are recomputed every run from the complete set.
            record.duplicate_group = None
            record.canonical = True
        else:
            print(f"PROGRESSO={index}/{len(paths)} {rel}", flush=True)
            record = analyze(root, path)
        records.append(record)

    groups = mark_duplicates(records, args.visual_threshold)
    write_outputs(args.output, records, groups)
    return 1 if any(record.status != "OK" for record in records) else 0


if __name__ == "__main__":
    sys.exit(main())
