# R26 — Serviço de atendimento de orçamentos (isolado)

## Limite de ativação

O Cloudflare Access ainda não estava habilitado na conta Tonecos Studio na checagem anterior. Por isso, este módulo **não está montado** em worker/index.ts nem em worker/entry.ts. Nenhuma rota de administração está publicada. Não existe UI administrativa fictícia.

O módulo worker/quoteAdminApi.ts exige, além do Access, QUOTE_ADMIN_ROUTE_ENABLED='true'. O binding não está incluído no wrangler.jsonc nem no deploy, portanto a função responde 404 antes de fazer consulta ao D1 ou ao JWKS.

## Contrato interno, ainda não exposto na rede

- GET /api/admin/quotes: paginação keyset limitada a 25, trazendo protocolo, status, revisão, data e número de itens; sem IDs internos ou contato do cliente.
- GET /api/admin/quotes/:reference: detalhe pessoal e histórico somente para viewer/operator/owner com JWT RS256 Cloudflare Access válido.
- POST /api/admin/quotes/:reference/transitions: espera expectedStatus, expectedRevision, toStatus e, apenas para response_recorded, responseText. Viewer não pode escrever.

O estado corrente deriva de quote_status_events, sem mutar quote_requests.status. A revisão esperada é conferida antes da operação e novamente no INSERT condicional; o trigger R25 verifica atomicamente a transição. Uma resposta registrada internamente **não é mensagem entregue ao cliente**.

Todas as respostas exigem autenticação antes de consultas pessoais, usam no-store, não ativam CORS e não expõem o UUID interno do orçamento.

## Pré-requisitos para ativar

1. Habilitar Zero Trust/Access, configurar aplicação privada na origem administrativa, MFA, política restritiva e revogação.
2. Configurar issuer/audience reais e allowlist privada de operadores, e conciliar esses bindings com o SSOT de deploy, sem colocar segredos no frontend.
3. Testar autorização e revogação com a política real, proteger a origem administrativa por Access, registrar auditoria de leitura e rate limiting.
4. Executar E2E real de JWT expiração/forja, estados, concorrência, respostas, direitos de privacidade e filtragem, antes de registrar a rota.
5. Somente depois desenvolver o painel privado e habilitar o serviço com uma publicação explícita.

## Verificação

npm run test:quote-admin testa a fundação R25 e o serviço R26 com tokens RSA assinados; tools/test_quote_audit_schema.py exercita a migração D1 em SQLite real.

A vitrine pública e POST /api/quotes não foram modificados.

## R26a — Diagnóstico de publicação staged

A primeira tentativa de publicar a R26 retornou HTTP 503 na verificação de saúde da versão staged, antes de qualquer promoção, e o workflow restaurou a versão pública anterior. Não foram alterados os dados pessoais nem ativada a administração. O status do PR no GitHub não prova o sucesso do deploy Cloudflare.

O verificador de saúde agora retorna **somente metadados estruturais limitados** quando o Worker responde 503 (migrações e estruturas ausentes, se a resposta trouxer esse contrato). Tokens, dados pessoais, headers e corpo HTTP bruto continuam excluídos dos logs. Os gates de staging, promoção e rollback permanecem obrigatórios; não se converte 503 em sucesso.
