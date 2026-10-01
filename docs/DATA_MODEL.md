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

### catalog_folders
- `id`
- `franchise_id`
- `parent_id` opcional
- `slug`
- `name`
- `path` estável dentro da franquia
- `depth`
- `sort_order`

A árvore usa relação pai/filho e é independente da árvore física do acervo mestre. Isso permite organizar a navegação (`Vilões/Destruidor`, por exemplo) sem mover arquivos auditados.

### models
- `id`
- `slug`
- `code`
- `name`
- `franchise_id`
- `folder_id` opcional
- `collection` (rótulo/caminho público derivado)
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

`Categoria -> Franquia -> Pasta(s) opcional(is) -> Modelo -> Galeria paginada`

A pasta é um filtro hierárquico: selecionar um nó pai inclui os modelos de todos os descendentes. Franquias pequenas podem não precisar de agrupadores extras; franquias grandes podem introduzir grupos como `Vilões`, `Dioramas` ou outras divisões explícitas sem mudar o contrato geral.

Exemplo canônico: em `As Tartarugas Ninja`, heróis/aliados como `Leonardo`, `Raphael`, `Donatello`, `Michelangelo`, `Splinter`, `April O'Neil` e `Casey Jones` permanecem como pastas diretamente na raiz da franquia; vilões explicitamente revisados podem ser apresentados em `Vilões/<Personagem>`. A árvore pública é configurável e não move o acervo auditado. Personagens ambíguos não são classificados por heurística: permanecem no caminho de origem até existir decisão explícita no arquivo de taxonomia.

## Índices previstos

- `models(category_id, name)`
- `models(franchise_id, name)`
- `models(status, updated_at)`
- `model_images(model_id, sort_order)`
- `model_images(sha256)` único para duplicata exata
- índice auxiliar de busca para nome, franquia, código e tags

## Identidade

O código público do modelo deve ser estável. Mover ou renomear arquivos físicos não pode alterar a identidade do modelo no catálogo.
