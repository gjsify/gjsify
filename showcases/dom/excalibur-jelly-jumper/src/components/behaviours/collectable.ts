import * as ex from 'excalibur'

/**
 * Represents an entity that can be picked up by the player
 */
export class CollectableComponent extends ex.Component {
  isCollected = false
  isCollectable = true
}
