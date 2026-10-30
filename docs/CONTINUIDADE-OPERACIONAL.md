# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-29**. Este arquivo registra somente o estado operacional necessário para a próxima execução. Histórico detalhado pertence aos runbooks e documentos de migração; não acumular aqui gates encerrados, PRs antigas ou bloqueios expirados.

## Autoridade

- Repositório: `washingtonmsdj/catalogo`.
- Branch autoritativa: `main`.
- Antes de qualquer mutação, conferir novamente `main`, PRs/issues abertas, CI, Pages e estado Cloudflare.
- Nunca tratar SHA antigo gravado em documentação como autoridade de execução.
- `wrangler.jsonc` é o SSOT do Worker, D1, R2, CORS e segredo obrigatório.
- `config/public-runtime.json` é o SSOT versionado da superfície pública.
- O resolvedor de runtime do frontend deve continuar explícito/fail-closed; não recriar fallback implícito nem segunda origem paralela.
- Mudança de runtime só é concluída quando os gates do escopo realmente afetado ficam verdes.

## Estado reconciliado — integração de 2026-10-29

- **`main` observada:** `581341faa23174adb0c4eedf5628adf366a84c0f`. O contrato de schema da `main` exige a migration `0021_quote_admin_audit_events.sql` (versão 5). Esse é o estado do Git, não prova de migrations aplicadas no D1 de produção.
- **PR #174** (draft, base de ingestão externa): `138f3e045dae531eb71dd20fcbb894ecdca500b5`, base atualizada com os 94 commits que faltavam da `main`. A auditoria de dependências encontrou Wrangler anterior vulnerável; versão 4.155.0 e lockfile idêntico ao já homologado na frente #175 foram incorporados. Gates dessa nova revisão precisam ser consultados.
- **PR #175** (draft, `catalog-content-20261015`, base #174): a integração de `main` e #174 em `e972d6086843bcdb0bf71b411066283df256ae21` passou **13/13 workflows**. O presente checkpoint atualiza a continuidade e incorpora a correção de dependências da #174; validar o novo HEAD em vez de reutilizar o resultado anterior.
- Na reconciliação via árvores Git completas, a #174 não possuía arquivos conflitantes com a `main`; a #175 tinha apenas `package.json` e `.github/workflows/ci.yml` sobrepostos. Foram preservados tanto os testes de ingestão quanto os testes de administração, navegação e auditoria do CI principal, sem force-push.
- **Não houve merge das PRs em `main`, deploy nem alteração de registros D1/R2.** Ambas devem permanecer draft até os gates finais e autorização de publicação correspondentes.
- **Conteúdo:** a auditoria de cobertura da fonte externa e a fila de colisões trabalham em modo somente leitura, com identidade aprovada separada da elegibilidade de mídia. A cobertura integral de esculturas únicas não está comprovada.

O registro do Worker promovido na PR #161 e os respectivos smokes históricos continuam como **evidência conhecida boa, não substituto de medição atual**. Para decidir um deploy, medir novamente Worker, D1, R2 e estado dos workflows; não tomar IDs ou números deste checkpoint como estado vivo.

## Superfície pública

- URL pública canônica: `https://acheguese.com.br/tonecosstudios/`.
- Preview independente: `https://washingtonmsdj.github.io/catalogo/`.
- `/tonecosstudios/*` é a superfície pública do Catálogo dentro do Achegue-se.
- `/catalogo-api/*` é o boundary first-party usado no domínio Achegue-se.
- No GitHub Pages, o runtime explícito resolve a API a partir da configuração canônica.
- `/catalogo` permanece apenas como compatibilidade de rota para `/tonecosstudios/`.

O Catálogo não deve copiar o aplicativo Achegue-se nem assumir propriedade de `acheguese.com.br`.

## Cloudflare — recursos canônicos Tonecos Studio

