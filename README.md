# Catálogo Tonecos Studios

Catálogo web escalável para 100 mil+ modelos/personagens, com navegação inspirada em seletores de personagens de fliperama e interface limpa/industrial.

**Preview público:** https://washingtonmsdj.github.io/catalogo/

## Arquitetura

- React + TypeScript + Vite no frontend.
- GitHub Pages como preview público contínuo.
- Cloudflare Worker para API, busca e formulários.
- Cloudflare D1 para categorias, franquias, modelos e solicitações.
- Cloudflare R2/CDN para variantes web e manifestos de galeria; imagens não ficam no GitHub.
- Cloudflare Turnstile para proteger o formulário público sem expor telefone/WhatsApp.
- Paginação por cursor para 100 mil+ modelos.
- FTS5 trigram para busca de substring sem varrer a tabela inteira.
- Galeria carregada separadamente e paginada; dezenas de imagens de um personagem não pesam na seleção principal.

## Imagens e duplicatas

A origem é somente leitura durante a ingestão. SHA-256 identifica duplicatas exatas e hash perceptual aponta equivalentes visuais dentro do mesmo modelo. Entre imagens equivalentes, o pipeline prioriza a versão de maior qualidade e preserva os arquivos mestres.

São geradas variantes WebP de `thumb`, `card` e `detail`; o original pode ser preservado no armazenamento mestre sem ser servido na grade do catálogo.

## Runtime

Sem configuração Cloudflare, o frontend funciona em modo `DEMO`. Com `VITE_API_BASE_URL` e `VITE_MEDIA_BASE_URL`, a mesma interface passa para `LIVE` e consome API/mídia reais.

No modo LIVE, solicitações de orçamento exigem Turnstile validado no Worker, aceitam no máximo 50 modelos e conferem server-side se todos os IDs enviados correspondem a modelos publicados.

## Deploy

O frontend publica automaticamente a cada mudança na `main`. O backend possui workflow próprio para aplicar migrações D1, publicar o Worker e provisionar o secret do Turnstile após o bootstrap inicial da conta Cloudflare.

Veja [`docs/CLOUDFLARE_DEPLOY.md`](docs/CLOUDFLARE_DEPLOY.md) para a configuração de produção.
