import type { Json } from '@/lib/supabase/database.types'

export function submittedAnswersEditableFromSettings(settings: Json | null | undefined) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, Json>).submitted_answers_editable === true
}