- Account ID: `8827c547d6def5ee5b9ca550fdd5680a`.
- Worker: `tonecos-catalogo-api`.
- API: `https://tonecos-catalogo-api.tonecosstudio.workers.dev`.
- D1: `tonecos-catalogo` (`87006366-60f3-4937-af73-2ef5a5f901fb`).
- R2: `tonecos-catalogo-media`.
- Turnstile sitekey pública: `0x4AAAAAAFSpOhaAFp6Gsjqd`.
- `TURNSTILE_SECRET_KEY` é segredo obrigatório e não pertence ao Git.

A infraestrutura antiga da conta Washington é somente rollback histórico. Não mover DNS, zona ou recursos de outra conta para facilitar o Catálogo.

## Mídia — arquitetura atual obrigatória

A mídia **não possui origem pública separada**.

- O bucket `tonecos-catalogo-media` permanece privado.
- O Public Development URL do R2 deve permanecer **desabilitado**.
- Não existe variável pública separada para origem de mídia.
- O frontend monta mídia a partir do mesmo `apiBase` usado pela API.
- O Worker serve objetos por `/media/*` usando o binding privado `MEDIA`.
- `worker/entry.ts` resolve `/media/*` antes do handler principal da API; leitura de mídia não depende de D1.
- O gateway preserva metadata HTTP, ETag e Range, rejeita traversal/chaves inválidas e usa cache público explícito.

O deploy Cloudflare valida o Worker remoto contra o SSOT e também consulta o estado managed do bucket. Se a exposição pública direta do R2 voltar a ser habilitada, o deploy falha **antes de qualquer write**.

O Pages também deve rejeitar artefato que contenha endpoint público direto de R2.

## Runtime do frontend — regra fail-closed

A PR #166 tornou o runtime explícito e centralizado. Preservar estas invariantes:

- um único contrato/resolvedor de runtime;
- modo de execução explícito;
- preview e superfície Achegue-se resolvidos pelo mesmo SSOT;
- orçamento e demais consumidores usam o runtime canônico, sem resolvedor próprio;
- configuração ausente/inválida falha fechado;
- não criar fallback silencioso para hostname, localhost ou Worker hardcoded;
- proxy Achegue-se precisa continuar alinhado ao contrato do runtime.

Qualquer nova superfície deve estender o contrato central; não duplicar lógica de detecção por `window.location`, hostname ou pathname espalhada pela aplicação.

## Deploy Cloudflare

Fluxo canônico de `.github/workflows/cloudflare.yml`:

1. preflight fail-closed;
2. detectar mudança real de schema D1;
3. validar credenciais/configuração;
4. renderizar configuração de produção;
5. validar Worker remoto e estado privado do R2 contra o SSOT;
6. capturar a versão atualmente servindo produção;
7. validar o bucket R2;
8. enviar nova versão do Worker sem tráfego;
9. registrar staged em 0%;
10. aplicar somente migrations compatíveis quando houver mudança de schema;
11. executar staged smoke com version override;
12. promover para 100% somente após staged verde;
13. validar release público;
14. validar objeto R2 real por `/media/*`;
15. exigir Workers Cache `HIT` dentro de janela bounded;
16. restaurar a versão anterior se smoke staged ou pós-promoção falhar;
17. executar auditoria D1 somente quando o escopo de schema exigir.

Mudança apenas de frontend/orquestração que não toca Worker/schema não deve consumir deploy D1/Worker por hábito.

Runbook detalhado: `docs/CLOUDFLARE_DEPLOY.md`.

## Schema e migrations

O contrato versionado atual da `main` exige migrações até `0021_quote_admin_audit_events.sql` (versão 5); o estado de aplicação no D1 de produção deve ser aferido na conta Tonecos, não inferido por Git, CI ou por este documento.

Regras:

- `config/catalog-schema-contract.json` define estruturas exigidas pelo Worker;
- migrations novas passam por `config/migration-deploy-policy.json`;
- nenhuma migration destrutiva é aplicada para destravar deploy;
- mudança runtime-only não deve provocar leitura/auditoria D1 desnecessária;
- manutenção de dados pertence a `.github/workflows/catalog-maintenance.yml`, não ao deploy comum.

