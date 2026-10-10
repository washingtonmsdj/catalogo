import { setTimeout as sleep } from 'node:timers/promises'

export async function runBoundedRetry(operation, {
  attempts = 5,
  delayMs = 2_000,
  sleepImpl = sleep,
  onRetry = () => {},
} = {}) {
  if (typeof operation !== 'function') throw new Error('operation must be a function')
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error('attempts must be an integer between 1 and 20')
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 30_000) {
    throw new Error('delayMs must be an integer between 0 and 30000')
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      onRetry({ attempt, attempts, delayMs, error })
      await sleepImpl(delayMs)
    }
  }

  throw new Error(
    `Operation failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  )
}
