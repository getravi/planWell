import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((cell) =>
          typeof cell === "string" && (cell.includes(",") || cell.includes('"'))
            ? `"${cell.replace(/"/g, '""')}"`
            : String(cell),
        )
        .join(","),
    )
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}

// First two columns are text (Department, Account); remainder are numeric months.
const LABEL_COLS = 2;

export async function exportXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  // Header row
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, col) => {
    cell.font = { bold: true, size: 11, color: { argb: "FF66736A" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBFCF9" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFDCE3DC" } } };
    cell.alignment = { vertical: "middle", horizontal: col <= LABEL_COLS ? "left" : "right" };
  });
  headerRow.height = 28;

  // Data rows
  rows.forEach((row) => {
    const wsRow = ws.addRow(row);
    wsRow.eachCell((cell, col) => {
      if (col > LABEL_COLS) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
      cell.border = { bottom: { style: "hair", color: { argb: "FFDCE3DC" } } };
    });
    wsRow.height = 22;
  });

  // Column widths
  ws.columns.forEach((col, i) => {
    const allValues = [headers[i] ?? "", ...rows.map((r) => String(r[i] ?? ""))];
    const maxLen = allValues.reduce((m, v) => Math.max(m, v.length), 0);
    col.width = Math.min(Math.max(maxLen + 2, 10), 32);
  });

  // Freeze header row
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}

export function exportPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(12);
  doc.text(title, 14, 15);
  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map(String)),
    startY: 22,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [241, 245, 241], textColor: [100, 115, 106], fontStyle: "bold" },
  });
  doc.save(filename);
}
