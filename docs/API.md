# API do Catálogo

A API pública do catálogo é desenhada para acervos grandes. Nenhuma rota de navegação deve exigir que o navegador receba a taxonomia inteira ou todas as imagens de um personagem.

## Categorias

`GET /api/categories`

Retorna a lista curta de categorias e suas contagens agregadas. A resposta inclui o item virtual `all` com o total do acervo publicado.

## Descoberta de franquias

`GET /api/franchises?category=games&limit=24`

A faixa de franquias é deliberadamente limitada. Ela retorna primeiro as franquias com mais modelos e informa se existem outras além do recorte exibido.

O Navegador do Acervo também pode pesquisar diretamente nas franquias:

`GET /api/franchises?category=games&q=resident&limit=48`

Parâmetros:

- `category` é opcional e restringe a descoberta a uma categoria;
- `q` é opcional; quando presente exige pelo menos 3 e no máximo 80 caracteres;
- `limit` é limitado no servidor a no máximo 48 itens;
- a resposta usa `truncated=true` quando existem mais correspondências do que o recorte retornado.

```json
{
  "items": [
    {
      "id": "resident-evil",
      "label": "Resident Evil",
      "count": 120,
      "category": "games"
    }
  ],
  "truncated": true
}
```

A busca de franquias usa um índice FTS5 trigram dedicado, atualizado por triggers. Isso mantém pesquisa parcial e sem acento indexada (`resi` → `Resident Evil`, `pokemon` → `Pokémon`) sem varrer a tabela inteira conforme a taxonomia crescer.

A UI principal continua usando um recorte pequeno para a faixa superior. O navegador de franquias consulta a taxonomia sob demanda e nunca precisa carregar os 100 mil+ modelos para montar a descoberta.

Consultas sem `q` recebem cache público mais longo. Buscas de franquia usam cache menor para equilibrar resposta rápida e atualização do acervo.

## Listagem

`GET /api/catalog?category=games&franchise=resident-evil&q=jill&limit=24&cursor=...`

Resposta:

```json
{
  "items": [],
  "nextCursor": "..."
}
```

A paginação é por cursor/keyset, não por `OFFSET`. O card recebe somente os dados necessários para a seleção: id, slug, código, nome, categoria, franquia, coleção, quantidade de imagens e referência da capa.

A busca pública usa o índice FTS e exige pelo menos 3 caracteres no modo LIVE. O frontend não dispara consultas de busca para termos menores.

## Detalhe do personagem

`GET /api/models/:slug`

Carrega a ficha completa somente quando o personagem é aberto ou selecionado. O card da listagem não carrega descrição, material e demais campos detalhados sem necessidade.

## Galeria

`GET /api/models/:slug/images?limit=12&cursor=...`

A galeria é independente da listagem principal. Um personagem com 100 imagens não faz o navegador baixar 100 imagens ao exibir o card.

As imagens são entregues por manifesto paginado. A capa prioriza a melhor versão disponível entre imagens equivalentes; variantes web (`thumb`, `card`, `detail`) evitam servir o original pesado nas telas de navegação.

## Orçamento

`POST /api/quotes`

```json
{
  "name": "Cliente",
  "email": "cliente@example.com",
  "notes": "Observações",
  "modelIds": ["mdl-000001", "mdl-000002"],
  "turnstileToken": "..."
}
```

O servidor:

- remove IDs repetidos;
- limita cada solicitação a 50 modelos;
- confirma que todos os IDs pertencem a modelos publicados;
- valida nome, e-mail e tamanho das observações;
- exige Turnstile em produção;
- recusa origens fora da allowlist configurada.

Favoritos permanecem locais no navegador enquanto a camada de autenticação não for implementada. Login e favoritos sincronizados devem entrar em uma camada separada do catálogo público, sem tornar a navegação anônima dependente de autenticação.

## Cache e mídia

Taxonomias e detalhes usam cache público mais longo; páginas do catálogo usam cache curto. Os binários de mídia ficam fora do Worker e são entregues pela origem/CDN configurada para o R2.
