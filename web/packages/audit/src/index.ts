/**
 * How recorded changes read, for Administration's Audit log and the Changes
 * on the staff app's records: each action, the fields before and after, and
 * where and by whom it was made, in the language in use.
 */
export { ChangeDetail, ChangeList, ChangedFields, RecordChanges, changedBy } from './changes.tsx'
export { type DescribeOptions, type FieldChange, areaLabel, auditChanges, auditTitle, deviceText, sourceLabel } from './describe.ts'
export { type AuditText, auditText } from './text.ts'
