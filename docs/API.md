# API do Catálogo

A API é paginada por cursor e não retorna o acervo inteiro em nenhuma rota.

## Listagem

`GET /api/catalog?category=games&franchise=resident-evil&q=jill&limit=24&cursor=...`

Resposta:

```json
{
  "items": [],
  "nextCursor": "..."
}
```

O card recebe somente os dados necessários para a seleção: id, slug, código, nome, categoria, franquia, coleção, quantidade de imagens e referência da capa.

## Detalhe do personagem

`GET /api/models/:slug`

Carrega a ficha completa somente quando o personagem é aberto.

## Galeria

`GET /api/models/:slug/images?limit=24&cursor=...`

A galeria é independente da listagem principal. Um personagem com 100 imagens não faz o navegador baixar 100 imagens ao exibir o card.

A ordenação prioriza `cover`, depois `quality_score`, preservando a regra de mostrar a melhor versão quando existem imagens equivalentes.

## Orçamento

`POST /api/quotes`

```json
{
  "name": "Cliente",
  "email": "cliente@example.com",
  "notes": "Observações",
  "modelIds": ["mdl-000001", "mdl-000002"]
}
```

O servidor remove IDs repetidos e limita a lista de uma solicitação a 100 modelos.

## Segurança prevista

Antes da exposição pública do endpoint de orçamento serão adicionados Turnstile, rate limiting e validação mais rígida de payload. Login e favoritos sincronizados entram em uma camada de autenticação separada do catálogo público.
