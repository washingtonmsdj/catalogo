# R25 — Contratos canônicos de gestão de orçamentos

## Base comprovada
O Worker público recebe POST /api/quotes, valida Turnstile, resolve IDs públicos e grava contato e itens no D1. A resposta pública confirma somente o registro com status técnico **received**. No D1, o estado inicial continua **new**. Não existe nesta etapa uma caixa de entrada autenticada ou envio de e-mail ao cliente.

## Fontes únicas de verdade (preparação, não ativação)
- worker/quoteWorkflow.ts define **new → in_review → response_recorded → closed**, permitindo também encerrar a partir de in_review. response_recorded quer dizer **resposta registrada internamente**, não envio ou entrega ao cliente.
- Os papéis são viewer (somente leitura), operator e owner (podem solicitar transições válidas). A futura operação deverá persistir ator e evento de auditoria em D1 junto à alteração.
- worker/quoteAdminAccess.ts valida assinatura **RS256** de JWT de Cloudflare Access por JWKS de uma equipe oficial, audience exata, issuer HTTPS, expiração, iat/nbf, subject, email e allowlist de papéis fornecida somente pelo servidor. A declaração de role no JWT não concede privilégio.
- Ausência ou ambiguidade de configuração, assinatura inválida, chave desconhecida, identidade fora da allowlist ou indisponibilidade do serviço retorna acesso negado.
- O CI testa criptografia real com chave RSA efêmera, adulterações, papéis, transições e falta de configuração. Nenhuma credencial é gravada no repositório.

## Limite de segurança
**Não foi publicada rota de administração.** Não há endpoint GET /api/admin/quotes, botão de Owner fictício, segredo de desenvolvimento, bypass local, nem UI com dados pessoais. A biblioteca de autenticação é preparatória e NÃO representa uma política Cloudflare Access já instalada.

## Pré-requisitos antes do painel do lojista
1. Configurar uma aplicação e política Cloudflare Access reais, com MFA e revogação, em uma origem administrativa aprovada.
2. Reconciliar no SSOT de infraestrutura as configurações QUOTE_ADMIN_ACCESS_ISSUER, QUOTE_ADMIN_ACCESS_AUDIENCE e QUOTE_ADMIN_ALLOWED_PRINCIPALS (allowlist privada), sem incluí-las no frontend.
3. Criar migração D1 versionada de status e histórico **imutável** de alterações com identidade do operador, operação atômica e gate migrate-before-worker.
4. Expor somente endpoints protegidos antes de qualquer leitura de dados pessoais; restringir campos, paginação, auditoria e rate limiting.
5. Acrescentar testes E2E de operador autorizado, token expirado, papel inadequado e mutações concorrentes. Só depois criar interface administrativa.

A preparação é intencionalmente separada da ativação em produção. Não há consulta pública de pedidos por protocolo.
