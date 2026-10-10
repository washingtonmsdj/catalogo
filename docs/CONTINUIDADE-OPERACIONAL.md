# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-10**. O objetivo é registrar o estado operacional medido, evitar reprocessamento e impedir decisões divergentes. Documentação conceitual pertence aos arquivos específicos em `docs/`; este arquivo é um checkpoint, não um histórico acumulativo.

## Autoridade e estado atual

- Repositório: `washingtonmsdj/catalogo`.
- Branch autoritativa de produção: `main`.
- Cutover Cloudflare para **Tonecos Studio** concluído; a infraestrutura Washington permanece apenas como rollback.
- A PR **#144** foi mergeada e o gate externo do token foi encerrado; a issue **#103** está fechada como concluída.
- O deploy canônico validado em produção é **Deploy Cloudflare API #109**, com staged smoke, promoção 100%, auditoria D1 e rollback não acionado.
- As PRs **#150** e **#151** separaram manutenção de dados do deploy e eliminaram o auto-trigger de deploy por mudanças apenas de orquestração.
- `main` no checkpoint desta reconciliação: `08d3f523868c257e267745a06a3a864405b35b79`.
- A PR **#152** está aberta apenas para atualizar o Wrangler/toolchain; não deve ser mergeada enquanto a cota diária de leitura do D1 Free estiver saturada, porque `package.json` é gatilho intencional de deploy.

Sempre conferir `main`, workflows e estado Cloudflare antes de executar. Se este arquivo divergir do estado medido no repositório/produção, corrigir este SSOT no mesmo trabalho; não criar documento paralelo.

## Superfície pública

- URL pública canônica: `https://acheguese.com.br/tonecosstudios/`.
- Origem/preview independente: `https://washingtonmsdj.github.io/catalogo/`.
- `washingtonmsdj/acheguese` continua dono do domínio `acheguese.com.br`.
- `washingtonmsdj/catalogo` continua dono do frontend e pipeline do Catálogo.
- `/catalogo` é rota legada e redireciona para `/tonecosstudios/`.
- `/tonecosstudios/*` é encaminhado para a origem GitHub Pages do Catálogo.
- `/catalogo-api/*` é encaminhado para o Worker do Catálogo.
- no domínio Achegue-se, o frontend usa a API first-party `/catalogo-api`;
- no GitHub Pages, o preview usa `VITE_API_BASE_URL`.
- `config/public-runtime.json` é o SSOT versionado da URL pública canônica.

A superfície pública temporária do Achegue-se pode redirecionar páginas de visitante para `/tonecosstudios/`; o aplicativo Achegue-se permanece separado e não deve ser copiado para este repositório.

## Cloudflare — recursos canônicos Tonecos

Conta **Tonecos Studio**:

- Account ID: `8827c547d6def5ee5b9ca550fdd5680a`;
- Worker: `tonecos-catalogo-api`;
- API: `https://tonecos-catalogo-api.tonecosstudio.workers.dev`;
- D1: `tonecos-catalogo` (`87006366-60f3-4937-af73-2ef5a5f901fb`);
- R2: `tonecos-catalogo-media`;
- mídia pública: `https://pub-bc7ed3247d8d4391946761221e77e6b9.r2.dev`;
- Turnstile sitekey: `0x4AAAAAAFSpOhaAFp6Gsjqd`.

O cutover público para Tonecos Studio já foi concluído e validado. Workers/Workflows temporários de migração foram removidos. A infraestrutura antiga da conta Washington continua preservada apenas como rollback e **não deve ser apagada** até o encerramento formal dessa janela.

Não mover zona/DNS comercial nem criar domínio alternativo hardcoded apenas para substituir `workers.dev`/`r2.dev`. Domínio customizado é mudança independente, com DNS e rollback próprios.

## Baseline público atual

Baseline medido após a consolidação revisada das galerias legadas:

