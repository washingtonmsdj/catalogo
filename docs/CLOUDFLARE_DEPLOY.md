# Deploy Cloudflare

O Catálogo usa `https://acheguese.com.br/tonecosstudios/` como URL pública canônica. O frontend é publicado no GitHub Pages e montado sob o Achegue-se. A Cloudflare é responsável pelo Worker, D1, R2 e Turnstile.

## Recursos canônicos de produção

Conta: **Tonecos Studio**.

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- D1 ID: `87006366-60f3-4937-af73-2ef5a5f901fb`
- R2 privado: `tonecos-catalogo-media`
- binding D1: `DB`
- binding R2: `MEDIA`
- entrypoint: `worker/entry.ts`
- segredo obrigatório: `TURNSTILE_SECRET_KEY`

`wrangler.jsonc` é a SSOT versionada para Worker, D1, R2, CORS, compatibility, cache, observability e contrato de segredo. O UUID do D1 é infraestrutura versionada, não segredo.

## Origem pública única

O backend possui uma única origem pública configurável:

- `VITE_API_BASE_URL`

O mesmo Worker atende:

- `/api/*` — catálogo, busca, galeria e formulários;
- `/media/*` — objetos do bucket R2 privado pelo binding `MEDIA`.

Não existe `VITE_MEDIA_BASE_URL` como configuração de produção. Não existe dependência pública de `r2.dev`. O build do Pages falha se detectar `r2.dev` no artefato gerado.

A entrypoint `worker/entry.ts` intercepta `/media/*` antes do handler da API. Por isso uma leitura de mídia não consulta D1. O gateway preserva metadata HTTP, ETag e Range, rejeita traversal/chaves inválidas e usa cache público explícito.

## GitHub

### Repository Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_API_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

### Repository Secrets

- `CLOUDFLARE_API_TOKEN`
- `TURNSTILE_SECRET_KEY`

O workflow deriva `CLOUDFLARE_D1_DATABASE_ID` do `wrangler.jsonc` somente para o processo em execução. Manutenções que precisam de `CATALOG_MEDIA_URL` derivam o valor de `CATALOG_API_URL`; não existe segunda fonte de verdade.

## Token Cloudflare

O token de CI deve ser dedicado ao Catálogo, restrito à conta Tonecos e usar o menor privilégio suportado:

- Workers Editor no Worker `tonecos-catalogo-api`;
- D1 Edit;
- Workers R2 Storage Read.

Não conceder Workers Admin, Workers Routes Write, R2 Write, Billing ou administração de API Tokens apenas por conveniência.

## CORS

As origens de produção ficam no `wrangler.jsonc`:

- `https://washingtonmsdj.github.io`
- `https://acheguese.com.br`
- `https://www.acheguese.com.br`

`localhost` e `127.0.0.1` não pertencem ao SSOT de produção.

## Gate de drift remoto

Antes de qualquer write no Worker, `tools/check_remote_worker_config.mjs` compara o remoto com o SSOT versionado, incluindo compatibility, observability, bindings, CORS, D1, R2 e secret binding. Divergência falha fechado antes do upload.

O CI de PR continua executando dry-run estrito do Wrangler com segredo sintético. O deploy remoto usa o gate semântico porque metadados locais de bindings não são equivalentes ao payload persistido pela API Cloudflare.

## Fluxo de produção

`Deploy Cloudflare API` é fail-closed. A ordem é obrigatória:

1. validar Account ID, token, Turnstile e `VITE_API_BASE_URL`;
2. typecheck do Worker;
3. derivar D1 ID e renderizar a configuração de deploy;
4. validar drift remoto;
5. capturar o Version ID que serve 100% do tráfego;
6. validar o bucket R2 read-only;
7. para deploy sem mudança de schema, verificar `/api/health` do Worker ativo usando o mesmo cliente de health do smoke staged;
8. em mudanças de esquema, consultar primeiro o orçamento D1 da conta por GraphQL Analytics, sem consulta SQL, bloqueando se faltar métrica confiável ou reserva suficiente;
9. somente após esse controle, validar as estruturas canônicas do D1 antes de criar versão staged; deploys só de código usam a verificação do Worker ativo;
10. criar uma versão staged sem tráfego, com código e segredo juntos;
11. validar a política migration-first;
12. aplicar migrações D1 apenas quando o diff exigir;
13. em mudanças de esquema, revalidar o orçamento e comprovar migrações + estruturas por metadados SQL, em modo schema-only, sem fazer a auditoria integral dos dados;
14. registrar `previous@100% + staged@0%`;
15. executar smoke completo da versão staged por Version Override;
16. promover `staged@100%`;
17. confirmar que o plano de controle aponta para a versão promovida e o contrato público convergiu;
18. provar objeto real em `/media/<storage-key>` pela mesma origem do Worker;
19. validar navegação real `categoria → franquia → pasta → modelo → detalhe`, com até 12 GETs;
20. provar `Workers Cache` com HIT real;
21. em caso de falha pós-stage, executar rollback para `PREVIOUS_WORKER_VERSION_ID`.

