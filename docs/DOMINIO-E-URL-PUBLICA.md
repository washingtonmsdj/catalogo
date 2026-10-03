# Domínio e URL pública

O frontend usa caminhos relativos (`base: './'`), portanto não depende do subcaminho `/catalogo/` para carregar JS, CSS, favicon ou manifest.

A URL pública usada em SEO e compartilhamento é controlada por:

`VITE_PUBLIC_SITE_URL`

No deploy oficial, `VITE_PUBLIC_SITE_URL` é obrigatória e vem de Repository Variables.
O workflow falha antes do build se ela estiver ausente.

O fallback interno do Vite existe somente para builds locais/isolados; produção não depende dele.

## Ao conectar domínio próprio

Configure a Repository Variable `VITE_PUBLIC_SITE_URL` com a origem final, por exemplo:

`https://catalogo.tonecosstudios.com.br/`

O build passa a gerar automaticamente:

- `rel=canonical` apontando para o domínio próprio;
- `og:url` apontando para o domínio próprio;
- assets continuam portáteis por usarem caminhos relativos.

O workflow do GitHub Pages testa o canonical depois do deploy. Se a URL configurada não aparecer no HTML publicado, o deploy não termina verde.

Não é necessário alterar código nem fazer fork da configuração para trocar entre preview e domínio próprio.
