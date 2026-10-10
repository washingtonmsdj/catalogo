# Migração Cloudflare — Tonecos Studio — 2026-10-09

## Objetivo

Mover a infraestrutura do Catálogo da conta Cloudflare Washington para a conta Tonecos Studio sem alterar a identidade lógica dos recursos, sem perda de dados e mantendo rollback disponível até o fechamento do cutover.

## Destino canônico preparado

- Conta Cloudflare: Tonecos Studio
- Account ID: `8827c547d6def5ee5b9ca550fdd5680a`
- Worker: `tonecos-catalogo-api`
- API: `https://tonecos-catalogo-api.tonecosstudio.workers.dev`
- D1: `tonecos-catalogo`
- D1 ID: `87006366-60f3-4937-af73-2ef5a5f901fb`
- R2: `tonecos-catalogo-media`
- Mídia pública: `https://pub-bc7ed3247d8d4391946761221e77e6b9.r2.dev`
- Turnstile sitekey: `0x4AAAAAAFSpOhaAFp6Gsjqd`

## Evidências de integridade

Migração de dados concluída e validada antes do cutover público:

- 2.596 modelos;
- 1.063 pastas;
- 250 franquias;
- 6 categorias;
- 12.717 objetos R2;
- 512.294.967 bytes no R2;
- inventário `key + size + ETag` idêntico entre origem e destino;
- FTS5, índices e triggers reconstruídos e comparados;
- buscas de controle e fingerprints lógicos equivalentes.

Inventário R2 validado: SHA-256 `7f6730…d76d`.

## Smoke pós-reset do D1

Após o reset diário do D1 Free em 2026-10-10 00:00 UTC, foi executado smoke interno na própria Cloudflare contra o Worker Tonecos:

- `/api/health` — OK;
- `/api/categories` — OK;
- `/api/recent?limit=3` — OK;
- `/api/catalog?q=naruto&limit=3` — OK.

O D1 confirmou novamente as contagens canônicas de 2.596 modelos, 1.063 pastas, 250 franquias e 6 categorias.

## Estado do cutover

A origem Washington permanece preservada como rollback até a validação pública final. Nenhum recurso antigo deve ser apagado enquanto o proxy first-party do Achegue-se, o preview GitHub Pages e a mídia pública Tonecos não estiverem confirmados.

As Repository Variables do frontend devem apontar para a conta Tonecos. O deploy do Worker via GitHub Actions permanece fail-closed até existir um `CLOUDFLARE_API_TOKEN` válido da conta Tonecos e o `TURNSTILE_SECRET_KEY` correspondente no Actions Secrets. Não adicionar credenciais ao repositório.

## Regra operacional

O corte deve ocorrer em etapas verificáveis:

1. rebuild do frontend com os endpoints públicos Tonecos;
2. validação do preview publicado;
3. troca do proxy `/catalogo-api` no Achegue-se;
4. validação do domínio público;
5. somente depois, limpeza dos Workers/Workflows temporários de migração;
6. manter a infraestrutura Washington intacta até o encerramento formal do rollback window.