A auditoria integral foi retirada de **todos os workflows de produção**, inclusive deploy e manutenção manual. Uma única consulta SQL sem limite comprovado pode esgotar a franquia D1 mesmo quando a conta começa o dia com zero leituras. O CLI de auditoria também bloqueia o modo implícito: apenas `--schema-only` e `--preflight-schema-readability` são usados em fluxos de produção. O deploy continua validando migrações e estruturas canônicas, sem varrer modelos e galerias integralmente. As métricas do pico anterior apontaram mais de 3,5 milhões de linhas lidas em 158 consultas, sem atribuição exata por SQL.

`workflow_dispatch` de deploy é tratado conservadoramente como operação com schema (executa validações correspondentes); preferir o fluxo por push canônico quando o objetivo for apenas atualizar o Worker. Nunca reexecutar a auditoria integral para contornar bloqueio de cota.

A verificação de orçamento é **falha fechada**: sem métricas confiáveis ou quando a conta já consumiu mais de 250 mil linhas no dia UTC, releases com alteração de esquema não fazem sequer a sonda estrutural do D1. O controle é repetido após as migrações, antes da validação de metadados, mas não garante limite transacional de leituras SQL. Se a segunda checagem bloquear após migração já aplicada, a versão não é promovida; reconciliar manualmente sem repetir a migração. O custo individual das auditorias manuais continua não comprovado, mesmo com a reserva inicial disponível.

O workflow manual `Maintain Catalog Data` agora expõe apenas `verify-public-hierarchy` (navegação pública limitada) e `verify-d1-schema` (orçamento GraphQL, health ativo e duas consultas de metadados do esquema). Auditoria integral, backfill e reparos foram **retirados do workflow de produção** até existir paginação com limite de custo comprovado por operação. O código original das operações permanece preservado para revisão offline, sem criar cópias ou paliativos. Uma confirmação simples não autoriza varreduras integrais.

Upload, migrations, deployment, promoção e rollback não são repetidos automaticamente. Retry bounded existe apenas para verificações read-only.

## Contrato de release

`tools/worker_release_smoke.mjs` valida o pacote de API:

- `/api/health` + schema contract;
- `/api/categories`;
- `/api/recent`;
- `/api/catalog` + galeria;
- shared collections.

`tools/verify_public_catalog.py` valida o contrato público API + mídia. Em produção a mídia usa a própria `api-base`; `--media-base` existe apenas como override diagnóstico/teste isolado.

Smoke rápido:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker>
```

Auditoria completa:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --exhaustive --all-galleries
```

### Gate real de hierarquia (R32)

`tools/check_public_catalog_hierarchy.mjs` reutiliza `verifyWorkerHealth` e só consulta os endpoints públicos quando a integridade do esquema for comprovada. São, no máximo, **12 GETs por execução**, incluindo o health; não há leitura direta via API administrativa D1, escrita de dados, inventário fictício ou tentativas automáticas em loop.

O workflow de publicação executa o gate **após** a promoção e a validação da mídia e **antes** do gate de cache. Qualquer falha mantém o deploy reprovado e aciona o rollback existente. Na manutenção, a opção manual `verify-public-hierarchy` executa a mesma prova apenas após o health obrigatório, sem aplicar migrações nem alterações de dados. Quando a quota estiver esgotada, ambos falham fechado; **não executar repetidamente** esperando que o limite seja contornado.

A inclusão do gate apenas nos arquivos de orquestração e documentação não deve acionar um deploy do Worker por si só. Não executar `workflow_dispatch` de deploy enquanto a API estiver em 503.

## Workers Cache

