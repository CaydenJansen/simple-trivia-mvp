import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../lib/supabase/database.types'
import {
  importPlanCounts,
  type ImportIssue,
  validateQuestionLibraryWorkbook,
} from '../lib/trivia/question-library-import'
import { readQuestionLibraryWorkbook } from '../lib/trivia/question-library-workbook'

function usage() {
  return [
    'Usage: npm run questions:import -- <workbook.xlsx> [--apply]',
    '',
    'The default is a dry run: the workbook is parsed and validated, but nothing is written.',
    'Use --apply only after the dry run has no errors.',
  ].join('\n')
}

function issueLine(issue: ImportIssue) {
  const location = [issue.sheet, issue.row ? `row ${issue.row}` : null, issue.column].filter(Boolean).join(' · ')
  return `${issue.severity === 'error' ? 'ERROR' : 'WARN '}  ${location}: ${issue.message} [${issue.code}]`
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const unknownFlags = args.filter(arg => arg.startsWith('--') && arg !== '--apply')
  const fileArgs = args.filter(arg => !arg.startsWith('--'))

  if (unknownFlags.length > 0 || fileArgs.length !== 1) {
    console.error(usage())
    process.exitCode = 1
    return
  }

  const filePath = path.resolve(fileArgs[0])
  if (path.extname(filePath).toLocaleLowerCase() !== '.xlsx') {
    console.error('Question Library imports must use the complete .xlsx workbook, not separate CSV tabs.')
    process.exitCode = 1
    return
  }

  let workbook
  try {
    workbook = await readQuestionLibraryWorkbook(filePath)
  } catch (error) {
    console.error(`Could not read workbook: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const result = validateQuestionLibraryWorkbook(workbook)
  result.issues.forEach(issue => console.log(issueLine(issue)))

  const errorCount = result.issues.filter(issue => issue.severity === 'error').length
  const warningCount = result.issues.filter(issue => issue.severity === 'warning').length
  console.log(`\nValidation: ${errorCount} error(s), ${warningCount} warning(s).`)

  if (!result.valid || !result.plan) {
    console.error('Nothing was imported. Fix every error and run the dry run again.')
    process.exitCode = 1
    return
  }

  const counts = importPlanCounts(result.plan)
  console.log(`Ready: ${counts.questions} question(s), ${counts.questionParts} part(s), ${counts.bonuses} bonus(es), ${counts.tiebreakers} tiebreaker(s), ${counts.tags} tag definition(s).`)

  if (!apply) {
    console.log('Dry run complete. Nothing was written. Re-run with --apply when this report is acceptable.')
    return
  }

  loadEnvConfig(process.cwd())
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Applying an import requires NEXT_PUBLIC_SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY in the local environment.')
    process.exitCode = 1
    return
  }

  const bytes = await readFile(filePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.rpc('import_question_library_batch', {
    p_file_name: path.basename(filePath),
    p_file_sha256: sha256,
    p_payload: result.plan,
  })

  if (error) {
    console.error(`Import failed. The database transaction was rolled back: ${error.message}`)
    process.exitCode = 1
    return
  }

  const response = data as { reused?: boolean; batch_id?: string } | null
  if (response?.reused) {
    console.log(`This exact workbook was already imported. No records changed. Batch: ${response.batch_id ?? 'unknown'}`)
  } else {
    console.log(`Import complete. Batch: ${response?.batch_id ?? 'unknown'}`)
  }
}

void main()
