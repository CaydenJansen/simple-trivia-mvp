import readXlsxFile, { type CellValue, type SheetData } from 'read-excel-file/node'

import {
  IMPORT_SHEET_NAMES,
  type QuestionLibraryWorkbook,
  type WorkbookSheet,
} from './question-library-import'

function usableCellValue(value: CellValue | null): unknown {
  return value
}

function readSheet(data: SheetData): WorkbookSheet {
  const headers = (data[0] ?? []).map(value => String(value ?? '').trim())

  const rows: WorkbookSheet['rows'] = []
  for (let index = 1; index < data.length; index += 1) {
    const worksheetRow = data[index]
    const rowNumber = index + 1
    const values: Record<string, unknown> = {}
    let hasValue = false

    headers.forEach((header, index) => {
      if (!header) return
      const value = usableCellValue(worksheetRow[index] ?? null)
      values[header] = value
      if (value !== null && value !== undefined && String(value).trim() !== '') hasValue = true
    })

    if (hasValue) rows.push({ rowNumber, values })
  }

  return { headers: headers.filter(Boolean), rows }
}

export async function readQuestionLibraryWorkbook(filePath: string): Promise<QuestionLibraryWorkbook> {
  const workbook = await readXlsxFile(filePath)

  const result: QuestionLibraryWorkbook = {}
  for (const sheetName of IMPORT_SHEET_NAMES) {
    const worksheet = workbook.find(sheet => sheet.sheet === sheetName)
    if (worksheet) result[sheetName] = readSheet(worksheet.data)
  }
  return result
}
