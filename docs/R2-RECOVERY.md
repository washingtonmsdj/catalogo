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

## 4. Validar antes do D1

Após o R2 terminar sem erros, faça uma verificação remota explícita:

```bash
python tools/publish_r2.py ".publish-bundle/r2" --verify-remote
```

Somente depois dessa etapa o índice deve ser aplicado ao D1. Isso evita publicar modelos cujas capas ou galerias ainda não estejam disponíveis no bucket.

## Regras de segurança

- nunca use tamanho isoladamente como prova de identidade;
- nunca adote objeto divergente apenas para reduzir o delta;
- não remova objetos remotos durante recuperação;
- não altere o catálogo mestre nem a árvore auditada;
- não publique o D1 antes de o lote de mídia estar completo e validado.
