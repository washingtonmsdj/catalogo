#!/usr/bin/env python3
"""Static, no-JavaScript visual review page for selected source galleries.

The browser loads remote source image URLs directly. No image is copied or
published here, and a visual comparison never authorizes sculpture identity.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


def render(manifest: dict) -> str:
    summary = manifest.get("summary") if isinstance(manifest, dict) else None
    items = manifest.get("items") if isinstance(manifest, dict) else None
    if (manifest.get("scope") != "small_gallery_review_only_current_coverage_snapshot"
            or manifest.get("identityApproved") is not False
            or manifest.get("mediaPromotionAuthorized") is not False
            or not isinstance(items, list) or not isinstance(summary, dict)
            or summary.get("products") != len(items)
            or summary.get("imageBytesDownloaded") != 0
            or summary.get("productionWrites") != 0
            or summary.get("stagingWrites") != 0):
        raise ValueError("invalid read-only gallery review")
    e = lambda val: html.escape(str(val), quote=True)
    cards: list[str] = []
    image_total = 0
    for item in items:
        if (not isinstance(item, dict) or item.get("identityApproved") is not False
                or item.get("creatorRightsVerified") is not False
                or item.get("mediaPromotionAuthorized") is not False
                or not isinstance(item.get("images"), list)
                or item.get("sourceImageCount") != len(item["images"])):
            raise ValueError("unsafe gallery review item")
        sources = []
        for img in item["images"]:
            if not isinstance(img, dict) or not isinstance(img.get("sourceUrl"), str) or not img["sourceUrl"].startswith("https://"):
                raise ValueError("invalid source image reference")
            url = e(img["sourceUrl"])
            sources.append(f'<a href="{url}" target="_blank" rel="noreferrer"><img loading="lazy" src="{url}" alt="Origem {e(item["sourceProductId"])} imagem {e(img["position"])}"/><span>Imagem {e(img["position"])}</span></a>')
            image_total += 1
        card = (
            '<section><div class="heading"><h2>' + e(item["sourceProductId"]) + ' · ' + e(item["sourceName"])
            + '</h2><p>Modelo publicado: ' + e(item["publishedModelName"]) + ' · ' + e(item["publishedFranchiseName"])
            + ' · <code>' + e(item["targetModelId"]) + '</code></p>'
            + '<p>Fonte: ' + e(item["sourceImageCount"]) + ' imagem(ns) · Publicado: '
            + e(item["publishedImageCount"]) + ' · Identidade/galeria/direitos: pendentes</p></div>'
            + '<div class="images">' + "".join(sources) + '</div>'
            + '<p class="foot">Conferir mesma escultura e variante, todas as vistas, marca d’água e direitos do criador. Não aprovar apenas pela capa.</p></section>'
        )
        cards.append(card)
    if image_total != summary.get("sourceImages"):
        raise ValueError("gallery image totals do not match")
    return (
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Catálogo · Revisão pontual de galerias</title><style>'
        ':root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#242321;background:#f5f3f0}'
        'body{max-width:1180px;margin:36px auto;padding:0 18px}h1{font-size:26px}h2{font-size:18px;margin:0 0 10px}'
        '.subtitle{color:#65625e}section{background:white;border:1px solid #ddd8d0;border-radius:12px;padding:20px;margin:18px 0}'
        '.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}'
        'a{color:#362e24;text-decoration:none;display:grid;gap:7px}'
        'img{width:100%;height:220px;object-fit:contain;background:#ece9e3;border-radius:8px}'
        '.heading p,.foot{font-size:13px;color:#67615b}.foot{border-top:1px solid #eee7dc;margin-top:15px;padding-top:12px}'
        'code{font-size:12px;overflow-wrap:anywhere}@media(max-width:600px){body{margin:16px auto}section{padding:12px}}'
        '</style></head><body><h1>Revisão visual de galerias · Catálogo</h1>'
        f'<p class="subtitle">{len(items)} produtos · {image_total} referências de imagens. '
        'Somente leitura; nenhum vínculo ou direito aprovado. As imagens são carregadas diretamente da fonte ao abrir esta página.</p>'
        + "".join(cards) + '</body></html>'
    )


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("input", type=Path)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    args.output.write_text(render(data), encoding="utf-8")
    print(f"Rendered {len(data['items'])} source gallery review cards")


if __name__ == "__main__":
    main()
