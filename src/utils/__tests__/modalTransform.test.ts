import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import {
  applyModalTransform,
  beginModalTransform,
  canRotateOrScaleItem,
  itemCenter,
  snapRotationDeg,
} from '../modalTransform'

const media = (id: string, overrides: Partial<CanvasItem> = {}): CanvasItem =>
  ({
    id,
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    zIndex: 1,
    src: 'data:image/png;base64,AQID',
    naturalWidth: 100,
    naturalHeight: 80,
    ...overrides,
  }) as CanvasItem

const note = (id: string): CanvasItem => ({
  id,
  type: 'textcard',
  x: 0,
  y: 0,
  width: 160,
  height: 100,
  rotation: 0,
  zIndex: 1,
  content: 'note',
  fontSize: 14,
  color: '#111',
  backgroundColor: '#fff',
})

const viewport = { x: 0, y: 0, zoom: 1 }

describe('modal transform eligibility', () => {
  it('allows rotate/scale only on media, free text, and scribble', () => {
    expect(canRotateOrScaleItem(media('i'))).toBe(true)
    expect(
      canRotateOrScaleItem({
        ...media('t'),
        type: 'text',
        content: 'hi',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 400,
        color: '#000',
        backgroundColor: 'transparent',
      } as CanvasItem),
    ).toBe(true)
    expect(canRotateOrScaleItem(note('n'))).toBe(false)
  })

  it('refuses rotate session when selection is only notes', () => {
    const session = beginModalTransform(
      'rotate',
      [note('n1')],
      [],
      ['n1'],
      [],
      100,
      100,
      viewport,
    )
    expect(session).toBeNull()
  })

  it('allows grab session for notes', () => {
    const session = beginModalTransform(
      'grab',
      [note('n1')],
      [],
      ['n1'],
      [],
      50,
      50,
      viewport,
    )
    expect(session).not.toBeNull()
    expect(session?.kind).toBe('grab')
    expect(session?.itemIds).toEqual(['n1'])
  })
})

describe('rotation angle snap', () => {
  it('snaps to 15° steps (Shift+R contract)', () => {
    expect(snapRotationDeg(0)).toBe(0)
    expect(snapRotationDeg(7)).toBe(0)
    expect(snapRotationDeg(8)).toBe(15)
    expect(snapRotationDeg(22)).toBe(15)
    expect(snapRotationDeg(23)).toBe(30)
    // Math.round can yield -0; treat as zero
    expect(Math.abs(snapRotationDeg(-7))).toBe(0)
    expect(snapRotationDeg(-8)).toBe(-15)
  })
})

describe('apply modal grab / rotate', () => {
  it('moves free items by the pointer delta in grab mode', () => {
    const item = media('i1', { x: 10, y: 20 })
    const session = beginModalTransform(
      'grab',
      [item],
      [],
      ['i1'],
      [],
      0,
      0,
      viewport,
    )
    expect(session).not.toBeNull()

    const { itemPatches } = applyModalTransform(session!, 40, 15, viewport)
    expect(itemPatches).toEqual([{ id: 'i1', patch: { x: 50, y: 35 } }])
  })

  it('rotates a single media item around its center with angle snap', () => {
    const item = media('i1', { x: 0, y: 0, width: 100, height: 100, rotation: 0 })
    const center = itemCenter(item)
    // Pointer starts east of center
    const session = beginModalTransform(
      'rotate',
      [item],
      [],
      ['i1'],
      [],
      center.x + 100,
      center.y,
      viewport,
    )
    expect(session).not.toBeNull()
    expect(session!.pivot).toEqual(center)

    // Move pointer north of center → about +90° (screen y grows downward, so
    // atan2(negative dy) is -90°). Use angle snap to land on a 15° multiple.
    const { itemPatches } = applyModalTransform(
      session!,
      center.x,
      center.y - 100,
      viewport,
      { angleSnap: true },
    )
    expect(itemPatches).toHaveLength(1)
    const rot = itemPatches[0].patch.rotation as number
    // -90 % 15 is -0 in JS; abs avoids Object.is(+0, -0) failure
    expect(Math.abs(rot % 15)).toBe(0)
    // Center of item should stay at pivot for single-item rotate
    const patch = itemPatches[0].patch
    const nx = (patch.x as number) + 50
    const ny = (patch.y as number) + 50
    expect(nx).toBeCloseTo(center.x)
    expect(ny).toBeCloseTo(center.y)
  })

  it('moves stack folders in grab mode', () => {
    const stacks: StackRecord[] = [
      {
        id: 's1',
        parentId: 'root',
        name: 'Folder',
        x: 100,
        y: 100,
        width: 80,
        height: 60,
        zIndex: 2,
      },
    ]
    const session = beginModalTransform(
      'grab',
      [],
      stacks,
      [],
      ['s1'],
      0,
      0,
      viewport,
    )
    expect(session).not.toBeNull()

    const { stackPatches } = applyModalTransform(session!, 30, -10, viewport)
    expect(stackPatches).toEqual([{ id: 's1', patch: { x: 130, y: 90 } }])
  })
})