- **2.564 modelos publicados**;
- **2.596 imagens públicas** preservadas nas galerias lógicas;
- **21 galerias canônicas consolidadas**, agregando logicamente 53 imagens/fichas físicas revisadas;
- **32 fichas-fonte aposentadas** por relação canônico→fonte, sem DELETE;
- os **2.564 rows publicados** continuam com `image_count=1` físico; nos 21 canônicos revisados, a API compõe a galeria pública a partir do canônico + fontes relacionadas;
- 6 categorias;
- 250 franquias;
- 1.063 pastas;
- `model_image_sources`: **2.596/2.596** modelos indexados por SHA;
- 0 grupos de SHA compartilhado entre modelos;
- 0 fontes duplicadas em relações de galeria;
- 0 autorrelações;
- 0 canônicos aposentados;
- 0 fontes relacionadas ainda publicadas;
- `models_fts`: **2.596 rows físicos**; a busca pública continua filtrando `published=1`, portanto fontes aposentadas não reaparecem como cards;
- `franchises_fts`: 250/250.

Os 32 modelos aposentados continuam no D1 como fontes históricas/aliases e sua mídia continua no R2. Não interpretar a redução 2.596→2.564 como exclusão de produto ou perda de imagem.

Não substituir esses números por expectativa de branch. Eles só mudam depois de mutação real + auditoria.

## Gate operacional temporário

O gate externo de credencial foi **fechado**:

- `CLOUDFLARE_API_TOKEN` está configurado como GitHub Actions Secret e foi provado pelo pipeline real contra Worker, D1 e R2;
- `TURNSTILE_SECRET_KEY` permanece segredo obrigatório e não é exposto pelo repositório;
- `CLOUDFLARE_ACCOUNT_ID` aponta para Tonecos Studio;
- o UUID D1 pertence ao `wrangler.jsonc` e não é Repository Variable concorrente.

O bloqueio operacional temporário deste checkpoint é outro: a conta D1 Free esgotou o limite diário de **row reads** durante backfill/auditorias. Isso pode fazer endpoints públicos retornarem `D1_ERROR` até o reset de cota e **não deve ser tratado como falha de schema, Worker ou reparo de galeria**.

Enquanto a cota estiver saturada:

- não repetir deploy, migration, backfill ou reparo apenas para obter um run verde;
- não criar cache/bypass/gambiarra para esconder o limite;
- não reaplicar as 32 relações de galeria;
- após o reset, usar somente a operação read-only `verify-legacy-gallery-repairs` do workflow `Maintain Catalog Data` para fechar o smoke público pendente.

## SSOT de deploy Cloudflare

`wrangler.jsonc` é a autoridade versionada para:

- nome do Worker;
- binding D1 `DB` e UUID do banco Tonecos;
- bucket R2 `MEDIA`;
- `CORS_ORIGINS`;
- `preview_urls`;
- contrato de segredo obrigatório.

`tools/render_wrangler_config.mjs` não substitui silenciosamente o D1. Se `CLOUDFLARE_D1_DATABASE_ID` for fornecido em contexto manual, funciona somente como asserção e divergência falha fechado.

O fluxo canônico de `.github/workflows/cloudflare.yml` é:

1. preflight fail-closed de credenciais/configuração;
2. capturar a versão que está efetivamente servindo 100% antes de qualquer write;
3. validar R2;
4. enviar código + `TURNSTILE_SECRET_KEY` juntos com `wrangler versions upload --strict --secrets-file`, sem tráfego;
5. extrair o Version ID staged do NDJSON oficial do Wrangler;
6. validar `config/migration-deploy-policy.json`;
7. aplicar somente migrations expand/backward-compatible ainda pendentes;
8. criar deployment **versão anterior 100% / versão staged 0%**;
9. executar staged smoke com `Cloudflare-Workers-Version-Overrides`;
10. retry do staged smoke é bounded: 5 tentativas, 2 s, somente leitura; nenhuma mutação é repetida;
11. promover staged para 100% somente após smoke verde;
12. repetir gates públicos sem override;
13. falha depois do deployment 100/0 ou após promoção restaura explicitamente `PREVIOUS_WORKER_VERSION_ID`;
14. a auditoria estrutural pós-release fecha o deploy; manutenção de dados pertence exclusivamente a `.github/workflows/catalog-maintenance.yml`.

