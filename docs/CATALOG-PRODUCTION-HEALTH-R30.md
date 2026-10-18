# R30 — Verificação pública real da hierarquia (somente leitura)

## Diagnóstico em 18/10/2026

O health do Worker direto respondeu **HTTP 503** (`schema.ready=false`); o proxy público `https://acheguese.com.br/catalogo-api/api/health` também respondeu 503. Uma consulta administrativa à Cloudflare D1 retornou explicitamente **erro 7500: cota diária de linhas lidas excedida**. Zero migrações/estruturas `verified` no health, enquanto o D1 está inacessível, **não prova migração perdida** e nunca autoriza reset/recriação.

Na conta Tonecos Studio, o metadata da Cloudflare confirma que o Worker `tonecos-catalogo-api` está 100% na versão `bf4c71a0-eca3-4a84-a352-040431af1012`. O binding `DB` usa o ID `87006366-60f3-4937-af73-2ef5a5f901fb`, igual ao `wrangler.jsonc`. O binding `MEDIA` e o segredo requerido também estão presentes. A publicação frontend não resolve o limite de leitura da API.

## Probe canônico pós-recuperação

`node tools/check_public_catalog_hierarchy.mjs https://tonecos-catalogo-api.tonecosstudio.workers.dev`

O script reutiliza `verifyWorkerHealth` de `check_worker_health.mjs`. **Se o health falhar, faz apenas uma requisição**, sem tentar consultar as tabelas. Quando o health está saudável, lê apenas GETs públicos: categorias, franquias, no máximo cinco candidatas de pastas, até três níveis de árvore, lista de um modelo por pasta e seu detalhe. Valida categoria, franquia, ancestralidade da pasta, identificadores e slug, sem inventar modelos; não envia POST, PUT, PATCH ou DELETE. O limite é 12 GETs e não há paginação integral nem download de imagens.

O teste `tools/test_public_catalog_hierarchy.mjs` integra o comando já existente `npm run test:worker-release-smoke`, usa respostas fictícias locais, confirma falha fechada em HTTP 503, erro de escopo, modelo inexistente e detalhe inconsistente. Não toca em D1 na CI. **Testes com fixture não representam health de produção.**

## Critérios de liberação e pendências

1. Health real aprovado conforme SSOT de migrações e estruturas.
2. Smoke público real da hierarquia aprovado.
3. E2E do navegador em modo live contra o Worker publicado aprovado em ambiente de auditoria somente leitura.
4. Cloudflare Access + MFA configurados antes de montar qualquer rota de administração de orçamentos.

Nenhum workaround de quota, Worker paralelo, cache fictício ou replay de migrações está autorizado.

## R31 — Redução estrutural de leituras concorrentes de esquema

Auditoria de código: `worker/index.ts` chama `catalogSchemaStatus` como guard do tráfego API. O módulo já mantinha cache quando a auditoria era bem-sucedida, porém não compartilhava a promessa em andamento entre requisições simultâneas e repetia a leitura de metadados imediatamente após uma falha. Isso **pode amplificar leituras e falhas** em cold starts e períodos de indisponibilidade; não é prova de que seja a única causa do esgotamento diário observado.

`worker/schemaContract.ts` passa a compartilhar uma única promessa de auditoria por instância, inclusive nas primeiras requisições simultâneas. O resultado válido continua em cache por toda a vida da instância. Um estado `ready=false` fica em cache por 30 segundos na mesma instância, depois uma nova requisição força uma auditoria real; durante a janela o Worker continua negando operações dependentes de D1 com HTTP 503. Não existe modo offline, bypass de esquema, outro banco, nem resposta `ok=true` sem auditoria.

Testes exercitam 40 pedidos simultâneos na primeira validação, 30 concorrentes quando a quota falha, ausência de rechecagem antecipada, recuperação após os 30 segundos e permanência do cache saudável. A publicação depende dos gates de deploy Cloudflare existentes e ficará bloqueada se o health do Worker continuar em 503.
