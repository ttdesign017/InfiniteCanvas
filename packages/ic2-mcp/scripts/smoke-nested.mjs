import { createSession, openBoard } from '../src/session.ts'
import { buildStackTree, listItems, getItem } from '../../../src/board-ops/index.ts'
import { ROOT_CONTAINER_ID } from '../../../src/types/canvas.ts'

const path = process.argv[2] || `${process.env.USERPROFILE}\\Desktop\\test.icanvas`
const s = createSession({ allowWrite: false, initialBoardPath: null })
const view = openBoard(s, path)
const tree = buildStackTree(view, { containerId: ROOT_CONTAINER_ID, depth: 4 })
const stackId = tree.roots[0]?.id
const nested = tree.roots[0]?.children ?? []
const inside = stackId
  ? listItems(view, { containerId: stackId, limit: 20 })
  : { total: 0, items: [] }
const rootList = listItems(view, { containerId: ROOT_CONTAINER_ID, limit: 20 })
const img = rootList.items.find((i) => i.media)
const detail = img ? getItem(view, { id: img.id }) : null
const j = detail ? JSON.stringify(detail) : ''

console.log(
  JSON.stringify(
    {
      path,
      stackId,
      nested: nested.map((c) => ({
        id: c.id,
        name: c.name,
        items: c.itemCount,
        childStacks: c.children.length,
      })),
      insideTotal: inside.total,
      insideSample: inside.items.slice(0, 8).map((i) => ({
        id: i.id,
        type: i.type,
        label: i.label,
      })),
      mediaDto: detail?.media ?? null,
      detailJsonLen: j.length,
      hasBase64InDetail: /base64|data:image|data:video/.test(j),
    },
    null,
    2,
  ),
)
