# Deploy Cloudflare

O catálogo usa GitHub Pages para o frontend e Cloudflare para API, banco, mídia e proteção dos fluxos públicos de gravação.
O deploy normal do backend é automatizado; somente o provisionamento inicial da conta é feito uma vez.

## Recursos de produção

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- R2: `tonecos-catalogo-media`
- Turnstile: widget Managed usado no orçamento e no compartilhamento de coleções
- Binding D1: `DB`
- Binding R2: `MEDIA`

## Bootstrap único

1. Criar o banco D1 `tonecos-catalogo` e guardar o UUID.
2. Criar o bucket R2 `tonecos-catalogo-media`.
3. Configurar uma origem pública/CDN para os objetos web do R2.
4. Criar um widget Cloudflare Turnstile em modo Managed. Autorizar `washingtonmsdj.github.io` e, quando existir, o domínio próprio do catálogo.
5. Criar um API Token Cloudflare com somente as permissões necessárias para Worker, D1 e R2.
6. Configurar no GitHub as variáveis e secrets descritos abaixo.

O arquivo `wrangler.jsonc` mantém um placeholder de D1. O UUID real nunca precisa ser commitado: `tools/render_wrangler_config.mjs` gera a configuração efêmera usada pelo CI.

`preview_urls` fica explicitamente desabilitado no `wrangler.jsonc`. O endpoint estável em `workers.dev` permanece ativo, mas versões de preview não são expostas por default implícito do Wrangler.

## GitHub Repository Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `VITE_API_BASE_URL` — origem pública do Worker, sem barra final
- `VITE_MEDIA_BASE_URL` — origem pública/CDN do R2, sem barra final
- `VITE_TURNSTILE_SITE_KEY` — chave pública do widget Turnstile
- `CATALOG_CORS_ORIGINS` — opcional; lista separada por vírgulas para futuros domínios próprios

## GitHub Repository Secrets

- `CLOUDFLARE_API_TOKEN`
- `TURNSTILE_SECRET_KEY` — segredo privado do widget Turnstile; nunca vai para o bundle do navegador

## Fluxo automático

Ao alterar `worker/`, `migrations/` ou configuração Cloudflare na `main`, o workflow `Deploy Cloudflare API` executa primeiro um **preflight sempre visível**.

O preflight verifica `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN` e `TURNSTILE_SECRET_KEY`. Se qualquer item estiver ausente, o workflow registra no resumo exatamente o que falta e **falha fechado**. Em `main`, um deploy pulado por falta de credencial não pode aparecer como sucesso: CI continua medindo a qualidade do código em seu workflow próprio, enquanto o workflow de produção só fica verde quando a publicação realmente pode ser executada.

Quando o bootstrap está disponível, o job de produção:

1. valida `CLOUDFLARE_API_TOKEN` e `TURNSTILE_SECRET_KEY`;
2. valida o Worker;
3. gera a configuração com o UUID real do D1;
4. confirma que o bucket R2 existe;
5. aplica somente as migrações D1 ainda não aplicadas;
6. publica o Worker;
7. verifica se `TURNSTILE_SECRET_KEY` já existe no Worker e envia o GitHub Secret somente quando necessário;
8. confirma novamente que o nome do secret está ativo;
9. consulta `/api/health` para provar que o Worker está respondendo;
10. consulta `/api/categories` e valida a estrutura JSON para provar que o binding D1 e o schema do catálogo estão acessíveis;
11. consulta uma coleção pública inexistente e exige `404 shared_collection_not_found`, provando que a rota `/api/shared-collections/:code` está realmente presente no Worker publicado.

O R2 é validado antes do deploy via Wrangler. Assim, Worker, D1 e bucket precisam estar operacionais para o pipeline de produção terminar com sucesso.

Na rotação da chave Turnstile, execute manualmente o workflow com `force_turnstile_secret_sync=true`. O valor do segredo continua mascarado pelo GitHub e é enviado ao Wrangler por stdin.

## Estado de produção

O bootstrap inicial foi executado em 2026-09-30/2026-10-01 com recursos próprios e isolados do OrdaX Control Plane:

- Worker `tonecos-catalogo-api` publicado em `workers.dev`;
- D1 `tonecos-catalogo` com as migrações `0001`–`0010` aplicadas e reconciliadas na tabela `d1_migrations`;
- R2 `tonecos-catalogo-media` criado com endpoint público `r2.dev` para as variantes web;
- widget Turnstile Managed próprio do catálogo, autorizado para `washingtonmsdj.github.io`.

O workflow do Pages exige as Repository Variables de produção para API, mídia, site key do Turnstile e URL pública. Ele não contém endpoints ou chaves públicas de produção como fallback: configuração ausente falha explicitamente antes do build. Segredos privados continuam fora do Git.

## Frontend

O workflow do GitHub Pages injeta durante o build:

- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

Assim que API/mídia estiverem configuradas, o mesmo frontend muda de DEMO para LIVE sem alteração de código. A site key do Turnstile é pública por definição; o secret nunca é exposto ao frontend.

Após cada publicação, o workflow do Pages executa um smoke test HTTP no endereço publicado, confirma a presença da identidade Tonecos Studios no HTML e valida o `site.webmanifest`. O workflow só termina com sucesso se a versão publicada estiver realmente acessível.

## Verificação pública

O verificador oficial possui dois níveis. O modo padrão é rápido e valida health, pelo menos um modelo publicado e uma capa real servida pela origem pública de mídia:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2>
```

Para auditorias completas após publicação, use `--exhaustive`:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive
```

O modo exaustivo percorre todas as páginas do catálogo e falha se encontrar total divergente, paginação cíclica, ID/slug/código duplicado, modelo sem capa, modelo sem imagem, categoria desconhecida ou contagem por categoria incompatível com `/api/categories`. Ele não baixa todas as imagens; o smoke inicial continua provando que a origem pública de mídia serve uma capa real.

## Turnstile

O mesmo widget Managed pode proteger mais de um fluxo porque o servidor exige a `action` esperada para cada operação:

- orçamento: `quote`;
- criação de link de coleção: `collection-share`.

Em LIVE, o Worker trabalha em modo fail-closed:

- sem `TURNSTILE_SECRET_KEY`, não grava solicitação nem coleção compartilhada;
- token Turnstile é validado server-side via Siteverify;
- a action precisa corresponder ao fluxo;
- IDs enviados pelo navegador são conferidos contra modelos publicados no D1;
- Origin fora da allowlist é recusada;
- o navegador mantém os dados locais se a operação remota falhar.

O Turnstile usa `appearance: interaction-only`, mantendo a interface limpa para a maioria dos clientes.

## Segurança

Nunca colocar token Cloudflare, Turnstile secret, segredo de API ou credenciais dentro de `.env.example`, `wrangler.jsonc`, commits ou arquivos do catálogo. Segredos ficam somente em GitHub Secrets/Cloudflare.
