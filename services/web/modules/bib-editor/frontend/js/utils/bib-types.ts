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
  })
)

/** All known BibTeX field names */
export const ALL_FIELDS = schema.allKnownFields as const

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