## Identidade de produto e galeria

Regra principal: **modelo não é imagem**.

- frente, costas, laterais e detalhes do mesmo produto pertencem à mesma galeria;
- produtos diferentes do mesmo personagem continuam modelos diferentes;
- nome, pasta ou franquia não bastam para unir produtos;
- `modelo_publico` explícito tem maior autoridade quando presente;
- troca de capa não muda ID/nome/slug;
- R2, manifests e D1 precisam concordar em identidade, `imageCount`, `galleryVersion` e variantes;
- redução automática de galeria é proibida;
- similaridade visual gera revisão, não exclusão automática.

## Fronteira entre o acervo privado do Drive e as galerias Web

O SSOT operacional do acervo no Google Drive, criado em 2026-08-26, determina
**uma imagem representativa por escultura/versão distinta** nas árvores
`Catalogo/Novos`. As renderizações adicionais de um mesmo post são
**evidência privada**, preservada em `Dados/01-Originais` e trabalhada em
`Dados/02-Renomeados`. Uma postagem pode conter várias versões distintas
(Normal/NSFW, busto/estátua, poses ou esculturas materialmente diferentes);
apenas quando a distinção for comprovada surge outra unidade de catálogo.
A promoção do Drive não é automática, nem deve reiniciar snapshots SHA válidos.

No site Web (`D1/R2`), a política de mídia versionada em
`docs/operations/CATALOG-MEDIA-QUALITY-POLICY-2026-10-15.md` permite,
**separadamente**, vistas adicionais na galeria de um mesmo modelo após
análise explícita de identidade, watermark, procedência, qualidade e direitos.
Isso não cria outro modelo público nem impõe copiar cada renderização privada.
Não há conflito de SSOT: **árvore Drive = seleção representativa;
galeria Web = vistas opcionais com gate próprio**.

Para o lote de 14 posts preparado em 2026-10-30, foram identificadas
52 referências de origem e 14 vistas já publicadas. A diferença de 38
**não mede imagens públicas faltantes nem 38 modelos novos**. Os
arquivos de revisão somente leitura devem verificar se há versões
realmente distintas, se a representação atual é suficiente e se alguma
vista adicional é elegível. Nenhuma identidade ou mídia é autorizada por
essas contagens.

## Galerias legadas já reconciliadas

`config/catalog-legacy-gallery-overrides.json` continua sendo o registro canônico dos grupos revisados.

Estado estrutural consolidado conhecido:

- 21 canônicos preservados;
- 32 fontes aposentadas por relação canônico→fonte;
- 32 relações de galeria;
- nenhuma exclusão destrutiva como mecanismo de consolidação;
- aliases antigos continuam resolvendo para o canônico;
- mídia histórica permanece no R2;
- IDs/slugs aposentados não podem ser reciclados.

`tools/apply_legacy_gallery_repairs.py` é o único caminho explícito de write para essa família e não deve ser reaplicado sem nova evidência de drift.

## Índice SHA e integridade

`model_image_sources` guarda metadados de auditoria; R2/manifests continuam sendo a fonte da galeria.

O backfill inicial foi concluído e não deve ser refeito por rotina. Novos backfills processam apenas versões ainda não indexadas e continuam sem baixar binários quando manifests já fornecem SHA suficiente.

Ferramentas centrais:

- `tools/backfill_image_source_index.py`;
- `tools/plan_gallery_merge.py`;
- `tools/resolve_gallery_merge.py`;
- `tools/build_gallery_promotion_manifest.py`;
- `tools/verify_gallery_promotion_manifest.py`;
- `tools/audit_d1_integrity.py`;
- `tools/verify_public_catalog.py`.

## Conteúdo local — checkpoint preservado

O catálogo mestre operacional permanece fora do repositório público. Antes de qualquer mutação local, localizar o caminho real no dispositivo e conferir o estado atual; não assumir equivalência entre unidade sincronizada e cópia local.

Checkpoint local histórico (2026-10-11), **não revalidado nesta reconciliação**:

