# Deploy Cloudflare

O catálogo usa GitHub Pages para o frontend e Cloudflare para API, banco e mídia.
O deploy normal do backend é automatizado; somente o provisionamento inicial da conta é feito uma vez.

## Recursos de produção

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- R2: `tonecos-catalogo-media`
- Binding D1: `DB`
- Binding R2: `MEDIA`

## Bootstrap único

1. Criar o banco D1 `tonecos-catalogo` e guardar o UUID.
2. Criar o bucket R2 `tonecos-catalogo-media`.
3. Configurar uma origem pública/CDN para os objetos web do R2.
4. Criar um API Token Cloudflare com somente as permissões necessárias para Worker, D1 e R2.
5. Configurar no GitHub as variáveis e o secret descritos abaixo.

O arquivo `wrangler.jsonc` mantém um placeholder de D1. O UUID real nunca precisa ser commitado: `tools/render_wrangler_config.mjs` gera a configuração efêmera usada pelo CI.

## GitHub Repository Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `VITE_API_BASE_URL` — origem pública do Worker, sem barra final
- `VITE_MEDIA_BASE_URL` — origem pública/CDN do R2, sem barra final
- `CATALOG_CORS_ORIGINS` — opcional; lista separada por vírgulas para futuros domínios próprios

## GitHub Repository Secret

- `CLOUDFLARE_API_TOKEN`

## Fluxo automático

Ao alterar `worker/`, `migrations/` ou configuração Cloudflare na `main`, o workflow `Deploy Cloudflare API`:

1. valida o Worker;
2. gera a configuração com o UUID real do D1;
3. confirma que o bucket R2 existe;
4. aplica somente as migrações D1 ainda não aplicadas;
5. publica o Worker;
6. consulta `/api/health` quando `VITE_API_BASE_URL` estiver configurada.

Se as variáveis de conta/D1 ainda não estiverem configuradas, o job é ignorado. O preview do GitHub Pages continua funcionando em modo DEMO.

## Frontend

O workflow do GitHub Pages injeta `VITE_API_BASE_URL` e `VITE_MEDIA_BASE_URL` durante o build. Assim que essas variáveis existirem, o mesmo frontend muda de DEMO para LIVE sem alteração de código.

## Segurança

Nunca colocar token Cloudflare, segredo de API ou credenciais dentro de `.env.example`, `wrangler.jsonc`, commits ou arquivos do catálogo. Segredos ficam somente em GitHub Secrets/Cloudflare.
