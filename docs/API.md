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

## Pastas da franquia

`GET /api/folders?category=animes-desenhos&franchise=as-tartarugas-ninja`

A árvore de pastas é carregada sob demanda. `parent` recebe o caminho estável da pasta atual para listar somente seus filhos imediatos:

`GET /api/folders?category=animes-desenhos&franchise=as-tartarugas-ninja&parent=viloes`

Se `parent` não existir dentro da categoria/franquia informadas, a API responde `404 {"error":"folder_not_found"}`. O mesmo contrato vale para `folder` em `/api/catalog`; assim, um link antigo ou inválido não é confundido com uma pasta válida sem modelos.

A resposta inclui `current` com a contagem de toda a subárvore selecionada, `trail` com os ancestrais da raiz até a pasta atual e `items` com os filhos, suas contagens recursivas e `hasChildren`. Pastas são taxonomia pública; não correspondem obrigatoriamente a movimentos físicos na origem auditada.

## Listagem

`GET /api/catalog?category=games&franchise=resident-evil&q=jill&limit=24&cursor=...`

Resposta:

```json
{
  "items": [],
  "nextCursor": "..."
}
```

A paginação é por cursor/keyset, não por `OFFSET`. O card recebe somente os dados necessários para a seleção: id, slug, código, nome, categoria, franquia, caminho de pasta, coleção, quantidade de imagens e referência da capa.

Quando `folder` é informado, `category` e `franchise` também são obrigatórios. O filtro inclui recursivamente a pasta escolhida e todos os seus descendentes; por exemplo, `folder=viloes` retorna todos os modelos dentro de `Vilões`, inclusive os que estão em `Vilões/Destruidor`, `Vilões/Bebop` etc.

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

## Coleções compartilhadas

A coleção pessoal continua local por padrão. O cliente só envia uma seleção ao backend quando escolhe explicitamente criar um link público temporário.

### Criar link

`POST /api/shared-collections`

```json
{
  "name": "Terror",
  "modelIds": ["mdl-000001", "mdl-000002"],
  "turnstileToken": "..."
}
```

Regras do servidor:

- exige Turnstile com a ação `collection-share`;
- aceita no máximo 100 modelos e nome com até 48 caracteres;
- remove IDs repetidos;
- confirma que todos os modelos enviados estão publicados;
- gera um código público aleatório `TCL-...`, sem colocar os IDs na URL;
- mantém a ordem dos modelos enviada pelo cliente;
- links expiram 30 dias após a criação;
- conteúdo idêntico ainda válido reutiliza o mesmo link, evitando duplicação desnecessária no D1;
- nenhum nome de cliente, e-mail ou identidade do navegador é armazenado junto da coleção.

Resposta resumida:

```json
{
  "code": "TCL-...",
  "name": "Terror",
  "itemCount": 2,
  "availableCount": 2,
  "createdAt": "2026-09-30T21:00:00.000Z",
  "expiresAt": "2026-10-30T21:00:00.000Z",
  "deduplicated": false,
  "items": []
}
```

### Abrir link

`GET /api/shared-collections/:code`

A leitura não exige login. O código possui entropia alta e funciona como segredo de posse do link. A resposta inclui apenas modelos que continuam publicados. Por isso `availableCount` pode ser menor que `itemCount` quando algum item foi retirado do catálogo depois da criação.

Links expirados ou códigos inválidos retornam `404` com `shared_collection_not_found`. O frontend usa `?colecao=TCL-...` e permite que o destinatário visualize a seleção antes de decidir salvá-la nas próprias coleções locais.

## Cache e mídia

Taxonomias e detalhes usam cache público mais longo; páginas do catálogo usam cache curto. Os binários de mídia ficam fora do Worker e são entregues pela origem/CDN configurada para o R2.