- SHA V4: 3.649 / 3.649;
- `catalog_complete=true`;
- 0 caminhos duplicados no cache;
- 0 hashes inválidos;
- `Novos`: 56 imagens;
- fila: 40 promoção controlada + 16 quarentena privada;
- nenhuma das 16 de quarentena deve ser apagada.

`config/public-catalog-roots.json` é a fronteira pública canônica. Não voltar a auditar conteúdo privado/referência como catálogo publicável.

Não reiniciar SHA V4 por conveniência. Reaproveitar hashes válidos e migrar/revalidar estado existente.

## Auditoria física mais recente — 2026-10-30 (somente leitura)

Acesso autorizado via Desktop Commander ao `DESKTOP-PNUHUA0`, com o
Google Drive sincronizado em `G:\Meu Drive\Catalogo`, confirmou:

- **`Catalogo/Novos`: 10 imagens físicas** em subpastas:
  2 Digimon, 5 personagens de filmes de terror e 3 personagens DC.
- **Raiz de `Catalogo`: 31 imagens soltas**, fora das categorias,
  sendo 3 com nome reconhecível, 5 WebP técnicos e 23 arquivos com
  nomes numéricos/opacos. É necessário determinar se são referências,
  outras vistas ou modelos ainda sem destino canônico.
- SHA-256 calculado de todos os **41 arquivos** no computador autorizado
  e comparado com as **2.645 entradas SHA** do índice ativo de
  `model_image_sources` (snapshot da auditoria do HEAD `004bc8e5`,
  com 2.575 modelos publicados): **0 SHA exatos coincidentes** com D1.
  Os 31 arquivos soltos têm SHA mutuamente distintos.
- Os 10 arquivos de `Novos` tampouco possuem correspondência exata
  de nome de modelo no snapshot D1. **Isso não comprova 10 esculturas
  novas**, pois podem existir outros nomes, vistas e variantes.
- Não foi feito move, delete, upload, promoção de mídia nem escrita
  no D1/R2/Drive.

**Obsolescência de números históricos:** o arquivo de 2026-10-07
`indice-publico-catalogo-resumo.json` listava 72 entradas técnicas em
`Novos` e 4.123 no Catálogo, mas era *plano, não aplicação* e já
discordava do sufixo público da pasta de estatísticas (`Novos [0]`).
O checkpoint anterior com 56 entradas também é histórico. Para a
**fila física atual de `Novos`**, usar a observação de 10 arquivos,
não os contadores antigos. Não somar entradas técnicas do Drive com
modelos D1 como se fossem a mesma unidade de contagem.

### Conferência física e visual específica — 2026-10-30, segunda passagem

**As dez entradas atuais de `Catalogo/Novos` têm destinos nominais
já criados em `Catalogo`, mas vazios.** Isso foi conferido em duas
fontes independentes: listagem física do Desktop Commander em
`DESKTOP-PNUHUA0` (somente `desktop.ini` em cada destino) e
listagem de filhos dos dez IDs de pastas pelo conector do Google Drive
(0 arquivos e 0 subpastas em cada destino). Portanto, os sufixos
`[1]` nesses dez destinos são **rótulos históricos desatualizados**,
não prova de uma imagem incorporada. Uma amostra separada de cinco
pastas antigas de Digimon, Terror e DC continha imagens normalmente.

| Grupo | Novos, com uma imagem representativa cada | Pastas equivalentes vazias |
| --- | --- | ---: |
| Digimon | Matt e Gabumon; Tai e Agumon | 2 |
| Terror | A Freira; Chucky; Hannibal Lecter; Jason Voorhees; Leatherface | 5 |
| DC | Huntress; Lucifer Morningstar; Rorschach | 3 |
| **Total** | **10 candidatos físicos** | **10** |

- As dez imagens foram abertas e inspecionadas; são esculturas/renderizações
  de personagens identificáveis. Sete mostram marca/atribuição comercial
  visível (incluindo LA Figures, Julles ou B3DSERK). A ausência de
  logotipo nas outras três **não** demonstra direitos de publicação.