`wrangler secret put` é proibido nesse pipeline porque cria uma nova versão e a implanta imediatamente. O segredo é materializado apenas em arquivo efêmero `0600` dentro de `$RUNNER_TEMP`, removido por `trap`.

O CI de PR usa `wrangler versions upload --dry-run --strict --secrets-file` com segredo sintético temporário, exercitando o mesmo binding sem consumir segredo real.

Runbook detalhado: `docs/CLOUDFLARE_DEPLOY.md`.

## Migrations e schema

Produção medida está aplicada até:

- `0001_catalog.sql` … **`0019_model_variant_name.sql`**.

`config/catalog-schema-contract.json` está em **version 3** e o health público validado exige 19 migrations e 30 estruturas físicas verificadas.

As migrations 0011–0019 já estão em produção:

- `0011_model_gallery_members.sql` — canônico → fontes de galeria;
- `0012_folder_materialized_counts.sql` — `direct_model_count`/`subtree_model_count`;
- `0013_model_image_sources.sql` — índice consultável de SHA por imagem/modelo/versão;
- `0014_gallery_member_integrity.sql` — bloqueia ciclos/cadeias/escopo incompatível;
- `0015_gallery_publication_invariant.sql` — aposenta fonte no mesmo statement e impede republicação acidental;
- `0016_public_gallery_revision.sql` — revisão pública monotônica da galeria;
- `0017_gallery_lifecycle_integrity.sql` — protege lifecycle de canônico/fonte;
- `0018_gallery_alias_immutability.sql` — protege identidade/alias enquanto a relação existe;
- `0019_model_variant_name.sql` — variante pública explícita do modelo.

`config/migration-deploy-policy.json` continua classificando migrations migration-first e bloqueando operações destrutivas. Novas migrations devem avançar pelo workflow de deploy canônico; não aplicar manualmente para contornar gate ou quota.

## Identidade: modelo não é imagem

Regra obrigatória:

- um produto/modelo 3D é a entidade principal;
- frente, costas, laterais, detalhes e outras vistas do mesmo produto pertencem à galeria do mesmo modelo;
- produtos diferentes do mesmo personagem continuam modelos distintos;
- nome do personagem, pasta ou franquia nunca bastam para unir produtos;
- `modelo_publico` explícito é a maior autoridade de identidade quando presente;
- novos lotes devem preservar um identificador estável de produto;
- redução/união automática por heurística é proibida.

O pipeline já protege:

- 1 identidade pública → 1 modelo com N imagens;
- produtos distintos continuam separados;
- troca de capa não muda ID/nome/slug;
- R2/D1 precisam concordar em `imageCount`, `galleryVersion`, manifest e variantes;
- expansão 1→3 imagens preserva identidade e mantém um único registro D1.

## Galerias legadas

A dívida revisada foi aplicada de forma não destrutiva:

- `config/catalog-legacy-gallery-overrides.json` continua sendo o registro canônico dos **21 grupos** revisados;
- eram 53 slugs/fichas físicas e 32 cards excedentes;
- foram criadas **32 relações** canônico→fonte;
- **21 canônicos** permanecem publicados;
- **32 fontes** foram aposentadas pelas invariantes do banco;
- **0 DELETEs** foram executados;
- o preflight SHA verificou 53/53 membros e encontrou 0 SHA duplicado dentro dos grupos;
- contadores materializados ficaram sem divergência após a aplicação.

`tools/apply_legacy_gallery_repairs.py` continua sendo o único caminho de write autorizado e é idempotente/fail-closed, mas **não deve ser reaplicado** para fechar o smoke deste checkpoint.

A manutenção agora é separada do deploy em `.github/workflows/catalog-maintenance.yml`, manual-only, com uma operação explícita por execução:

