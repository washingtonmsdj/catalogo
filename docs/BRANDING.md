# Identidade do catálogo

A identidade comercial do catálogo possui uma única fonte de verdade:

- `config/brand.json`

O valor atual da marca é definido exclusivamente nesse arquivo e não deve ser repetido como literal no código de interface.

A interface React consome essa definição por `src/config/brand.ts`. O Vite usa a mesma definição para preencher os metadados do `index.html` e gerar `site.webmanifest` no build. O smoke test do GitHub Pages também lê o mesmo arquivo, portanto não mantém uma segunda marca hardcoded.

## Troca futura de marca

Uma futura mudança comercial deve começar por `config/brand.json`. Depois, execute os testes e o build; eles validam que HTML, manifesto e componentes continuam coerentes.

Identificadores técnicos persistentes não fazem parte da identidade visual e **não devem ser renomeados junto com a marca** sem uma migração planejada. Isso inclui, por exemplo:

- chaves `tonecos:*` de `localStorage`;
- nomes de Worker, D1 e R2 já provisionados;
- IDs, slugs, storage keys e protocolos já persistidos.

Essa separação evita perda de favoritos locais, quebra de URLs, duplicação de infraestrutura ou migrações desnecessárias quando a marca comercial mudar.