- Nenhum dos dez SHA consta das 2.645 imagens publicadas no snapshot D1
  auditado anteriormente, nem da cópia do `Controle/galeria-posts.csv`
  com 12.123 linhas. Isso demonstra ausência de **SHA exato e de
  aprovação correspondente nesse manifesto**, não ausência global
  de escultura com outra imagem ou outro nome.
- **Não copiar/mover para as pastas vazias apenas para corrigir `[1]`.**
  Antes da promoção: confirmar variantes contra a coleção atual,
  autorização/procedência do criador, imagem escolhida e preflight
  SHA V4 do executor canônico. Não registrar mídia de terceiros no
  D1/R2 sem a autorização exigida pelo projeto.

**As 31 imagens soltas na raiz representam aproximadamente nove conjuntos
visuais, não 31 unidades de catálogo.** Revisão visual de todos os JPEG
em uma prancha temporária, mais as cinco imagens WebP:

| Conjunto visual provisório | Arquivos | Evidência |
| --- | ---: | --- |
| Feiticeiro com capa e energia mágica | 5 JPEG | cinco renderizações da mesma figura |
| Mulher de vestido claro | 5 JPEG | corpo inteiro, perfil e detalhes |
| Criatura estilo Predador, render fotorrealista | 4 JPEG | quatro vistas da mesma escultura provável |
| Mulher sentada, roupa avermelhada | 4 JPEG | frente, perfil e detalhes |
| Mulher sobre base mecânica/industrial | 5 JPEG | frente, verso e recortes |
| Personagem identificado no arquivo como Chun-Li | 1 JPEG | render de escultura |
| Figura indicada como Monstro da Lagoa Negra | 1 JPEG | fotografia de escultura com interface de telefone |
| Figura colorida denominada `Predator.jpg` | 1 JPEG | identidade exata da escultura ainda não confirmada |
| Diorama Alien com duas criaturas | 5 WebP | vistas e recortes do mesmo conjunto de base |
| **Total** | **31** | **nove grupos apenas provisórios** |

A comparação visual com `OK - Predador [4]` e amostras de
`OK - Alien [14]` não mostrou a mesma escultura evidente para as
duas séries soltas, mas não há prova de unicidade no acervo inteiro.
Nenhum dos 31 SHA consta do índice D1 de referência; diferenças de
arquivo, ângulo ou compressão não provam esculturas distintas.
Conservar todos os originais no lugar até resolver identidade e direitos.


### Inventário físico das seis categorias — 2026-10-30

Varredura **somente leitura** em DESKTOP-PNUHUA0, com enumeração recursiva
das imagens reais (JPEG, PNG, WebP, GIF, JFIF e BMP) nas seis categorias
principais. Os sufixos numéricos dos nomes de pastas são apresentação
histórica, não prova do conteúdo atual.

| Categoria | Sufixo da pasta | Imagens reais | Folhas com sufixo positivo e sem imagem |
| --- | ---: | ---: | ---: |
| Pessoas | 9 | 9 | 0 |
| Games | 539 | 534 | 2 |
| Tokusatsu e Cultura Japonesa | 15 | 15 | 0 |
| Animes e Desenhos | 1.062 | 1.062 | 2 |
| Marvel e DC | 716 | 714 | 6 |
| Filmes e Séries | 255 | 261 | 10 |
| **Total** | **2.596** | **2.595** | **20** |

**A diferença líquida de uma imagem não significa apenas um modelo
faltando.** Há compensações entre categorias e múltiplas fotografias
da mesma escultura. O número de arquivos não é a contagem de identidades
únicas do D1.

Dentre as 20 pastas finais vazias, há três classes verificadas:

- **10 destinos correspondentes ao conteúdo atualmente em Novos:**
  Matt e Gabumon; Tai e Agumon; A Freira; Chucky; Hannibal Lecter;
  Jason Voorhees; Leatherface; Huntress; Lucifer Morningstar; Rorschach.
  Cada destino nominal está vazio e a imagem ainda está em Novos.
  A existência do arquivo não substitui aprovação da identidade,
  procedência, qualidade e direitos.
