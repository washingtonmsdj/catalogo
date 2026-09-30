# Sincronização do catálogo com D1

`models.jsonl`, gerado por `tools/build_media_bundle.py`, é a fonte de metadados publicados no Cloudflare D1. A sincronização é incremental: modelos sem alteração não geram `UPDATE` e modelos que saíram do acervo são despublicados, não apagados.

## Pré-requisitos

1. O D1 de produção deve estar com todas as migrações aplicadas, incluindo `0005_catalog_source_sync.sql`.
2. Gere a configuração efêmera do Wrangler:

```bash
npm run cloudflare:config
```

3. O bundle deve existir:

```text
.publish-bundle/
  models.jsonl
  r2/
  d1-publish-state.json   # criado depois da primeira sincronização bem-sucedida
  d1-sync.sql             # SQL gerado para inspeção/auditoria
```

## Conferir antes de publicar

Sempre é possível gerar o plano SQL sem tocar no D1:

```bash
python tools/sync_d1.py ".publish-bundle/models.jsonl" --dry-run
```

O comando valida:

- JSON e tipos obrigatórios;
- IDs, slugs e códigos únicos;
- consistência de categoria e franquia;
- existência de pelo menos uma imagem canônica por modelo;
- caminhos/chaves esperados para capa e galeria;
- delta em relação ao último checkpoint local;
- quantidade de modelos que desapareceram.

## Publicar

```bash
python tools/sync_d1.py ".publish-bundle/models.jsonl"
```

O sincronizador chama o Wrangler com `d1 execute --remote --file`. O checkpoint local só é atualizado **depois** que a execução remota retorna sucesso. Se a publicação falhar ou for interrompida, a próxima execução continua considerando o estado anterior confirmado.

## O que é sincronizado

Campos gerados pela fonte:

- ID estável;
- categoria e franquia;
- slug público;
- código `TS-*`;
- nome;
- coleção intermediária;
- quantidade de imagens;
- capa;
- chave e versão do manifesto da galeria;
- texto de busca;
- `source_key` e identificador da sincronização.

Campos destinados à curadoria/painel **não são sobrescritos** pelo pipeline quando o modelo já existe:

- material;
- altura;
- descrição.

Assim, uma descrição editada manualmente no futuro não desaparece quando novas fotos do personagem forem publicadas.

## Modelos removidos

Quando um modelo existia no último checkpoint mas não aparece no novo `models.jsonl`:

1. ele recebe `published=0`;
2. slug e código são movidos para nomes internos `__archived__-*`;
3. o registro permanece no banco;
4. referências históricas, incluindo itens de orçamento, continuam válidas.

Se o mesmo ID voltar em uma execução futura, o upsert restaura seu slug/código público e o publica novamente.

O sincronizador **não executa DELETE em modelos**.

## Proteção contra remoção em massa

Uma origem montada parcialmente, pasta errada ou manifesto truncado não deve despublicar milhares de modelos silenciosamente.

Por padrão, o pipeline bloqueia quando o desaparecimento excede o limite automático. Depois de revisar conscientemente o delta, uma operação realmente intencional pode ser liberada com:

```bash
python tools/sync_d1.py ".publish-bundle/models.jsonl" --allow-large-removal
```

Um catálogo vazio também é bloqueado. A despublicação total exige explicitamente `--allow-empty` e, quando aplicável, `--allow-large-removal`.

## Checkpoint é importante

`d1-publish-state.json` registra o fingerprint da última versão confirmada de cada modelo. Isso permite que 100 mil+ modelos permaneçam sem escrita quando apenas algumas dezenas mudarem.

O arquivo fica dentro de `.publish-bundle/` e não é commitado no Git. Em produção ele deve ser preservado junto ao estado operacional do publicador.

Se esse checkpoint for perdido, uma nova execução continua segura para os modelos presentes (eles serão reenviados), mas não consegue inferir apenas localmente quais modelos antigos, ausentes do arquivo atual, precisam ser despublicados. Uma reconciliação remota deve ser feita antes de considerar o estado novamente autoritativo.

## Auditoria

Cada sincronização que realmente altera o D1 registra uma linha em `catalog_sync_runs` com:

- ID da sincronização derivado do SHA-256 da fonte;
- SHA-256 completo de `models.jsonl`;
- total de modelos;
- quantidade alterada/nova;
- quantidade despublicada;
- data de conclusão.

O arquivo `d1-sync.sql` fica disponível localmente para inspeção e diagnóstico.

## Ordem de publicação recomendada

Para não colocar no banco referências a mídia que ainda não chegou ao R2:

1. gerar ingestão/revisão;
2. gerar `.publish-bundle`;
3. executar `publish_r2.py` e confirmar sucesso;
4. executar `sync_d1.py --dry-run`;
5. executar `sync_d1.py`;
6. validar `/api/health` e uma amostra do catálogo/galeria.
