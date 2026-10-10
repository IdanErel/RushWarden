/** A schema-valid card in JSON form (GDD §4 Roundabout), to mutate in tests. */
export function validCardJson(): Record<string, unknown> {
  return {
    id: 'test-roundabout',
    name: 'Test Roundabout',
    cost: 1,
    target: 'intersection',
    duration: 'round',
    rarity: 'common',
    tags: ['CHAOS'],
    effects: [{ kind: 'setController', controller: 'roundabout', capacity: 4 }],
    upgrade: { effects: [{ kind: 'setController', controller: 'roundabout', capacity: 6 }] },
    flavor: 'Nobody stops. Everybody yields. Mostly.',
  };
}
