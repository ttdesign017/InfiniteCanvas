/**
 * Stack domain actions — composed from chrome / navigation / layout slices
 * so each file stays closer to a single responsibility.
 */
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
import { createStackChromeActions } from './stackChromeActions'
import { createStackNavigationActions } from './stackNavigationActions'
import { createStackLayoutActions } from './stackLayoutActions'

export type StackActionKey =
  | 'commitStackName'
  | 'getVisibleItems'
  | 'getVisibleStacks'
  | 'getBreadcrumb'
  | 'enterStack'
  | 'navigateToContainer'
  | 'updateStacks'
  | 'moveStacks'
  | 'animateToLayout'
  | 'quickStack'
  | 'mergeIntoStack'
  | 'dissolveSelectedStacks'
  | 'smoothLayout'
  | 'rowLayout'

export function createStackActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackActionKey> {
  return {
    ...createStackChromeActions(set, get),
    ...createStackNavigationActions(set, get),
    ...createStackLayoutActions(set, get),
  }
}
