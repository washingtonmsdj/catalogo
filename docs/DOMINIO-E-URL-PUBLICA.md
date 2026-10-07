# Domínio e URL pública

O Catálogo é publicado como uma aplicação independente, mas a URL pública canônica pertence ao domínio do Achegue-se:

`https://acheguese.com.br/tonecosstudios/`

Os repositórios continuam independentes. O Achegue-se é responsável pelo mount público em `/tonecosstudios/` e o Catálogo continua responsável pelo seu frontend, API, mídia, dados e pipeline de publicação.

## Fonte única de verdade

A URL pública usada em SEO e compartilhamento é versionada em:

`config/public-runtime.json`

Esse arquivo é o SSOT do endereço canônico do Catálogo. O `vite.config.ts` lê `publicRuntime.publicSiteUrl` para gerar automaticamente:

- `rel=canonical`;
- `og:url`;
- os metadados públicos que dependem da origem canônica.

Não existe variável `VITE_PUBLIC_SITE_URL` no contrato de produção. Alterar o endereço público exige uma mudança versionada e revisável em `config/public-runtime.json`, evitando divergência silenciosa entre deploy, SEO e documentação.

## Portabilidade do frontend

O frontend usa caminhos relativos (`base: './'`). Por isso, JS, CSS, favicon e manifest continuam funcionando quando o build é servido pelo mount `/tonecosstudios/` do Achegue-se, sem copiar o código do Catálogo para o outro repositório.

A API e a mídia permanecem configurações de runtime independentes, fornecidas no deploy por:

- `VITE_API_BASE_URL`;
- `VITE_MEDIA_BASE_URL`;
- `VITE_TURNSTILE_SITE_KEY`.

Quando o Catálogo roda sob `acheguese.com.br`, o frontend usa o proxy first-party `/catalogo-api` para a API pública. O upstream real continua pertencendo ao Catálogo.

## Contrato com o Achegue-se

No repositório Achegue-se, o mount público deve preservar esta ordem:

1. `/catalogo` redireciona permanentemente para `/tonecosstudios/`;
2. `/catalogo/:path*` é encaminhado para a origem publicada do frontend do Catálogo;
3. `/catalogo-api/:path*` é encaminhado para o Worker público do Catálogo;
4. somente depois vem o catch-all da SPA principal do Achegue-se.

O owner desse roteamento no Achegue-se é `src/shared/config/publicExternalApps.config.ts`; o `vercel.json` é derivado/validado a partir desse contrato e não deve virar uma segunda fonte de verdade.

## Validação de publicação

O workflow do GitHub Pages lê `config/public-runtime.json` e faz smoke test do HTML publicado. O deploy só fica verde quando o `canonical` gerado corresponde exatamente a `https://acheguese.com.br/tonecosstudios/`.

Assim, preview técnico, origem de hospedagem e URL pública canônica podem ser diferentes sem duplicar configuração nem acoplar os dois projetos.
