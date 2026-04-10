import * as ex from 'excalibur'

enum Category {
  Ground =        0b0000_0001, // prettier-ignore
  Player =        0b0000_0010, // prettier-ignore
  Enemy =         0b0000_0100, // prettier-ignore
  Item =          0b0000_1000, // prettier-ignore
  PhysicalItem =  0b0001_0000, // prettier-ignore
  Hazard =        0b0010_0000, // prettier-ignore
  Climbable =     0b0100_0000, // prettier-ignore
}

export const CollisionGroup = {
  Ground: new ex.CollisionGroup(
    'ground',
    Category.Ground,
    collideWith(Category.Player, Category.Enemy, Category.PhysicalItem)
  ),
  Player: new ex.CollisionGroup(
    'player',
    Category.Player,
    collideWith(
      Category.Ground,
      Category.Enemy,
      Category.Item,
      Category.Hazard,
      Category.PhysicalItem,
      Category.Climbable
    )
  ),
  Enemy: new ex.CollisionGroup(
    'enemy',
    Category.Enemy,
    collideWith(Category.Ground, Category.Player)
  ),
  Hazard: new ex.CollisionGroup(
    'hazard',
    Category.Hazard,
    collideWith(Category.Player)
  ),
  Item: new ex.CollisionGroup(
    'item',
    Category.Item,
    collideWith(Category.Player)
  ),
  PhysicalItem: new ex.CollisionGroup(
    'phys-item',
    Category.PhysicalItem,
    collideWith(Category.Ground, Category.Player)
  ),
  Climbable: new ex.CollisionGroup(
    'climbable',
    Category.Climbable,
    collideWith(Category.Player)
  ),
}

/**
 * Combine multiple categories into a single bitmask
 */
function collideWith(...categories: Category[]) {
  return categories.reduce((acc, cat) => acc | cat, 0)
}
