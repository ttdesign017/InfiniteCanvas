/**
 * Move the bulk of navigateToContainer's exit path into runStackExitNavigation.
 * End marker: sibling `if (containerId === ROOT_CONTAINER_ID)` after the leave block.
 */
import fs from 'fs'

const navPath = 'src/store/actions/stackNavigateActions.ts'
const exitPath = 'src/store/actions/stackExitNavigation.ts'
const lines = fs
  .readFileSync(navPath, 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)

const idx = (re, from = 0) => {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}

const leaveIf = idx(/if \(leavingStack\) \{/)
const rootIf = idx(/if \(containerId === ROOT_CONTAINER_ID\) \{/, leaveIf + 1)
if (leaveIf < 0 || rootIf < 0) {
  throw new Error(`markers leave=${leaveIf} root=${rootIf}`)
}

// Inner body of if (leavingStack) { ... }  — lines leaveIf+1 .. rootIf-2 (blank + closing })
// Find the closing brace line of leavingStack if: line before rootIf that is just `    }`
let leaveClose = rootIf - 1
while (leaveClose > leaveIf && lines[leaveClose].trim() === '') leaveClose--
if (lines[leaveClose].trim() !== '}') {
  throw new Error(`expected closing brace at ${leaveClose + 1}: ${lines[leaveClose]}`)
}

const inner = lines.slice(leaveIf + 1, leaveClose).join('\n')

const exitFile = `/**
 * Stack exit navigation session — animated gather + handoff + multi-level fold.
 * Called from navigateToContainer when leaving a nested stack.
 */
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import {
  computeQuickStackBodies,
  stackGroupBounds,
  STACK_FOLDER_PAD,
} from '../../utils/layout'
import {
  freezeStackSurfaceZ,
  nestedStackUnitMaxZ,
  reflowContainerSurfaceZ,
} from '../../utils/zOrder'
import {
  containerOf,
  countLeafItemsInStack,
  folderBoundsFromFan,
  freeFanRelFromLocalFan,
  itemsInContainer,
  resolveNestedFreeFan,
  stackLabelName,
  stacksInContainer,
} from '../../utils/stacks'
import type { GetState, SetState } from '../canvasStoreTypes'

export function runStackExitNavigation(
  set: SetState,
  get: GetState,
  args: {
    leavingStack: StackRecord
    /** Final breadcrumb target (may be grandparent / home) */
    containerId: string
    wantAnim: boolean
  },
): void {
  const { leavingStack, containerId, wantAnim } = args
  const s = get()
  const leavingId = leavingStack.id
${inner}
}
`

fs.writeFileSync(exitPath, exitFile)

const before = lines.slice(0, leaveIf).join('\n')
const after = lines.slice(rootIf).join('\n')
const mid = `    if (leavingStack) {
      runStackExitNavigation(set, get, {
        leavingStack,
        containerId,
        wantAnim,
      })
      return
    }

`

let navOut = `${before}
${mid}
${after}
`

if (!navOut.includes("from './stackExitNavigation'")) {
  navOut = navOut.replace(
    `import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'`,
    `import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
import { runStackExitNavigation } from './stackExitNavigation'`,
  )
}

// navigate file can drop most exit-only imports after extract
const navSlim = `import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { withViewport } from '../../utils/stacks'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
import { runStackExitNavigation } from './stackExitNavigation'

export type StackNavigateActionKey = 'navigateToContainer'

export function createStackNavigateActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackNavigateActionKey> {
  return {
  navigateToContainer: (containerId, options) => {
    const s = get()
    if (containerId === s.currentContainerId) return
    // Silent folds may run while animating is still true at settle end —
    // only block user-driven animated nav when another anim is in flight.
    const wantAnim = options?.animate !== false
    if (wantAnim && s.animating) return

    const leavingId = s.currentContainerId
    const leavingStack =
      leavingId !== ROOT_CONTAINER_ID
        ? s.stacks.find((st) => st.id === leavingId)
        : null

    // Save viewport on current stack / home
    if (leavingId === ROOT_CONTAINER_ID) {
      set({ homeViewport: { ...s.viewport } })
    } else if (leavingStack) {
      set({
        stacks: s.stacks.map((st) =>
          st.id === leavingId ? withViewport(st, s.viewport) : st,
        ),
      })
    }

    if (leavingStack) {
      runStackExitNavigation(set, get, {
        leavingStack,
        containerId,
        wantAnim,
      })
      return
    }

${after}
`

fs.writeFileSync(navPath, navSlim)
console.log('exit lines', exitFile.split('\n').length)
console.log('nav lines', navSlim.split('\n').length)
console.log('inner lines', leaveIf + 2, '→', leaveClose)
