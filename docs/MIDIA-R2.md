# Publicação de mídia no R2

O bundle de publicação transforma somente imagens `OK` e `canonical=true` do manifesto de ingestão. A origem continua somente leitura.

## Gerar o bundle

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle"
```

A geração mantém `media-build-state.json` no diretório de saída. Cada modelo concluído recebe um fingerprint que inclui SHA/metadados da origem, variantes, opção de original e a regra de taxonomia relevante. Em nova execução, o modelo só é reutilizado se o fingerprint coincidir **e** galeria/capa/variantes ainda existirem e forem legíveis. Isso permite retomar após queda de Drive ou interrupção sem aceitar saída parcial como válida.

O diretório de saída é **single-writer**: `.media-build.lock` usa um lock exclusivo do sistema operacional e uma segunda execução apontando para o mesmo bundle falha imediatamente. O arquivo de lock pode permanecer no diretório sem criar bloqueio obsoleto, porque a posse é determinada pelo processo/handle do sistema operacional. A troca atômica de `media-build-state.json` também faz retry curto e limitado apenas para `PermissionError` transitório (por exemplo, antivírus ou Google Drive no Windows); se o bloqueio persistir, a execução aborta em modo fail-closed.

Para forçar uma recomposição completa, ignorando o checkpoint:

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle" --no-resume
```

Por padrão o bundle **não copia o original** para o R2. O arquivo mestre continua preservado no acervo de origem. Para incluir também o original:

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle" --include-original
```

## Variantes

Cada imagem canônica gera:

- `thumb.webp`: lado máximo 360 px;
- `card.webp`: lado máximo 800 px;
- `detail.webp`: lado máximo 1600 px.

Imagens menores nunca são ampliadas artificialmente.

## Estrutura

```text
.publish-bundle/
  models.jsonl
  publish-summary.json
  media-build-state.json
  r2-publish-state.json
  r2/
    gallery/<model-id>/<hash-do-manifesto>.json
    media/<model-id>/<image-id>/thumb.webp
    media/<model-id>/<image-id>/card.webp
    media/<model-id>/<image-id>/detail.webp
```

O manifesto da galeria é **content-addressed**: se a galeria não muda, a chave é idêntica; se uma imagem entra, sai ou muda de posição/metadados, uma nova chave é gerada. Isso permite cache longo sem sobrescrever um manifesto antigo que ainda esteja sendo usado.

`models.jsonl` é a ponte para alimentar o D1. Cada linha contém:

- ID determinístico do personagem;
- slug público e código estável `TS-*`;
- categoria/franquia com nome e slug;
- coleção intermediária, quando existir;
- hierarquia completa de origem;
- `searchText` para indexação;
- número de imagens;
- capa;
- chave e versão do manifesto de galeria.

Slugs colidentes recebem um sufixo determinístico derivado do ID do modelo. Portanto dois personagens diferentes nunca disputam a mesma URL por acidente.

### Catálogo auditado e galerias

No modo `--audit-registry`, a identidade pública vem de `modelo_publico` quando essa coluna está preenchida. Registros com a **mesma hierarquia + mesmo `modelo_publico`** são agrupados em uma única ficha e cada registro canônico vira uma imagem da galeria.

Exemplo: se 17 vistas auditadas de um mesmo produto em `Dragon Ball/Androides/Androide 18` compartilham `modelo_publico=goku-modelo-01`, o bundle produz **1 modelo com 17 imagens**, não 17 modelos.

Para compatibilidade com o acervo histórico, registros sem `modelo_publico` ainda usam a identidade baseada no arquivo e podem continuar aparecendo como entradas individuais. Novos lotes — especialmente STL Forge — não devem depender desse fallback.

Antes de gerar o bundle após integrar uma nova fonte, `tools/plan_gallery_merge.py` deve separar duplicatas exatas, novas vistas e candidatos visuais. Similaridade perceptual nunca elimina automaticamente uma imagem; ela apenas recomenda qual fonte possui maior qualidade para revisão.

### Taxonomia pública sem mover a origem

`config/catalog-taxonomy.json` permite reorganizar a navegação pública sem renomear ou mover a árvore auditada no Drive. As regras são explícitas por franquia e caminho; não existe classificação automática baseada apenas no nome do personagem.

O bundle grava `folderPath` e `folderPathKey` em cada modelo. Por exemplo, a origem `As Tartarugas Ninja/Destruidor` pode continuar intacta enquanto a navegação web publica `Vilões/Destruidor`. Alterar essa pasta pública não altera o ID do modelo nem exige reescrever o arquivo mestre.

## IDs determinísticos

O ID do modelo deriva de uma chave pública determinística. No modo de galeria legado, essa chave é a hierarquia do modelo; no catálogo auditado, ela inclui também a entrada pública representativa. O ID da imagem deriva do SHA-256. Portanto uma nova execução não gera IDs aleatórios para conteúdo que não mudou.

## Capa

A primeira capa automática é a imagem canônica de maior `quality_score`. No futuro o painel administrativo poderá sobrescrever essa escolha sem alterar o arquivo original.

## Upload incremental

O publicador usa a API S3 compatível do R2 e mantém checkpoint local. Depois da primeira publicação, arquivos sem alteração são ignorados sem precisar executar `HEAD` remoto para cada objeto.

Variáveis necessárias:

```text
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=tonecos-catalogo-media   # opcional; esse já é o padrão
```

Publicar:

```bash
python tools/publish_r2.py ".publish-bundle/r2"
```

Simular o delta sem enviar nada:

```bash
python tools/publish_r2.py ".publish-bundle/r2" --dry-run
```

Fazer uma auditoria remota dos objetos que o checkpoint consideraria prontos:

```bash
python tools/publish_r2.py ".publish-bundle/r2" --verify-remote
```

O modo `--verify-remote` é propositalmente opcional: em um acervo com milhões de arquivos, consultar cada objeto a cada execução seria caro e lento. O checkpoint local guarda tamanho, `mtime`, SHA-256 publicado e metadados HTTP; ele é salvo atomicamente durante a execução para permitir retomada após interrupção.

O publicador grava o SHA-256 como metadata de cada objeto. Galerias content-addressed recebem cache `immutable`; variantes de mídia recebem cache longo, mas não `immutable`, permitindo futura evolução do renderizador sem deixar uma URL permanentemente presa a uma versão antiga.

## Publicação do índice no D1

`tools/publish_d1.py` valida `models.jsonl` e prepara upserts idempotentes para categorias, franquias, árvore de pastas e modelos. Nós pais são publicados antes dos filhos e os modelos recebem `folder_id` somente após a pasta existir.

Sem `--apply`, o comando é somente leitura e imprime o plano:

```bash
python tools/publish_d1.py ".publish-bundle/models.jsonl"
```

Para aplicar em produção:

```text
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
```

```bash
python tools/publish_d1.py ".publish-bundle/models.jsonl" --apply
```

Os statements são enviados em batches transacionais. O publicador não executa `DELETE`, não despublica itens ausentes e não tenta reconciliar remoções automaticamente; qualquer política destrutiva futura deverá ter fluxo e revisão próprios.

## Segurança e exclusões

- O publicador **não apaga objetos do R2**.
- Uma publicação parcial mantém checkpoint dos uploads já concluídos e pode ser retomada.
- Credenciais R2 nunca entram no repositório.
- Gere credenciais S3 com acesso somente ao bucket do catálogo quando possível.
- `.publish-bundle/` é ignorado pelo Git e nunca deve ser commitado.
