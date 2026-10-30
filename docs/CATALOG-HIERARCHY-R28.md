# R28 — Navegação de subpastas no Catálogo responsivo

## Lacuna

A barra lateral deixa de aparecer em telas até 1080 px. Ela era a única entrada para a árvore de subpastas: o navegador responsivo oferecia categorias, franquias e busca de modelos, mas não permitia navegar no recorte de pastas/coleções internas.

## Mudança, sem SSOT paralelo

- A linha de cada franquia live oferece duas ações independentes: Ver modelos, mantendo a seleção direta anterior, e Navegar pastas.
- A segunda ação abre a mesma árvore CatalogSidebarTree que já atende a barra lateral desktop, usando o serviço existente listCatalogFolders e o contrato /api/folders.
- É possível voltar à lista de franquias, abrir todos os modelos de uma franquia ou escolher uma pasta profunda, expandindo apenas os grupos necessários.
- A seleção encaminha categoria, franquia e pasta para os setters canônicos de useCatalogRuntime, sem novo serviço, endpoint, cache, esquema ou dados inventados.
- Os controles de pasta e as ações de retorno têm alvos de toque de no mínimo 44 px, nomes acessíveis e foco visível.
- No demo, não mostramos estrutura fictícia de pastas; a ação de pastas requer o modo live.

## Verificação

npm run test:catalog-home inclui tools/test_catalog_hierarchy_contract.mjs. A CI também valida TypeScript, build e visual responsivo. A auditoria visual usa dados demo, portanto não comprova a interação com /api/folders em produção; o teste integrado live depende do retorno do binding D1.

A mudança não altera Worker, quota D1 ou rotas privadas de orçamentos.