- **5 destinos adicionais sem imagem na pasta e sem imagem diretamente
  na pasta-pai:** Warcraft / Lady Vashj (sufixo 1),
  Mortal Kombat / Motaro (sufixo 2),
  Quarteto Fantástico / Mulher Invisível (sufixo 1),
  Senhor Fantástico (sufixo 1), Tocha Humana (sufixo 1).
  Existem arquivos com esses nomes em outros lugares do Drive,
  mas os nomes não provam identidade da escultura.
  Há também outra pasta Mulher Invisível na área Heróis Individuais,
  esta com uma imagem, distinta da pasta vazia do Quarteto Fantástico.
- **5 subdivisões de Alien com arquivos na pasta superior:**
  Dog Alien (2), Xenomorfo (6), Ellen Ripley (3),
  Facehugger (2), Rainha Alien (1).
  A pasta Alien possui 14 arquivos diretos correspondentes
  a esses personagens, de modo que as subdivisões vazias não são
  evidência de 14 imagens ou esculturas faltantes.

A rotina canônica atualizar-indice-publico-catalogo.ps1 já conta
arquivos físicos e só pode atualizar os sufixos depois do preflight
SHA V4. Portanto: não criar outro contador, não renomear
pastas manualmente e não promover mídia de terceiros sem evidência
e autorização correspondentes.

**Execução seguinte de conteúdo:** reconciliar os dez itens de Novos
com aprovação de curadoria, os cinco destinos adicionais com as
representações encontradas em outras áreas e os nove grupos visuais
da raiz. Tratar os itens Alien como referências já situadas na pasta
superior, não como arquivos ausentes. Permanecem separadas as
pendências de ingestão em escala da fonte externa.

**Ordem operacional revisada:** (1) sanar a discrepância de dez
pastas vazias sem mascarar a contagem; (2) revisar autorizações e
preflight do executor para os dez itens de `Novos`; (3) avaliar os
**nove conjuntos**, não os 31 arquivos individualmente, contra
representantes da coleção organizada; (4) promover somente identidades
comprovadas e autorizadas, sem escrita direta pela auditoria.
O manifesto de 30 candidatos de 2026-09-08 permanece histórico; não
reabrir o lote encerrado de 309 imagens (307 incorporadas, 2 em quarentena).


### Conferência de candidatos do Drive — 2026-10-30, terceira passagem

Leitura direta dos metadados e filhos no Google Drive, sem mutações:

| Destino público vazio | Fonte candidata identificada | Estado |
| --- | --- | --- |
| Lady Vashj | Pasta externa `lady-vashj-stl-nsfw-warcraft`, 7 WebP | Identidade, direitos e elegibilidade pendentes |
| Motaro | JPEG `motaro mortal kombat statue 66375.jpg` e JPEG `PENDENTE_IDENTIFICACAO__origem-Motaro.jpg` em pastas distintas | Revisão de identidade obrigatória |
| Mulher Invisível | Pasta externa `invisible-woman-stl-marvel`, 5 WebP | Não equiparar automaticamente à pasta vazia do Quarteto Fantástico |
| Senhor Fantástico | JPEG `mr fantastic c27 miniature 24771.jpg` | Identidade pendente |
| Tocha Humana | 8 JPEGs de diferentes identificadores numa pasta e 2 WebPs `human-torch-standing-figure-74394.webp` em pastas externas | Segregar variantes antes de deduplicação |

As cinco pastas de destino `OK - ...` consultadas não apresentaram filhos na listagem atual; isso confirma apenas o vazio físico desses destinos. Os arquivos candidatos acima não foram comparados visualmente nesta passagem; nomes e identificadores não constituem prova de identidade ou autoria. Não mover, renomear, promover ou preencher contagens. A próxima decisão exige comparação visual documentada, proveniência e preflight SHA V4 antes de qualquer atualização canônica.

### Gate de lançamento — verificação em 2026-10-30

