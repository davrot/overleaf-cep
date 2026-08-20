import bibtexSchema from './bibtex-schema.json'

/**
 * BibTeX entry type definition and field metadata.
 */

export type BibEntry = {
  type: string
  id: string
  fields: Record<string, string>
}

export type BibEntryType = {
  name: string
  label: string
  requiredFields: Array<string | string[]>
  optionalFields: string[]
  defaultOptionalFields: string[]
}

export type BibtexSchema = {
  source: string
  supportedPublicationTypes: string[]
  allKnownFields: string[]
  publicationTypes: Record<
    string,
    {
      requiredFields: Array<string | string[]>
      optionalFields: string[]
      // Small per-type list of optional fields shown by default for NEW
      // entries (btxdoc-derived); the full optional list stays in optionalFields.
      defaultOptionalFields?: string[]
    }
  >
}

const schema = bibtexSchema as BibtexSchema

const toLabel = (name: string) => {
  switch (name) {
    case 'inbook':
      return 'In Book'
    case 'incollection':
      return 'In Collection'
    case 'inproceedings':
      return 'In Proceedings'
    case 'mastersthesis':
      return "Master's Thesis"
    case 'phdthesis':
      return 'PhD Thesis'
    case 'techreport':
      return 'Technical Report'
    case 'unpublished':
      return 'Unpublished'
    case 'misc':
      return 'Miscellaneous'
    default:
      return name.charAt(0).toUpperCase() + name.slice(1)
  }
}

export const ENTRY_TYPES: BibEntryType[] = schema.supportedPublicationTypes.map(
  typeName => ({
    name: typeName,
    label: toLabel(typeName),
    requiredFields: schema.publicationTypes[typeName].requiredFields,
    optionalFields: schema.publicationTypes[typeName].optionalFields,
    defaultOptionalFields:
      schema.publicationTypes[typeName].defaultOptionalFields || [],
  })
)

/** All known BibTeX field names */
export const ALL_FIELDS: readonly string[] = schema.allKnownFields

export function getEntryType(name: string): BibEntryType | undefined {
  return ENTRY_TYPES.find(t => t.name === name.toLowerCase())
}

/** Get all relevant fields for a given entry type (required + optional), preserving order */
export type RequiredFieldConstraint = string | string[]

export function getFieldsForType(typeName: string): string[] {
  const entryType = getEntryType(typeName)
  if (!entryType) return [...ALL_FIELDS]
  const requiredFields = entryType.requiredFields.flatMap(field =>
    Array.isArray(field) ? field : [field]
  )
  const fields = [...requiredFields, ...entryType.optionalFields]
  for (const f of ALL_FIELDS) {
    if (!fields.includes(f)) fields.push(f)
  }
  return fields
}

export function getMissingRequiredFields(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): Array<string | string[]> {
  return requiredFields.filter(field => {
    if (Array.isArray(field)) {
      return !field.some(f => fields[f]?.trim())
    }
    return !fields[field]?.trim()
  })
}

export function hasAllRequiredFields(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): boolean {
  return getMissingRequiredFields(requiredFields, fields).length === 0
}

/**
 * Flat required member fields for a type (OR-groups flattened).
 * Never contains array values — guard against the pseudo-field rendering bug
 * ("authoreditor"/"chapterpages" rows).
 */
export function flattenRequired(
  requiredFields: Array<string | string[]>
): string[] {
  return requiredFields.flatMap(field =>
    Array.isArray(field) ? field : [field]
  )
}

/**
 * Fields that should display a required-star, given the current values.
 * Rule (reviewer): a standalone required field shows a star while empty;
 * every member of an OR-group shows a star while ALL members are empty.
 * Returns a flat, order-preserving list of field names.
 */
export function requiredStarMembers(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): string[] {
  const members: string[] = []
  for (const field of requiredFields) {
    const list = Array.isArray(field) ? field : [field]
    if (list.every(f => !fields[f]?.trim())) {
      for (const f of list) {
        if (!members.includes(f)) members.push(f)
      }
    }
  }
  return members
}

/**
 * Fields to display for an entry form.
 * kind 'existing': required (flattened) + all optional + any known/unknown
 * field already carrying a value (never repeats a required member).
 * kind 'new':  required (flattened) + defaultOptionalFields only.
 * `showAll` always reveals required + optional + valued fields (allKnown
 * fields beyond that are Code-mode territory).
 */
export function displayFieldsFor(
  typeDef: BibEntryType | undefined,
  kind: 'existing' | 'new',
  valuedFields: Record<string, string>,
  showAll: boolean
): string[] {
  if (!typeDef) {
    const valued = Object.keys(valuedFields).filter(f => valuedFields[f]?.trim())
    return showAll ? valued : []
  }
  const requiredFlat = flattenRequired(typeDef.requiredFields)
  const valued = Object.keys(valuedFields).filter(f => valuedFields[f]?.trim())

  if (showAll) {
    const fields = [...requiredFlat, ...typeDef.optionalFields, ...valued]
    return fields.filter((f, i, all) => all.indexOf(f) === i)
  }

  if (kind === 'existing') {
    const fields = [...requiredFlat, ...typeDef.optionalFields, ...valued]
    return fields.filter((f, i, all) => all.indexOf(f) === i)
  }

  // new entry: required + the small default-optional list
  const fields = [...requiredFlat, ...typeDef.defaultOptionalFields, ...valued]
  return fields.filter((f, i, all) => all.indexOf(f) === i)
}
