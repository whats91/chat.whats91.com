import 'server-only';

const EXCEL_CONTENT_TYPE = 'application/vnd.ms-excel; charset=utf-8';

type ExcelCellValue = string | number | boolean | null | undefined;

interface ExcelWorksheet {
  name: string;
  rows: ExcelCellValue[][];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeWorksheetName(name: string, usedNames: Set<string>): string {
  const cleanedBase = name.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';
  let candidate = cleanedBase.slice(0, 31);
  let suffix = 1;

  while (usedNames.has(candidate)) {
    const suffixText = ` ${suffix}`;
    candidate = `${cleanedBase.slice(0, Math.max(0, 31 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function resolveExcelCellType(value: ExcelCellValue): 'String' | 'Number' | 'Boolean' {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return 'Number';
  }

  if (typeof value === 'boolean') {
    return 'Boolean';
  }

  return 'String';
}

function stringifyExcelCellValue(value: ExcelCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return String(value);
}

export function buildExcelWorkbookBuffer(worksheets: ExcelWorksheet[]): Uint8Array {
  const usedNames = new Set<string>();

  const worksheetXml = worksheets
    .map((worksheet) => {
      const worksheetName = normalizeWorksheetName(worksheet.name, usedNames);
      const rowsXml = worksheet.rows
        .map((row, rowIndex) => {
          const cellsXml = row
            .map((cell) => {
              const type = resolveExcelCellType(cell);
              const value = escapeXml(stringifyExcelCellValue(cell));
              const styleId = rowIndex === 0 ? 'Header' : 'Cell';
              return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${type}">${value}</Data></Cell>`;
            })
            .join('');

          return `<Row>${cellsXml}</Row>`;
        })
        .join('');

      return `<Worksheet ss:Name="${escapeXml(worksheetName)}"><Table>${rowsXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions></Worksheet>`;
    })
    .join('');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Borders/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
   <Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
  </Style>
 </Styles>
 ${worksheetXml}
</Workbook>`;

  return new TextEncoder().encode(workbookXml);
}

export function getExcelContentType(): string {
  return EXCEL_CONTENT_TYPE;
}
