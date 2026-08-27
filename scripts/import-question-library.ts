import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
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
    'Usage: npm run questions:import -- <workbook.xlsx> [--apply] [--replace] [--sql-output <file.sql>]',
    '',
    'The default is a dry run: the workbook is parsed and validated, but nothing is written.',
    'Use --apply only after the dry run has no errors.',
    'Use --replace to treat the workbook as the complete live library; omitted source rows are archived.',
    'Use --sql-output when applying through the Supabase SQL editor instead of a local service-role key.',
  ].join('\n')
}

function issueLine(issue: ImportIssue) {
  const location = [issue.sheet, issue.row ? `row ${issue.row}` : null, issue.column].filter(Boolean).join(' · ')
  return `${issue.severity === 'error' ? 'ERROR' : 'WARN '}  ${location}: ${issue.message} [${issue.code}]`
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const replace = args.includes('--replace')
  const sqlOutputIndex = args.indexOf('--sql-output')
  const sqlOutput = sqlOutputIndex >= 0 ? args[sqlOutputIndex + 1] : null
  const unknownFlags = args.filter(arg => arg.startsWith('--') && !['--apply', '--replace', '--sql-output'].includes(arg))
  const fileArgs = args.filter((arg, index) => !arg.startsWith('--') && index !== sqlOutputIndex + 1)

  if (unknownFlags.length > 0 || fileArgs.length !== 1 || (sqlOutputIndex >= 0 && !sqlOutput) || (sqlOutput && apply)) {
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
  console.log(`Ready: ${counts.questions} question(s), ${counts.questionParts} part(s), ${counts.bonuses} bonus(es), ${counts.tiebreakers} tiebreaker(s), ${counts.tagPhrases} tag assignment(s).`)
  if (counts.proposedTagPhrases > 0) {
    console.log(`${counts.proposedTagPhrases} unique tag phrase(s) may need bulk review; they will not block valid questions.`)
  }

  const bytes = await readFile(filePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  if (sqlOutput) {
    const outputPath = path.resolve(sqlOutput)
    const dollarTag = `$question_library_${sha256.slice(0, 12)}$`
    const escapedFileName = path.basename(filePath).replaceAll("'", "''")
    const functionName = replace ? 'replace_question_library_batch' : 'import_question_library_batch'
    const activateArgument = replace ? ',\n  true' : ''
    const sql = [
      'select public.' + functionName + '(',
      `  '${escapedFileName}',`,
      `  '${sha256}',`,
      `  ${dollarTag}${JSON.stringify(result.plan)}${dollarTag}::jsonb${activateArgument}`,
      ');',
      '',
    ].join('\n')
    await writeFile(outputPath, sql, 'utf8')
    console.log(`Validated SQL written to ${outputPath}`)
    console.log('Nothing was applied to the database.')
    return
  }

  if (!apply) {
    if (replace) console.log('Replacement dry run: applying this workbook will make it the complete active platform library and archive omitted source rows.')
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

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = replace
    ? await supabase.rpc('replace_question_library_batch', {
      p_file_name: path.basename(filePath),
      p_file_sha256: sha256,
      p_payload: result.plan,
      p_activate: true,
    })
    : await supabase.rpc('import_question_library_batch', {
      p_file_name: path.basename(filePath),
      p_file_sha256: sha256,
      p_payload: result.plan,
    })

  if (error) {
    console.error(`Import failed. The database transaction was rolled back: ${error.message}`)
    process.exitCode = 1
    return
  }

  const response = data as {
    reused?: boolean
    batch_id?: string
    proposed_tags?: number
    replacement?: boolean
    archived_questions?: number
    archived_tiebreakers?: number
    active_questions?: number
    active_tiebreakers?: number
  } | null
  if (response?.reused) {
    console.log(`This exact workbook was already imported. No records changed. Batch: ${response.batch_id ?? 'unknown'}`)
  } else {
    console.log(`Import complete. Batch: ${response?.batch_id ?? 'unknown'}`)
    if (response?.proposed_tags) console.log(`${response.proposed_tags} proposed tag phrase(s) are waiting for bulk review.`)
  }
  if (response?.replacement) {
    console.log(`Live library replaced: ${response.active_questions ?? counts.questions} active question(s), ${response.active_tiebreakers ?? counts.tiebreakers} active tiebreaker(s).`)
    console.log(`Archived ${response.archived_questions ?? 0} omitted question(s) and ${response.archived_tiebreakers ?? 0} omitted tiebreaker(s); saved quiz and game snapshots were not changed.`)
  }
}

void main()
