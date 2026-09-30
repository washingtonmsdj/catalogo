# Publicação na Cloudflare

A primeira interface pode ser publicada gratuitamente no Cloudflare Pages.

## Configuração do projeto

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Node: 22

O arquivo `public/_redirects` mantém o fallback da SPA e `public/_headers` adiciona cabeçalhos básicos de segurança/cache.

## Evolução full-stack

Quando o catálogo deixar de usar dados mock:

1. Cloudflare R2 recebe as variantes de imagens publicadas.
2. Cloudflare Worker expõe a API paginada do catálogo e o formulário de orçamento.
3. Banco armazena modelos, categorias, galerias, favoritos e solicitações.
4. Turnstile protege formulários públicos.
5. Login é integrado sem acoplar a navegação pública ao provedor de identidade.

## Regra importante

O frontend nunca deve receber a listagem completa de 100.000+ modelos. Busca, filtros e paginação devem ser resolvidos no backend por cursor/índice, retornando apenas a janela atual.
