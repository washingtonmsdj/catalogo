# R29 — E2E contratual da hierarquia no navegador

## Objetivo

Cobrir a jornada `franquia → pastas → personagem → modelo` da implementação live, principalmente nas telas 320, 390 e 1024 px. A R28 só possuía testes estáticos e auditoria visual do modo demo. Este teste usa o **bundle live real** do frontend e o **cliente HTTP real**, interceptando unicamente as respostas da API na própria sessão isolada do navegador.

## Limites de evidência

As respostas foram modeladas conforme os contratos existentes em `worker/index.ts` e **são sintéticas**, restritas a `tools/test_catalog_live_navigation.mjs`. Nenhuma API de produção, D1, Worker remoto ou credencial é contatada pelo teste. A falha transitória 503 da pasta intermediária é deliberada para validar o retry real do componente; não é uma autorização para ocultar problemas na API.

## Gate de CI

O job `visual-audit` mantém seu bundle `demo` e passa também a compilar um bundle independente com `VITE_CATALOG_MODE=live` e `VITE_API_BASE_URL` apontando exclusivamente para o preview local. O teste Playwright reutiliza a instalação existente. Antes de executar, o mesmo verificador de artefatos assegura que o bundle live não contenha inventário demo.

O script verifica: entrada de filtros, seleção da franquia, árvore canônica, expansão até personagem, falha e retry de uma subpasta, seleção de `pasta` na URL, filtragem real por `/api/catalog`, abertura/fechamento do detalhe via `/api/models/:slug`, franquia vazia sem inventar conteúdo e ausência de requisições externas.

## Pendência de produção

O check administrativo mínimo da API Cloudflare D1 voltou a responder em 18/10/2026, **mas não prova a leitura pelo binding do Worker**. O E2E de contrato não é aprovação de produção. Confirmar via smoke de health real do Worker e, depois, E2E read-only nos endpoints públicos quando a quota diária estiver recuperada. Rotas privadas de administração permanecem desativadas.
