# Publicação de mídia no R2

O bundle de publicação transforma somente imagens `OK` e `canonical=true` do manifesto de ingestão. A origem continua somente leitura.

## Gerar o bundle

```bash
python tools/build_media_bundle.py "/caminho/do/catalogo" ".catalog-ingest/manifest.jsonl" --output ".publish-bundle"
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

### Catálogo auditado atual

Quando a ingestão usa `--audit-registry`, cada linha do registro RV1 representa uma entrada pública individual. Nesse modo, duas imagens distintas na mesma pasta continuam sendo **dois modelos/versões públicos distintos**. A hierarquia da pasta continua servindo para categoria/franquia/coleção, mas não é usada sozinha como identidade do modelo.

Exemplo: 17 imagens auditadas dentro de `Dragon Ball/Androides/Androide 18` resultam em 17 entradas públicas, não em uma galeria única de 17 imagens.

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

`tools/publish_d1.py` valida `models.jsonl` e prepara upserts idempotentes para categorias, franquias e modelos.

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
