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
