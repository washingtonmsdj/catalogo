import { isQuoteAdminRole, type QuoteAdminRole } from './quoteWorkflow.ts'

export type QuoteAdmin = { subject: string; email: string; role: QuoteAdminRole }
export type Principal = { email: string; role: QuoteAdminRole }
export type AdminAccessEnv = {
  QUOTE_ADMIN_ACCESS_ISSUER?: string
  QUOTE_ADMIN_ACCESS_AUDIENCE?: string
  QUOTE_ADMIN_ALLOWED_PRINCIPALS?: string
}
type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string }
type Jwks = { keys?: Jwk[] }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function accessIssuer(raw: string | undefined): string | null {
  if (!raw || raw.length > 220) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash
      || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname)) return null
    return url.origin
  } catch { return null }
}
function normalizedEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase()
  return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : null
}
/** Trusted server-side allowlist; JWT role claims are explicitly ignored. */
export function quoteAdminPrincipals(raw: string | undefined): Principal[] | null {
  if (!raw || raw.length > 10000) return null
  try {
    const decoded: unknown = JSON.parse(raw)
    if (!Array.isArray(decoded) || decoded.length < 1 || decoded.length > 30) return null
    const seen = new Set<string>()
    const principals: Principal[] = []
    for (const item of decoded) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string,unknown>
      if (typeof record.email !== 'string' || !isQuoteAdminRole(record.role)) return null
      const email = normalizedEmail(record.email)
      if (!email || seen.has(email)) return null
      seen.add(email)
      principals.push({ email, role: record.role })
    }
    return principals.some(item => item.role === 'owner') ? principals : null
  } catch { return null }
}
function bytes(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(part) || part.length > 12000) throw Error('invalid encoding')
  const normalized = part.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-part.length%4)%4)
  return Uint8Array.from(atob(normalized), character => character.charCodeAt(0))
}
function decodedJson(part: string): unknown {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(part))) as unknown
}
/** Cryptographic RS256 verification required before any personal information may be read. */
export async function verifyQuoteAdminAssertion(
  assertion: string | null, issuer: string, audience: string,
  principals: readonly Principal[], jwks: Jwks,
  now = Math.floor(Date.now()/1000),
): Promise<QuoteAdmin | null> {
  if (!assertion || assertion.length > 16000 || accessIssuer(issuer) !== issuer
    || !audience || audience.length > 512 || !Number.isSafeInteger(now)
    || !Array.isArray(jwks.keys)) return null
  try {
    const parts = assertion.split('.')
    if (parts.length !== 3) return null
    const rawHeader = decodedJson(parts[0])
    const rawClaims = decodedJson(parts[1])
    if (!rawHeader || typeof rawHeader !== 'object' || Array.isArray(rawHeader)
      || !rawClaims || typeof rawClaims !== 'object' || Array.isArray(rawClaims)) return null
    const header = rawHeader as Record<string,unknown>
    const claims = rawClaims as Record<string,unknown>
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
      || (header.typ !== undefined && header.typ !== 'JWT')) return null
    const matched = jwks.keys.find(key => key.kid === header.kid
      && key.kty === 'RSA' && key.n && key.e
      && (key.use === undefined || key.use === 'sig')
      && (key.alg === undefined || key.alg === 'RS256'))
    if (!matched) return null
    const key = await crypto.subtle.importKey('jwk',
      {kty:'RSA',n:matched.n,e:matched.e,alg:'RS256',ext:true},
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
    const signingInput = new TextEncoder().encode(parts[0]+'.'+parts[1])
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),signingInput)) return null
    if (claims.iss !== issuer
      || !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))
      || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512
      || typeof claims.email !== 'string'
      || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now
      || typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf > now+60
      || typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > now+60) return null
    const email = normalizedEmail(claims.email)
    if (!email) return null
    const permission = principals.find(item => item.email === email)
    return permission && isQuoteAdminRole(permission.role)
      ? {subject:claims.sub,email,role:permission.role} : null
  } catch { return null }
}
/** This boundary is not mounted on any public route in R25. Absent bindings deny access. */
export async function authenticateQuoteAdminRequest(
  request: Request, env: AdminAccessEnv, fetcher: typeof fetch = fetch,
): Promise<QuoteAdmin | null> {
  const issuer = accessIssuer(env.QUOTE_ADMIN_ACCESS_ISSUER)
  const audience = env.QUOTE_ADMIN_ACCESS_AUDIENCE
  const principals = quoteAdminPrincipals(env.QUOTE_ADMIN_ALLOWED_PRINCIPALS)
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!issuer || !audience || !principals || !token) return null
  try {
    const response = await fetcher(issuer+'/cdn-cgi/access/certs',
      {signal: AbortSignal.timeout(5000),cache:'no-store'})
    if (!response.ok) return null
    const jwks: unknown = await response.json()
    if (!jwks || typeof jwks !== 'object') return null
    return verifyQuoteAdminAssertion(token,issuer,audience,principals,jwks as Jwks)
  } catch { return null }
}
