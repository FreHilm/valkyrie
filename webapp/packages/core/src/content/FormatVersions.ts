/**
 * Port of `unity/Assets/Scripts/Content/FormatVersions.cs`.
 *
 * Quest file format versions, and the list of published MoM scenarios that
 * predate the base/conversion-kit split and therefore require the conversion
 * kit to be enabled.
 */

export const QuestFormatVersions = {
  RICH_TEXT: 16,
  SPLIT_BASE_MOM_AND_CONVERSION_KIT: 17,
  RELEASE_2_5_4: 18,
  RELEASE_3_0_0: 19,
  RELEASE_3_1_5: 20,
  RELEASE_3_2_0: 21,
} as const

export type QuestFormatVersion = (typeof QuestFormatVersions)[keyof typeof QuestFormatVersions]

export const CURRENT_QUEST_FORMAT: number = QuestFormatVersions.RELEASE_3_2_0

/** Lower-cased, matching the C#'s `ToLower(CultureInfo.InvariantCulture)`. */
export const SCENARIOS_THAT_REQUIRE_CONVERSION_KIT: ReadonlySet<string> = new Set(
  [
    'Artefatos_Roubados',
    'BelieveorDie1',
    'BlackWoodsSecrets',
    'DemoniosEntreLosWilson',
    'EditorCenario8',
    'EditorScenario3',
    'Escape',
    'HolyMansion',
    'Horror_Haunts_Merinda',
    'InTheDark',
    'La_Follia_di_Arkham',
    'Main_Street_Market_Mayham',
    'OMalqueNuncaDorme',
    'Saviors',
    'StrainOnReality',
    'Stressandstrain',
    'TheLairofRlimShaikorth',
    'TheRitualScenario',
    'TheRobberyOfTheKadakianIdol',
    'wiltshire',
  ].map((name) => name.toLowerCase()),
)

export function requiresConversionKit(scenarioName: string): boolean {
  return SCENARIOS_THAT_REQUIRE_CONVERSION_KIT.has(scenarioName.toLowerCase())
}
