# Identidade do catálogo

A identidade comercial do catálogo possui uma única fonte de verdade:

- `config/brand.json`

O valor atual da marca é definido exclusivamente nesse arquivo e não deve ser repetido como literal no código de interface.

A interface React consome essa definição por `src/config/brand.ts`. O Vite usa a mesma definição para preencher os metadados do `index.html` e gerar `site.webmanifest` no build. O smoke test do GitHub Pages também lê o mesmo arquivo, portanto não mantém uma segunda marca hardcoded.

## Sistema visual único do frontend

A identidade nominal continua exclusivamente em `config/brand.json`. A **única fonte de valores de cores, superfícies, bordas, estados e fontes** do frontend é o bloco `:root` inicial de `src/catalog-home.css`, na família de tokens `--store-*`:

- Grafite para plano de fundo e painéis (`--store-bg`, `--store-panel`, `--store-panel-2`), com bordas discretas.
- Marfim para texto (`--store-text`) e cinza quente para informações secundárias (`--store-muted`).
- Laranja cobre para ação, foco e seleção (`--store-accent`, `--store-accent-hover`, `--store-accent-soft`).
- Uma fonte sans-serif de sistema (`--store-font-body`, `--store-font-display`), sem dependência de download de fontes de terceiros. Código e identificadores técnicos usam `--store-font-mono`.

O CSS `src/catalog-shell.css` mantém somente **aliases de compatibilidade**, como `--accent: var(--store-accent)`, para os componentes ainda existentes. As antigas paletas em `styles.css`, `premium.css` e na segunda declaração `:root` de `catalog-home.css` foram eliminadas; não introduzir novas definições concorrentes ou cores paralelas por componente. Usar os tokens em novas regras CSS e preservar contrastes e indicadores de foco.

A navegação mobile usa **a mesma barra de cinco destinos**, sem menu duplicado. Os destinos precisam manter área clicável de ao menos 44 px, ativo diferenciado, foco de teclado visível e nenhum transbordamento em 320, 390 e 620 px. O CI verifica os tokens *calculados pelo navegador*, tipografia, largura dos alvos, estados e seis larguras responsivas no teste já existente `tools/test_catalog_visual.mjs`.

## Navegação e tipografia responsiva (continuação de 2026-11-01)

- Não duplicar o menu. A barra superior existente possui os cinco destinos; em telefones (até 620 px) ela é uma grade de cinco alvos, e em tablets/compactos (621–1080 px) aparece em uma segunda linha com rolagem horizontal somente se faltar espaço. A lateral não aparece nessa faixa.
- O destino **Explorar** aponta para `#destaques` no modo de resultados e para `#catalogo` na página editorial. Âncoras locais usam `aria-current="location"`.
- Escala de texto compartilhada no mesmo bloco `:root` de `src/catalog-home.css`: `--store-type-caption`, `--store-type-label` e `--store-type-body`; usar a escala, evitando legendas de 7–8 px.
- Superfícies, hover, monograma e indicadores neutros herdam `--store-*`. Verde continua possível somente para status de saúde (não como cor de marca).
- `tools/test_catalog_home_a11y.mjs` e `tools/test_catalog_visual.mjs` guardam a navegação e a geometria nas seis resoluções de teste. O teste visual usa o build demo isolado, não consulta produção/D1.

## Vitrine responsiva e leitura de resultados

- A seleção editorial contém até seis modelos por `modelsForCatalogHome`. Nenhuma media query pode ocultar a quinta ou a sexta ficha com `nth-child`; a grade se reorganiza conforme a largura, mantendo todos os modelos selecionados acessíveis.
- O resumo de resultados de `#destaques`, inclusive quantidade, escopo e página, continua visível em telas pequenas. Ocultar a descrição editorial secundária não deve esconder informações de resultados nem a atualização anunciada por `aria-live`.
- Ações rápidas dos cards, controles de grade/lista e categorias no celular utilizam alvos de 44 px, sem sobreposição das legendas. O teste real em Chromium verifica a vitrine e os resultados em seis larguras.
- As alterações são exclusivamente de frontend; o teste visual usa build de demonstração isolado, sem consultar D1 de produção.

## Busca rápida e sugestões (2026-11-01)

- O atalho anunciado **Ctrl+K** (ou Cmd+K em macOS) foca a busca global existente, seleciona a consulta atual para substituição e nunca abre o explorador de franquias. A tecla **/** faz o mesmo fora de campos editáveis; **E** continua abrindo o explorador. Nenhum atalho global invade um diálogo modal.
- O botão **Limpar busca** devolve o foco ao mesmo campo, sem montar uma segunda busca. Seu alvo móvel mede ao menos 44 px.
- Em telas até 760 px, a lista de sugestões se ancora à posição real do campo por CSS relativo. Não usar coordenadas fixas de viewport; respeitar altura disponível, rolagem interna, visibilidade do resultado completo fixado no rodapé do painel e tipografia --store-type-*.
- Os testes verificam atalhos, foco, limites geométricos e interação em Chromium isolado, sem consultas ao D1 de produção.

## Filtros ativos e filtros salvos (2026-11-01)

- Chips de filtro ativo compartilham `--store-panel`, `--store-border`, `--store-type-caption` e a ação de destaque, sem regras residuais verdes nem !important concorrente.
- Em celulares, remover categoria/franquia/atributo, copiar link, salvar filtro e limpar tudo usam áreas de toque com pelo menos 44 px e texto de 12 px. Os controles quebram linha, sem criar rolagem horizontal da página.
- Filtros salvos mantêm a navegação horizontal local quando necessário, textos longos truncados e remoção com 44 px. Os estados de foco usam o acento da marca.
- O browser CI exercita aplicação, salvamento, remoção e limpeza nos 320 e 390 px, sem consultar API ou D1 de produção.

## Troca futura de marca

Uma futura mudança comercial deve começar por `config/brand.json`. Não faça substituição global no repositório.

Valide primeiro a fonte da identidade:

```powershell
npm run brand:source
```

Depois execute o gate completo:

```powershell
npm run check
```

O primeiro comando bloqueia identidade concorrente tanto no conteúdo quanto em nomes/caminhos de arquivos, além de impedir hardcode do nome comercial fora do SSOT. O segundo também compila o frontend, valida os artefatos gerados, o orçamento de bundle e o Worker.

Identificadores técnicos persistentes não fazem parte da identidade visual e **não devem ser renomeados junto com a marca** sem uma migração planejada. Isso inclui, por exemplo:

- chaves `tonecos:*` de `localStorage`;
- nomes de Worker, D1 e R2 já provisionados;
- IDs, slugs, storage keys e protocolos já persistidos.

Essa separação evita perda de favoritos locais, quebra de URLs, duplicação de infraestrutura ou migrações desnecessárias quando a marca comercial mudar.
