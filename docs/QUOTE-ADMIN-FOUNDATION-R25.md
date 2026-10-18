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

## R25b — Ledger auditável de mudanças de estado (migração 0021)

- A migração expansiva `0021_quote_admin_audit_events.sql` cria `quote_status_events` com revisão monotônica, ator Cloudflare Access, papel, transição e resposta interna opcional.
- `quote_requests.status` permanece **somente o estado inicial histórico** (`new`, ou estado legado já existente). Nunca atualize esse campo para progredir o pedido: o estado corrente é o `to_status` do último evento (`ORDER BY id DESC`), com fallback ao estado inicial.
- Triggers bloqueiam transição divergente/concorrente, sequência inválida, evento sem identidade, papel `viewer`, edição/apagamento do histórico e alterações diretas do estado inicial. A transição para `response_recorded` exige texto de resposta interna persistido; isso **não** implica envio ao cliente.
- `worker/quoteWorkflow.ts` segue o SSOT da máquina de estados. O teste SQLite verifica **todos os pares de estados** contra o contrato TypeScript, bloqueando divergências entre aplicação e banco.
- O contrato D1 e a política `migrate-before-worker` incluem a migração; o novo SQL é exclusivamente expansivo e compatível com o Worker público anterior.
- Nenhum endpoint admin, credencial ou interface de gestão é ativado por este passo. Ainda são exigidas a aplicação Cloudflare Access/MFA real, configuração privada e E2E antes do acesso a dados pessoais.

## R25c — Auditoria D1 alinhada ao schema e às aprovações

- A consulta estrutural usa uma relação `VALUES` derivada do contrato versionado, sem encadear `UNION ALL` e sem multiplicar parâmetros; isso evita os limites de termos e bind constatados no D1 remoto.
- A auditoria aceita nomes distintos na galeria **somente** quando houver aprovação explícita e imutável do par canônico/fonte, conforme o guard da migração 0020. Estados de publicação inválidos permanecem erros.
- O teste inclui 650 colunas e os casos de aprovação correta/incorreta. Não há escrita de dados na auditoria.
- A auditoria é obrigatória após cada deploy e alterações no verificador/contrato também acionam o workflow Cloudflare.


## Continuação R26

O serviço privado de listagem, leitura e transição auditável está preparado em `worker/quoteAdminApi.ts`, mas deliberadamente não registrado no Worker público. Regras, testes e bloqueios estão documentados em `docs/QUOTE-ADMIN-SERVICE-R26.md`. A ativação depende da aplicação Cloudflare Access real e do fluxo de autorização completo.