**Lançamento ainda não homologado.** A aprovação de testes não implica aprovação de produção.

- PR #175, HEAD `603e0d68`: 14 checks success e dois jobs de escrita skipped; draft sobre #174.
- PR #174, HEAD `138f3e04`: três checks success e um skipped; draft sobre main.
- Conexão Cloudflare verificada: somente conta `ordax-platform`, não a conta Tonecos do Catálogo. Portanto D1, R2 e Worker de produção não foram auditados nesta passagem.
- Dez imagens em Novos, cinco destinos adicionais sem imagem e nove grupos provisórios na raiz continuam sujeitos à comprovação de identidade e direitos. Cinco subdivisões Alien não representam falta confirmada.
- A cobertura da fonte externa continua sem comprovação integral (`coverage100Proven=false`).

**Para homologar:** verificar os SHAs integrados e seus gates; inspecionar D1/R2/Worker e smoke público na conta de produção correta; validar schema, mídia e colisões; promover somente arquivos com identidade e direitos aprovados, usando o pipeline oficial. Itens ainda não aprovados permanecem fora do conteúdo publicado, sem bloquear indefinidamente um catálogo existente cuja integridade esteja comprovada. Não criar segundo gate, SSOT paralelo ou exceção silenciosa.

## Próxima sequência de conteúdo e fechamento estrutural

1. Validar CI/coverage do HEAD atual nas PRs #174 e #175; não declarar gates anteriores como aprovados para um commit novo.
2. Executar auditorias somente leitura contra o D1 e a API da fonte na conta correta; conferir também schema `0021`, manifests e imagens publicadas no Worker/R2. Se o acesso à conta Tonecos estiver ausente, registrar o bloqueio e não simular sucesso.
3. Consumir a fila canônica `external-source-identity-triage.json` e a fila `published-collision-review-queue.json` dos artefatos da mesma execução, sem interpretar igualdade de nome, alias, dHash ou SHA isolados como escultura idêntica.
4. Reconciliar visualmente e com procedência os candidatos reais; registrar `map_existing` ou `new_model` somente com provas versionadas e sem conflitos. Uma identidade distinta não autoriza publicação de imagem.
5. Para publicação, exigir direitos, atribuição e cobertura integral de staging privado, SHA/tamanho, preflight de R2/D1 e verificação pública; promover apenas deltas explicitamente aprovados.
6. Só integrar as PRs empilhadas na `main` após análise do diff final e dos gates, sem force-push, duplicação de modelos, rebuild de mídia sem necessidade ou descarte de evidências.

O cache local e as filas do checkpoint de 11/10 são históricos, não autoridade para promover novos itens. Preservar invariantes de SSOT e nunca repetir ingestões completas para apenas atualizar status.

## O que não fazer

- não recomeçar o catálogo do zero;
- não reprocessar dados concluídos sem evidência técnica;
- não criar segunda origem de runtime ou mídia;
- não expor R2 diretamente ao público;
- não criar fallback de infraestrutura ou credencial hardcoded;
- não mover domínio de outra conta como atalho;
- não juntar produtos diferentes só por nome/personagem/pasta;
- não apagar STL/GLB/3MF/OBJ/fontes;
- não recriar árvore paralela por mojibake/prefixo/sufixo;
- não executar manutenção de dados automaticamente junto com mudança sem relação com dados/schema.

## Regra para futuras sessões

Antes de trabalhar:

1. ler este arquivo;
2. conferir estado atual de `main`, PRs/issues e workflows;
3. medir Cloudflare/produção em vez de assumir que IDs deste checkpoint ainda são atuais;
4. localizar o próximo problema concreto;
5. corrigir causa raiz e adicionar gate quando houver risco real de regressão;
6. atualizar este arquivo somente quando mudar uma decisão operacional relevante.

Sem gambiarras, sem paliativos, sem hardcoded concorrente, sem duplicação de SSOT e sem manter instrução obsoleta “por segurança”. O estado medido e os contratos versionados prevalecem.