- `audit` — somente leitura;
- `backfill-image-sha` — backfill SHA controlado;
- `apply-legacy-gallery-repairs` — write explícito para grupos revisados;
- `verify-legacy-gallery-repairs` — verificação pós-reparo estritamente read-only.

O apply real concluiu; a única verificação pendente é repetir `verify-legacy-gallery-repairs` após o reset da cota D1. O run anterior falhou no endpoint de imagens exclusivamente por limite diário de row reads, confirmado pela observabilidade Cloudflare.

### Android 18

O bug de vistas separadas permanece protegido por regressão. A inferência conservadora só remove sufixos reconhecidos de vista e só agrupa quando 2+ imagens da mesma hierarquia resolvem para a mesma família. Qualificadores semânticos como `realista`, `chibi`, `diorama` etc. não são descartados.

No recorte auditado, 17 registros brutos representam 11 produtos reais. A compatibilidade de aliases permanece para URLs/IDs históricos; não recriar cards aposentados.

## Referências aposentadas continuam válidas

Consolidação é mudança de identidade pública, não exclusão destrutiva:

- slug antigo resolve para o canônico;
- endpoint de imagens do slug antigo abre a galeria canônica;
- IDs antigos de Favoritos/Minha lista/orçamento resolvem para o ID canônico;
- IDs equivalentes são deduplicados antes de criar orçamento/coleção;
- coleções antigas continuam válidas;
- fonte aposentada permanece no D1 e mídia permanece no R2;
- não reciclar ID, slug ou código de uma ficha-fonte aposentada.

`worker/modelAliases.ts` centraliza esse contrato.

## Irmãos numerados e cópias

Números no fim do slug são **evidência de revisão, não duplicata**.

Baseline auditado:

- 49 grupos-base;
- 114 irmãos numerados;
- 0 modelos publicados com marcador explícito de cópia e base correspondente;
- 0 grupos reutilizando o mesmo `image_id` entre fichas públicas diferentes.

`config/catalog-numbered-sibling-review.json` mantém a fila com estados `pending`, `distinct`, `mixed` ou `gallery`. Novo grupo numerado ou mudança silenciosa da lista bloqueia publicação até revisão consciente.

## Continuidade histórica de identidade

`config/catalog-model-identity-aliases.json` registra somente renomes aprovados. Não usar aliases para forçar agrupamentos duvidosos.

- ID técnico e `TS-*` derivam da identidade histórica canônica;
- `identityKey` preserva o canônico e `sourceIdentityKey` registra o snapshot atual;
- `media-build-state.json` mantém `identityHistory` por SHA e não poda histórico só porque um produto some temporariamente;
- reaparecimento do mesmo SHA sob outra identidade sem alias aprovado falha fechado;
- o preflight de produção repete a prova contra `model_image_sources`.

## Índice SHA no D1

`0013_model_image_sources.sql` materializa somente metadados de auditoria (`model_id`, `image_id`, posição, role, `source_sha256`, `gallery_version`). R2/manifest continuam sendo a fonte canônica da galeria.

O backfill inicial está **concluído**:

- escopo: 2.596 modelos físicos;
- indexados: **2.596/2.596**;
- pendentes: 0;
- colisões SHA exatas entre modelos: 0;
- binários baixados pelo backfill: 0;
- deletes destrutivos: 0.

`tools/backfill_image_source_index.py` continua:

- medindo cobertura por padrão;
- escrevendo somente com `--apply`;
- lendo apenas manifests JSON, nunca binários;
- validando model/version/count/capa/IDs/SHA;
- processando somente versões sem índice;
- exigindo cobertura total ao concluir.

Novos backfills devem ser disparados somente pela operação `backfill-image-sha` do workflow `Maintain Catalog Data`, quando houver nova versão de modelo sem índice. Não reconstruir SHA lendo binários locais e não rerodar o backfill concluído por rotina.

## Política de imagens

`tools/plan_gallery_merge.py` aplica política não destrutiva:

