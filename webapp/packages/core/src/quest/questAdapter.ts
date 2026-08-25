/**
 * Turns parsed quest components into what the engine consumes.
 *
 * `loadQuestSections` produces `QuestComponent` objects that mirror the ini;
 * `EventManager`, `QuestRuntime` and `RoundController` each want a narrower
 * view. In the C# there is no adapter because everything reaches into the same
 * `QuestData.components` dictionary at runtime — which is why nothing there can
 * be tested without a whole quest loaded.
 *
 * Keeping the conversion in one place also makes it visible: an adapter is
 * where a field quietly goes missing, so each one is named rather than spread.
 */

import type { EventDefinition } from './EventManager.js'
import type { QuestComponentData } from './QuestRuntime.js'
import type { MonsterTypeView, QuestActivation } from './RoundController.js'
import type { ActivationView } from './ActivationInstance.js'
import {
  Activation,
  CustomMonster,
  Door,
  QItem,
  QuestComponent,
  QuestEvent,
  Tile,
  Token,
} from './QuestComponent.js'

/** `Activation` sections, keyed without the `Activation` prefix. */
export function questActivations(
  components: ReadonlyMap<string, QuestComponent>,
): Map<string, QuestActivation> {
  const result = new Map<string, QuestActivation>()
  for (const [name, component] of components) {
    if (!(component instanceof Activation)) continue
    const view: ActivationView = {
      sectionName: name,
      ability: component.ability,
      minionActions: component.minionActions,
      masterActions: component.masterActions,
      moveButton: component.moveButton,
      move: component.move,
      minionFirst: component.minionFirst,
      masterFirst: component.masterFirst,
    }
    result.set(name.slice('Activation'.length), { ...view, tests: component.tests })
  }
  return result
}

/**
 * `CustomMonster` sections as the round controller sees them.
 *
 * `useMonsterTypeActivations` is false exactly when the monster names its own
 * activations — the C# derives it the same way, from whether the `activation`
 * field was present.
 */
export function questMonsterTypes(
  components: ReadonlyMap<string, QuestComponent>,
): Map<string, MonsterTypeView> {
  const result = new Map<string, MonsterTypeView>()
  for (const [name, component] of components) {
    if (!(component instanceof CustomMonster)) continue
    result.set(name, {
      sectionName: name,
      activations: component.activations,
      derivedType: component.baseMonster,
      useMonsterTypeActivations: component.activations.length === 0,
    })
  }
  return result
}

/** Board and item components, as `QuestRuntime` needs them. */
export function questComponentData(
  components: ReadonlyMap<string, QuestComponent>,
): Map<string, QuestComponentData> {
  const result = new Map<string, QuestComponentData>()
  for (const [name, component] of components) {
    const type = component.typeDynamic
    const data: QuestComponentData = { sectionName: name, type }

    if (component.locationSpecified) data.location = component.location
    if (component instanceof Tile || component instanceof Token || component instanceof Door) {
      data.rotation = component.rotation
    }
    // A QItem with no `inspect` is still an item; it just cannot be examined.
    if (component instanceof QItem && component.inspect.length > 0) {
      data.inspect = component.inspect
    }
    result.set(name, data)
  }
  return result
}

/**
 * Events as the engine runs them.
 *
 * DEVIATION-adjacent, and worth naming: a button's own `operations` are *not*
 * carried across, because nothing in the C# ever performs them. The editor
 * writes them and `QuestButtonData` holds them, but the only `vars.Perform`
 * call for an event is on the event itself (`EventManager.cs:219`). Carrying
 * them would make the port do something the game does not.
 */
export function questEvents(
  components: ReadonlyMap<string, QuestComponent>,
): Map<string, EventDefinition> {
  const result = new Map<string, EventDefinition>()
  for (const [name, component] of components) {
    if (!(component instanceof QuestEvent)) continue
    const definition: EventDefinition = {
      sectionName: name,
      trigger: component.trigger,
      tests: component.tests,
      buttons: component.buttons.map((button) => ({ eventNames: button.eventNames })),
      randomEvents: component.randomEvents,
      addComponents: component.addComponents,
      removeComponents: component.removeComponents,
    }
    if (component.operations !== null) definition.operations = component.operations
    if (component.audio.length > 0) definition.audio = component.audio
    result.set(name, definition)
  }
  return result
}

/** Everything the engine needs from a loaded quest, built in one pass. */
export interface QuestBundle {
  events: Map<string, EventDefinition>
  components: Map<string, QuestComponentData>
  activations: Map<string, QuestActivation>
  monsterTypes: Map<string, MonsterTypeView>
}

export function bundleQuest(components: ReadonlyMap<string, QuestComponent>): QuestBundle {
  return {
    events: questEvents(components),
    components: questComponentData(components),
    activations: questActivations(components),
    monsterTypes: questMonsterTypes(components),
  }
}
