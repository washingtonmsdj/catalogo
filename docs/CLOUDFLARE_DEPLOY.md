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

O preflight verifica se `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_D1_DATABASE_ID` existem. Se algum deles estiver ausente, o workflow termina de forma controlada com um aviso e registra no resumo exatamente quais variáveis faltam; o job de produção é pulado. Isso evita confundir “deploy não configurado” com “deploy executado com sucesso”.

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

## Estado DEMO antes do bootstrap

Enquanto `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` e `VITE_API_BASE_URL` não estiverem configurados, o GitHub Pages continua publicando o frontend em modo DEMO. Nenhuma migration é aplicada remotamente e nenhum Worker novo é publicado.

Isso é intencional: IDs reais, tokens e secrets não devem ser inventados nem commitados apenas para fazer o pipeline parecer verde.

## Frontend

O workflow do GitHub Pages injeta durante o build:

- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

Assim que API/mídia estiverem configuradas, o mesmo frontend muda de DEMO para LIVE sem alteração de código. A site key do Turnstile é pública por definição; o secret nunca é exposto ao frontend.

Após cada publicação, o workflow do Pages executa um smoke test HTTP no endereço publicado, confirma a presença da identidade Tonecos Studios no HTML e valida o `site.webmanifest`. O workflow só termina com sucesso se a versão publicada estiver realmente acessível.

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
