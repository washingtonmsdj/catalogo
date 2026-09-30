# Modelo de dados para 100 mil+ modelos

## Princípio

O catálogo não trata imagem como produto. O produto/modelo é a entidade principal e possui uma galeria própria com dezenas de imagens quando necessário.

## Estrutura lógica

### categories
- `id`
- `slug`
- `name`
- `parent_id` opcional
- `sort_order`

### franchises
- `id`
- `slug`
- `name`
- `category_id`

### models
- `id`
- `slug`
- `code`
- `name`
- `franchise_id`
- `category_id`
- `collection`
- `material`
- `height_cm`
- `description`
- `gallery_count`
- `cover_image_id`
- `status`
- `created_at`
- `updated_at`

### model_images
- `id`
- `model_id`
- `sha256`
- `phash`
- `storage_key`
- `mime`
- `width`
- `height`
- `bytes`
- `quality_score`
- `role`
- `sort_order`
- `duplicate_group_id` opcional

## Regra de carregamento

A listagem de modelos retorna somente metadados de card e a imagem de capa. A galeria completa só é consultada quando o usuário abre um personagem/modelo.

Nunca retornar dezenas de imagens por personagem na busca principal.

## Paginação

Usar cursor em vez de `offset` para grandes volumes. O contrato inicial limita cada resposta a no máximo 60 modelos ou imagens.

Fluxo recomendado:

`Categoria -> Franquia -> Modelo -> Galeria paginada`

## Índices previstos

- `models(category_id, name)`
- `models(franchise_id, name)`
- `models(status, updated_at)`
- `model_images(model_id, sort_order)`
- `model_images(sha256)` único para duplicata exata
- índice auxiliar de busca para nome, franquia, código e tags

## Identidade

O código público do modelo deve ser estável. Mover ou renomear arquivos físicos não pode alterar a identidade do modelo no catálogo.
