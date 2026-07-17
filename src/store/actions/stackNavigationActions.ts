/**
 * Stack enter / breadcrumb navigation — composed from enter + navigate slices.
 */
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
import { createStackEnterActions } from './stackEnterActions'
import { createStackNavigateActions } from './stackNavigateActions'

export type StackNavigationActionKey = 'enterStack' | 'navigateToContainer'

export function createStackNavigationActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackNavigationActionKey> {
  return {
    ...createStackEnterActions(set, get),
    ...createStackNavigateActions(set, get),
  }
}