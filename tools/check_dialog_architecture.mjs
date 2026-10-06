import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const controller = 'src/installDialogAccessibility.ts'

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const fullPath = join(directory, name)
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath]
  })
}

const sourceFiles = walk(srcRoot)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .map((path) => ({
    path,
    relativePath: relative(root, path).replaceAll('\\', '/'),
    content: readFileSync(path, 'utf8'),
  }))

const scrollLockOwners = sourceFiles
  .filter((file) => file.content.includes('document.body.style.overflow'))
  .map((file) => file.relativePath)

if (scrollLockOwners.length !== 1 || scrollLockOwners[0] !== controller) {
  console.error('Dialog scroll lock must have a single owner:', controller)
  console.error('Current owners:', scrollLockOwners.length ? scrollLockOwners.join(', ') : '(none)')
  process.exit(1)
}

const dialogController = sourceFiles.find((file) => file.relativePath === controller)?.content ?? ''
const requiredControllerTokens = [
  'visibleDialogs()',
  'bodyOverflowBeforeDialog',
  "document.body.style.overflow = 'hidden'",
  "event.key !== 'Tab'",
  "document.addEventListener('focusin'",
  'returnFocus',
]

for (const token of requiredControllerTokens) {
  if (!dialogController.includes(token)) {
    console.error(`Dialog controller is missing required behavior: ${token}`)
    process.exit(1)
  }
}

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
if (!main.includes("import { installDialogAccessibility } from './installDialogAccessibility'") || !main.includes('installDialogAccessibility()')) {
  console.error('Global dialog accessibility controller must be installed from src/main.tsx')
  process.exit(1)
}

console.log('Dialog architecture ready: focus trap, focus restoration and scroll lock share one controller.')
