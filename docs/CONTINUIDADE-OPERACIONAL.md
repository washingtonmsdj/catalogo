# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-10**. O objetivo é registrar o estado operacional medido, evitar reprocessamento e impedir decisões divergentes. Documentação conceitual pertence aos arquivos específicos em `docs/`; este arquivo é um checkpoint, não um histórico acumulativo.

## Autoridade e estado atual

- Repositório: `washingtonmsdj/catalogo`.
- Branch autoritativa de produção: `main`.
- PR de fechamento do CI/CD Cloudflare: **#144 — `infra/tonecos-d1-binding-ci`**.
- #144 permanece **draft, aberta e mergeável** enquanto `CLOUDFLARE_API_TOKEN` não estiver configurado com segurança no GitHub Actions.
- Último gate de código totalmente verde antes desta reconciliação documental: **CI #948**, commit `6a5ce5667efd4aff2e2e4ab69711801660f77470`.
- Não marcar #144 ready nem mergear enquanto o token de CI não existir e o novo head não estiver verde.
- Produção pública Tonecos permanece intacta enquanto a PR está em draft.

Sempre conferir `main`, a cabeça da #144 e os workflows atuais antes de executar. Se este arquivo divergir do estado medido no repositório/produção, corrigir este SSOT no mesmo trabalho; não criar documento paralelo.

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

Último baseline medido antes da promoção das novas migrations:

- **2.596 modelos publicados**;
- **2.596 imagens publicadas nas fichas**;
- todos os modelos públicos ainda possuem exatamente **1 imagem**;
- 6 categorias;
- 250 franquias;
- 1.063 pastas;
- 0 modelos sem capa;
- 0 modelos sem galeria;
- 0 modelos sem imagem;
- 0 slugs duplicados;
- 0 códigos duplicados;
- `models_fts`: 2.596/2.596;
- `franchises_fts`: 250/250.

Não substituir esses números por expectativa de branch. Eles só mudam depois de mutação real + auditoria pública.

## Gate externo ainda aberto

O deploy automático do backend continua fail-closed porque falta o GitHub Actions Secret:

- `CLOUDFLARE_API_TOKEN`.

Já existem/configuram-se separadamente `CLOUDFLARE_ACCOUNT_ID`, `TURNSTILE_SECRET_KEY`, URLs públicas e o binding D1 canônico. O UUID do D1 **não é segredo** e agora pertence exclusivamente ao `wrangler.jsonc`; `CLOUDFLARE_D1_DATABASE_ID` não é Repository Variable de produção.

As conexões OAuth Cloudflare disponíveis não criam o token de CI e o conector GitHub não expõe escrita de Actions Secrets. Portanto:

- não colocar token em chat, commit, comentário, `.env.example`, arquivo temporário do projeto ou `wrangler.jsonc`;
- não criar fallback de autenticação;
- não ampliar permissões por conveniência;
- quando o token existir, restringi-lo à conta Tonecos e ao menor privilégio suportado para Worker/D1/R2.

A produção atual continua saudável e independente desse gate. O que está bloqueado é **novo deploy automático do Worker**.

## SSOT de deploy Cloudflare

`wrangler.jsonc` é a autoridade versionada para:

- nome do Worker;
- binding D1 `DB` e UUID do banco Tonecos;
- bucket R2 `MEDIA`;
- `CORS_ORIGINS`;
- `preview_urls`;
- contrato de segredo obrigatório.

`tools/render_wrangler_config.mjs` não substitui silenciosamente o D1. Se `CLOUDFLARE_D1_DATABASE_ID` for fornecido em contexto manual, funciona somente como asserção e divergência falha fechado.

O fluxo da #144 é:

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
14. auditorias/manutenções opcionais só rodam depois do deployment público saudável.

`wrangler secret put` é proibido nesse pipeline porque cria uma nova versão e a implanta imediatamente. O segredo é materializado apenas em arquivo efêmero `0600` dentro de `$RUNNER_TEMP`, removido por `trap`.

O CI de PR usa `wrangler versions upload --dry-run --strict --secrets-file` com segredo sintético temporário, exercitando o mesmo binding sem consumir segredo real.

Runbook detalhado: `docs/CLOUDFLARE_DEPLOY.md`.

## Migrations e schema

Produção medida continua aplicada somente até:

- `0001_catalog.sql` … `0010_recent_models_index.sql`.

`config/catalog-schema-contract.json` está em **version 3** e exige até:

- `0011_model_gallery_members.sql` — canônico → fontes de galeria;
- `0012_folder_materialized_counts.sql` — `direct_model_count`/`subtree_model_count`;
- `0013_model_image_sources.sql` — índice consultável de SHA por imagem/modelo/versão;
- `0014_gallery_member_integrity.sql` — bloqueia ciclos/cadeias/escopo incompatível;
- `0015_gallery_publication_invariant.sql` — aposenta fonte no mesmo statement e impede republicação acidental;
- `0016_public_gallery_revision.sql` — revisão pública monotônica da galeria;
- `0017_gallery_lifecycle_integrity.sql` — protege lifecycle de canônico/fonte;
- `0018_gallery_alias_immutability.sql` — protege identidade/alias enquanto a relação existe;
- `0019_model_variant_name.sql` — variante pública explícita do modelo.

`config/migration-deploy-policy.json` classifica as migrations posteriores ao baseline usadas por este rollout como **expand/backward-compatible**. `tools/check_migration_deploy_policy.py` exige cobertura exata e bloqueia padrões destrutivos no fluxo migration-first.

Não aplicar 0011–0019 manualmente apenas para contornar a credencial ausente. A tabela `d1_migrations`, o Worker correspondente e o contrato de health devem avançar pelo mesmo workflow.

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

A dívida legada medida continua explícita, não heurística:

- auditoria conservadora encontrou grupos de vistas fragmentadas;
- `config/catalog-legacy-gallery-overrides.json` é o registro canônico dos grupos revisados;
- baseline registrado: **21 galerias legadas, 53 slugs e 32 cards excedentes**;
- sobreposição de slugs, canônico fora dos membros, motivo vazio ou resumo divergente bloqueiam o gate;
- casos novos só entram depois de auditoria visual/identidade conclusiva.

Para os grupos já revisados, `tools/apply_legacy_gallery_repairs.py` é o caminho autorizado. Ele insere relações canônico→fonte; as invariantes do banco aposentam a fonte sem DELETE.

Aplicar reparos exige `workflow_dispatch` com `apply_legacy_gallery_repairs=true`; o padrão é **false**. A operação é idempotente e só deve ocorrer depois das migrations necessárias, health verde e preflight completo.

### Android 18

O bug de vistas separadas foi reproduzido e protegido por regressão. A inferência conservadora só remove sufixos reconhecidos de vista e só agrupa quando 2+ imagens da mesma hierarquia resolvem para a mesma família. Qualificadores semânticos como `realista`, `chibi`, `diorama` etc. não são descartados.

No recorte auditado, 17 registros brutos representam 11 produtos reais. A camada de compatibilidade frontend é transitória e deve deixar de ser necessária quando o backend canônico estiver publicado.

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

`tools/backfill_image_source_index.py`:

- mede cobertura por padrão;
- só escreve com `--apply`;
- baixa apenas manifests JSON, nunca binários;
- pagina sem `OFFSET`;
- valida model/version/count/capa/IDs/SHA;
- processa apenas versões sem índice;
- exige cobertura total do escopo público ao concluir.

O backfill real exige `workflow_dispatch.backfill_image_source_index=true`; padrão **false**. Não reconstruir SHA lendo binários locais para preencher essa tabela.

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