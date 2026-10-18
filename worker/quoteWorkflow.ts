/** Canonical workflow; internal DB status starts at new. No customer-facing tracking implied. */
export const QUOTE_STATUSES = ['new','in_review','response_recorded','closed'] as const
export type QuoteStatus = typeof QUOTE_STATUSES[number]
export const QUOTE_ADMIN_ROLES = ['viewer','operator','owner'] as const
export type QuoteAdminRole = typeof QUOTE_ADMIN_ROLES[number]
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus,readonly QuoteStatus[]>> = {
  new: ['in_review'],
  in_review: ['response_recorded','closed'],
  response_recorded: ['closed'],
  closed: [],
}
export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === 'string' && QUOTE_STATUSES.some(item => item === value)
}
export function isQuoteAdminRole(value: unknown): value is QuoteAdminRole {
  return typeof value === 'string' && QUOTE_ADMIN_ROLES.some(item => item === value)
}
export function canReadQuote(role: unknown): role is QuoteAdminRole {
  return isQuoteAdminRole(role)
}
export function canTransitionQuote(from: unknown, to: unknown, role: unknown): boolean {
  return isQuoteAdminRole(role) && role !== 'viewer'
    && isQuoteStatus(from) && isQuoteStatus(to)
    && QUOTE_TRANSITIONS[from].some(item => item === to)
}