O gate de cache exige `CF-Cache-Status: HIT` real. Como uma nova Worker Version começa com cache frio, o verificador aceita somente `MISS` transitório em uma janela limitada; `BYPASS`, `DYNAMIC`, ausência do header ou erro HTTP falham imediatamente. Isso evita tanto falso rollback quanto falso verde.

## R2 e conteúdo

O R2 é storage canônico, não endpoint público. O deploy da API só precisa de leitura do bucket. Publicação/mutação de mídia pertence ao pipeline de dados e não é motivo para conceder R2 Write ao token do Worker deploy.

O endpoint `/media/*` aceita apenas chaves sob o prefixo `media/`; traversal, segmentos vazios, backslashes, NUL e chaves excessivas são rejeitados. As respostas preservam `Content-Type`/metadata, ETag e Range e incluem cache explícito.

Depois que o gateway está validado em produção, a Public Development URL `r2.dev` deve permanecer desabilitada. Reativá-la recria uma segunda origem pública e viola o contrato arquitetural.

## Frontend e proxy público

- `/tonecosstudios/*` → origem do frontend do Catálogo;
- `/catalogo-api/*` → Worker do Catálogo na Tonecos;
- no domínio Achegue-se a API é first-party;
- no GitHub Pages o preview usa `VITE_API_BASE_URL` diretamente;
- mídia segue a mesma origem lógica do backend, nunca um endpoint R2 paralelo.

O frontend recebe somente valores públicos. O Turnstile secret nunca vai para o navegador.

## Segurança

- Segredos ficam somente em GitHub Secrets/Cloudflare.
- Nunca colocar token Cloudflare, Turnstile secret ou credencial em Git, chat, `.env.example` ou `wrangler.jsonc`.
- Não criar fallback de autenticação.
- Não enfraquecer gates para fazer deploy passar.
- Divergência entre dashboard e SSOT deve ser reconciliada conscientemente.
- Não reintroduzir `VITE_MEDIA_BASE_URL`, `r2.dev` ou custom domain R2 como segunda origem de mídia sem uma decisão arquitetural explícita.

## Quota D1 — diagnóstico R26b

Em 18/10/2026, a API D1 devolveu erro Cloudflare `7500`: limite diário de leituras de linhas do plano gratuito excedido. O antigo `schema_not_ready` mascarava a exceção como se nenhuma migração existisse, mesmo com 21 migrações e 55 estruturas previamente verificadas. A indisponibilidade de consulta **não equivale à ausência de schema**.

Para mudanças de esquema, o preflight passou a executar `python tools/audit_d1_integrity.py --preflight-schema-readability`, que reutiliza **as mesmas consultas SSOT** de migrações e estruturas da auditoria D1. A antiga sondagem de uma linha era insuficiente: passou enquanto a validação completa no Worker recebeu quota 7500. O preflight de metadados vem após a verificação GraphQL de orçamento e impede upload quando a API D1 recusa essas consultas; porém **o endpoint administrativo do D1 pode aceitar a auditoria quando o binding D1 do Worker ainda retorna 7500**. Para deploy sem mudança de schema, agora também é obrigatório health real do Worker ativo antes do upload; retorna só um código seguro, sem headers ou dados pessoais. Em mudanças de schema, aceita migrações ainda pendentes porque serão aplicadas pelo gate migration-first. O smoke staged completo continua obrigatório; leituras podem se esgotar depois do preflight. Não há bypass de quota, rollback ou auditoria.

O health do Worker diferencia `d1_daily_read_quota_exceeded` de `schema_query_unavailable` e de ausências realmente verificadas; não divulga mensagens de erro SQL nem dados privados.

### Distinção API de administração x binding do Worker — R26d

A auditoria estrutural canônica via endpoint administrativo D1 passou em 18/10/2026, enquanto a versão staged seguia retornando `d1_daily_read_quota_exceeded` no binding do Worker. Por isso, em deploy **sem alteração de schema**, o fluxo também executa `node tools/check_worker_health.mjs "$CATALOG_API_URL"` no Worker **atualmente ativo**, antes do upload. Falha de disponibilidade nessa leitura bloqueia a tentativa sem criar Worker version. Essa prova também não garante que uma versão staged nova terá quota suficiente; o smoke staged e rollback continuam incondicionais. Em deploy com migração, a validação do novo schema só se torna possível após aplicar as migrações e continua protegida por staging.
