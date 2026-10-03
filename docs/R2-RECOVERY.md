# Recuperação de publicação R2

Este procedimento existe para o caso em que objetos já chegaram ao R2, mas o checkpoint local `r2-publish-state.json` foi perdido, ficou atrasado ou pertence a uma execução interrompida.

A reconciliação **não envia, sobrescreve nem apaga objetos**. Ela apenas compara o bundle local com o estado remoto e, opcionalmente, reconstrói o checkpoint oficial.

## Pré-requisitos

Use o mesmo bundle que originou a publicação parcial e credenciais R2 restritas ao bucket do catálogo sempre que possível:

```text
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=tonecos-catalogo-media
```

Nunca grave essas credenciais no repositório.

### Credenciais temporárias oficiais

O publicador e a reconciliação também aceitam credenciais temporárias do R2. Nesse caso, além do access key e secret, informe o session token retornado pela Cloudflare:

```text
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_SESSION_TOKEN=
```

Essas credenciais podem ser criadas com TTL curto e escopo restrito ao bucket/prefixos. O `R2_SESSION_TOKEN` é opcional para credenciais permanentes e obrigatório quando a credencial temporária retorná-lo. Nenhum desses valores deve ser persistido no repositório, em arquivos versionados ou em logs.

## 1. Auditar sem alterar estado local

```bash
python tools/reconcile_r2_state.py ".publish-bundle/r2"
```

O resumo separa:

- `verified`: objetos remotos que correspondem ao bundle local;
- `adopted`: objetos íntegros ainda ausentes do checkpoint;
- `alreadyTracked`: objetos íntegros já registrados;
- `missing`: objetos inexistentes no R2;
- `mismatched`: mesma chave com conteúdo/tamanho incompatível;
- `errors`: falhas de consulta que não devem ser tratadas como ausência.

Sem `--apply`, nenhum arquivo local é alterado.

## 2. Reconstruir o checkpoint

Depois de revisar o resumo:

```bash
python tools/reconcile_r2_state.py ".publish-bundle/r2" --apply
```

Objetos verificados recebem `published_sha256`, `remote_verified=true` e o método de verificação no checkpoint. Objetos ausentes ou divergentes permanecem pendentes.

A verificação prefere metadata SHA-256 escrita pelo publicador oficial. Para objetos legados single-part sem essa metadata, aceita ETag/MD5 somente quando o tamanho também coincide. ETags multipart nunca são aceitos por esse fallback.

## 3. Retomar a publicação normal

Com o checkpoint reconciliado:

```bash
python tools/publish_r2.py ".publish-bundle/r2"
```

O publicador ignora os objetos já adotados e envia apenas o delta pendente. Ele continua sem executar deletes.

A publicação ocorre em fases: todo `media/` é concluído primeiro; manifestos `gallery/` só são enviados depois de a fase de mídia terminar sem erros. Se qualquer upload de mídia falhar, as fases posteriores ficam adiadas e o checkpoint dos sucessos é preservado.

## 4. Validar antes do D1

Após o R2 terminar sem erros, faça uma verificação remota explícita:

```bash
python tools/publish_r2.py ".publish-bundle/r2" --verify-remote
```

Somente depois dessa etapa o índice deve ser aplicado ao D1. Isso evita publicar modelos cujas capas ou galerias ainda não estejam disponíveis no bucket.

## Gate automático do D1

`publish_d1.py --apply` usa, por padrão, `r2-publish-state.json` ao lado de `models.jsonl` e falha antes de qualquer chamada ao D1 se o lote R2 atual não estiver completo.

O gate confere:

- todos os arquivos presentes no bundle `r2/` têm `published_sha256` igual ao SHA atual;
- capa e manifesto de cada modelo existem no bundle;
- o manifesto pertence ao mesmo `modelId`;
- `imageCount` coincide com a galeria;
- cada imagem referencia `thumb`, `card` e `detail` válidos e existentes.

O comando normal continua simples:

```bash
python tools/publish_d1.py ".publish-bundle/models.jsonl" --apply
```

Para um checkpoint mantido em outro local, use explicitamente:

```bash
python tools/publish_d1.py ".publish-bundle/models.jsonl" --apply --r2-state "/caminho/r2-publish-state.json"
```

Não existe flag de bypass no fluxo normal. Se o R2 estiver parcial ou o bundle estiver incoerente, o D1 permanece intacto.

## Regras de segurança

- nunca use tamanho isoladamente como prova de identidade;
- nunca adote objeto divergente apenas para reduzir o delta;
- não remova objetos remotos durante recuperação;
- não altere o catálogo mestre nem a árvore auditada;
- não publique o D1 antes de o lote de mídia estar completo e validado.