- SHA igual → não republicar a mesma imagem;
- vista nova → adicionar à galeria;
- similaridade perceptual → revisão, nunca exclusão automática;
- substituir uma vista exige decisão explícita de qualidade;
- arquivos mestres nunca são apagados;
- aumento de `imageCount` é permitido quando manifest/version mudam coerentemente;
- redução é bloqueada por padrão e exige aprovação CSV exata;
- um `galleryManifestKey` content-addressed nunca pode representar contagem/capa/versão divergentes.

“Modelo já existente” não significa “todas as imagens já existem”. Imagens secundárias da fonte externa ainda precisam de auditoria por produto.

## Checkpoint local — não refazer

O catálogo mestre operacional fica no Google Drive do desktop. Antes de qualquer mutação, confirmar o caminho real no dispositivo; não assumir equivalência entre unidade sincronizada e cópia local.

Checkpoint SHA preservado:

- SHA V4: **3.649 / 3.649**;
- `catalog_complete=true`;
- 0 caminhos duplicados no cache;
- 0 hashes inválidos;
- `Novos`: **56 imagens**;
- fila final: **40 promoção controlada + 16 quarentena privada**;
- nenhuma das 16 deve ser apagada.

O auditor local antigo incluiu material de referência/legado no escopo público e gerou **111 grupos falsos/ambíguos**. A fronteira pública correta agora é `config/public-catalog-roots.json`, carregada por `tools/catalog_scope.py`.

Categorias públicas canônicas:

1. Animes & Desenhos
2. Games
3. Filmes & Séries
4. Marvel & DC
5. Tokusatsu & Cultura Japonesa
6. Pessoas

Não reiniciar SHA V4 por conveniência. Corrigir o helper local para consumir o SSOT, migrar/revalidar o inventário existente e reutilizar hashes válidos. Reset total só com prova de que migração é impossível.

### Alterações locais já concluídas

Não refazer do zero:

- `catalogo-pastas-publicas.ps1` corrigido para `Resolve-PublicCatalogFile -AllowMissingDirectories` com pasta existente e folha ainda ausente;
- `testar-integridade-automacao.ps1` ganhou regressão correspondente;
- último preflight local registrado: **225 checks, 0 falhas críticas, 0 warnings**;
- `executar-consolidacao-novos.ps1` voltou a avançar em dry-run;
- 56 itens em `Novos`, todos com decisão preservada;
- seis destinos com mojibake já possuem caminho físico Unicode correto; não criar árvores duplicadas.

Artefatos a localizar antes de criar alternativa:

- `auditar-sha-catalogo-novos.ps1`;
- `catalogo-pastas-publicas.ps1`;
- `testar-integridade-automacao.ps1`;
- `executar-consolidacao-novos.ps1`;
- `preparar-fila-revisao-novos-catalogo.ps1`;
- `verificar-portao-publicacao.ps1`;
- `planejar-correcao-catalogo-oficial.ps1`;
- `auditoria-sha-novos-catalogo-state.json`;
- `auditoria-sha-catalogo-cache.csv`;
- `auditoria-sha-novos-catalogo.csv`;
- `fila-revisao-novos-catalogo-resumo.json`;
- `portao-publicacao-resumo.json`.

O último acesso remoto observado continuava bloqueado pela cota mensal do Desktop Commander. Não reconectar/repetir em loop nem contornar por outro controlador do PC; usar o desktop apenas quando a ferramenta voltar a permitir operações.

## Fonte externa privada — checkpoint

O nome comercial da fonte não deve ser gravado no repositório público; o pipeline permanece neutro.

Inventário previamente confirmado:

- aproximadamente **12.105 imagens**;
- aproximadamente **1.514 produtos/slugs**;
- **428 imagens principais** já passaram pela consolidação inicial;
- classificação V2: **353 modelos já representados + 75 não duplicados**;
- dentro dos 75, **40 de alta confiança** já foram colocados em `Novos`;
- esses 40 já constam por SHA em `Novos`; não copiá-los novamente.

