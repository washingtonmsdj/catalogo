# Publicação de mídia no R2

O bundle de publicação transforma somente imagens `OK` e `canonical=true` do manifesto de ingestão.

## Comando

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle"
```

Por padrão o bundle **não copia o original** para o R2. O arquivo mestre continua preservado no acervo de origem. Para incluir também o original:

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle" --include-original
```

## Variantes

Cada imagem canônica gera:

- `thumb.webp`: lado máximo 360 px;
- `card.webp`: lado máximo 800 px;
- `detail.webp`: lado máximo 1600 px.

Imagens menores nunca são ampliadas artificialmente.

## Estrutura

```text
.publish-bundle/
  models.jsonl
  publish-summary.json
  r2/
    gallery/<model-id>/v1.json
    media/<model-id>/<image-id>/thumb.webp
    media/<model-id>/<image-id>/card.webp
    media/<model-id>/<image-id>/detail.webp
```

`models.jsonl` é a ponte para alimentar o D1. Cada linha contém o ID determinístico do personagem, hierarquia de origem, nome de exibição, número de imagens, capa e chave do manifesto da galeria.

## IDs determinísticos

O ID do modelo deriva da hierarquia completa, e o ID da imagem deriva do SHA-256. Portanto uma nova execução não gera IDs aleatórios para conteúdo que não mudou.

## Capa

A primeira capa automática é a imagem canônica de maior `quality_score`. No futuro o painel administrativo poderá sobrescrever essa escolha sem alterar o arquivo original.

## Upload

O conteúdo interno de `.publish-bundle/r2/` corresponde às chaves esperadas no bucket `tonecos-catalogo-media`. A pasta inteira é ignorada pelo Git e nunca deve ser commitada no repositório.
