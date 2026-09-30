# Deploy Cloudflare

O catálogo usa GitHub Pages para o frontend e Cloudflare para API, banco, mídia e proteção do formulário.
O deploy normal do backend é automatizado; somente o provisionamento inicial da conta é feito uma vez.

## Recursos de produção

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- R2: `tonecos-catalogo-media`
- Turnstile: widget Managed para o formulário de orçamento
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

Ao alterar `worker/`, `migrations/` ou configuração Cloudflare na `main`, o workflow `Deploy Cloudflare API`:

1. valida as credenciais obrigatórias;
2. valida o Worker;
3. gera a configuração com o UUID real do D1;
4. confirma que o bucket R2 existe;
5. aplica somente as migrações D1 ainda não aplicadas;
6. publica o Worker;
7. verifica se `TURNSTILE_SECRET_KEY` já existe no Worker e envia o GitHub Secret somente quando necessário;
8. confirma novamente que o nome do secret está ativo;
9. consulta `/api/health` para provar que o Worker está respondendo;
10. consulta `/api/categories` e valida a estrutura JSON para provar que o binding D1 e o schema do catálogo estão acessíveis.

O R2 é validado antes do deploy via Wrangler. Assim, Worker, D1 e bucket precisam estar operacionais para o pipeline de produção terminar com sucesso.

Na rotação da chave Turnstile, execute manualmente o workflow com `force_turnstile_secret_sync=true`. O valor do segredo continua mascarado pelo GitHub e é enviado ao Wrangler por stdin.

Se as variáveis de conta/D1 ainda não estiverem configuradas, o job é ignorado. O preview do GitHub Pages continua funcionando em modo DEMO.

## Frontend

O workflow do GitHub Pages injeta durante o build:

- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

Assim que API/mídia estiverem configuradas, o mesmo frontend muda de DEMO para LIVE sem alteração de código. A site key do Turnstile é pública por definição; o secret nunca é exposto ao frontend.

Após cada publicação, o workflow do Pages executa um smoke test HTTP no endereço publicado, confirma a presença da identidade Tonecos Studios no HTML e valida o `site.webmanifest`. O workflow só termina com sucesso se a versão publicada estiver realmente acessível.

## Formulário de orçamento

Em LIVE, o Worker trabalha em modo fail-closed:

- sem `TURNSTILE_SECRET_KEY`, não grava solicitação;
- token Turnstile é validado server-side via Siteverify;
- exige a action `quote`;
- IDs enviados pelo navegador são conferidos contra modelos publicados no D1;
- máximo de 50 modelos por solicitação;
- nome, e-mail e observações possuem limites server-side;
- Origin fora da allowlist é recusada;
- o navegador mantém a seleção local se o envio falhar.

O Turnstile é renderizado apenas no modal de orçamento e usa `appearance: interaction-only`, mantendo a interface limpa para a maioria dos clientes.

## Segurança

Nunca colocar token Cloudflare, Turnstile secret, segredo de API ou credenciais dentro de `.env.example`, `wrangler.jsonc`, commits ou arquivos do catálogo. Segredos ficam somente em GitHub Secrets/Cloudflare.