Os 353 “já representados” foram deduplicados em nível de modelo, não em nível de galeria. Imagens secundárias ainda precisam ser auditadas para aproveitar vistas e qualidade.

## Próxima sequência de conteúdo

Depois de fechar o gate de infraestrutura #144, retomar conteúdo nesta ordem:

1. corrigir o escopo público do auditor local usando `config/public-catalog-roots.json`;
2. migrar/revalidar o checkpoint SHA reaproveitando cache;
3. revalidar os 40 de promoção e 16 de quarentena;
4. auditar a fonte externa **por produto**, com mapa explícito `incoming_model,target_model`;
5. usar `tools/plan_gallery_merge.py --mapping` e `tools/resolve_gallery_merge.py`;
6. gerar `gallery-promotions.csv` com `tools/build_gallery_promotion_manifest.py`;
7. validar com `tools/verify_gallery_promotion_manifest.py`; só `ready=true` libera cópia;
8. preservar STL/GLB/3MF/OBJ/fontes e nunca apagar mestre antigo por substituição de vista;
9. gerar bundle/mídia, executar `publish_d1.py --check-production` antes do R2, publicar delta R2 e só então `publish_d1.py --apply`;
10. validar produção com `verify_public_catalog.py --exhaustive --all-galleries`;
11. atualizar este checkpoint uma única vez com os totais realmente medidos.

## O que não fazer

- não recomeçar o catálogo do zero;
- não reprocessar pastas/imagens concluídas sem motivo técnico;
- não reiniciar SHA V4 por conveniência;
- não copiar toda a fonte privada indiscriminadamente;
- não interpretar “modelo duplicado” como “todas as imagens duplicadas”;
- não juntar produtos diferentes só por personagem/pasta/nome;
- não criar árvores paralelas por prefixo `OK -`, sufixo `[N]` ou mojibake;
- não deletar STL/GLB/3MF/OBJ/fontes;
- não tocar em fotos pessoais ou processos de outros projetos;
- não criar fallback Cloudflare, hardcode de credencial ou segredo no Git.

## Arquivos técnicos centrais

- `wrangler.jsonc` — SSOT Worker/D1/R2/CORS;
- `config/catalog-schema-contract.json` — contrato de schema exigido pelo Worker;
- `config/migration-deploy-policy.json` — política migration-first;
- `docs/CLOUDFLARE_DEPLOY.md` — runbook de deploy;
- `config/public-catalog-roots.json` — raízes públicas canônicas;
- `tools/catalog_scope.py` — carregamento/validação do escopo;
- `tools/ingest_catalog.py` — ingestão auditada;
- `tools/build_media_bundle.py` — variantes/manifest/identidade;
- `tools/publish_r2.py` — upload incremental de mídia;
- `tools/publish_d1.py` — preflight + upsert idempotente;
- `tools/audit_d1_integrity.py` — auditoria estrutural;
- `tools/verify_public_catalog.py` — gate público;
- `tools/check_staged_worker_version.mjs` — smoke de versão 0% antes da promoção;
- `tools/cloudflare_deploy_state.mjs` — captura determinística de versões/deployments;
- `tools/apply_legacy_gallery_repairs.py` — reparos legados explícitos;
- `tools/backfill_image_source_index.py` — índice SHA;
- `config/catalog-legacy-gallery-overrides.json` — grupos legados revisados;
- `config/catalog-numbered-sibling-review.json` — fila de irmãos numerados;
- `config/catalog-model-identity-aliases.json` — renomes aprovados;
- este arquivo — checkpoint operacional.

## Regra para futuras sessões

Antes de trabalhar:

1. ler este arquivo;
2. conferir `main`, PRs abertas e CI atual;
3. medir produção/local antes de assumir que os totais ainda são os mesmos;
4. continuar do próximo gate pendente;
5. atualizar este checkpoint somente após mudança operacional relevante.

Sem gambiarras, sem paliativos, sem duplicação de SSOT e sem manter instrução obsoleta “por segurança”. O estado medido e os contratos versionados prevalecem.