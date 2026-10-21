"use client";
import { brandName } from "./brand";
import { loadVenueInfo } from "./use-venue-info";

/**
 * Satu bentuk laporan untuk semua format unduhan (Excel, PDF, CSV).
 * Halaman laporan cukup menyusun baris sekali; setiap format menggambarnya sendiri.
 */
export type ReportCell = string | number | null;
export type ReportColumn = { header:string; kind?:"text"|"money"|"date"; width?:number };
/**
 * group: judul kelompok (Pendapatan, Harta, …), subtotal: total per kelompok,
 * total: angka akhir laporan (laba bersih, total harta), blank: baris kosong pemisah.
 */
export type ReportRow = { kind?:"line"|"group"|"subtotal"|"total"|"blank"; cells:ReportCell[] };
export type ReportDoc = {
  title:string;
  /** Nama file tanpa ekstensi. */
  filename:string;
  meta:[string,string][];
  columns:ReportColumn[];
  rows:ReportRow[];
  notes?:string[];
  landscape?:boolean;
};
export type ExportFormat = "xlsx" | "pdf" | "csv";

const line = (...cells:ReportCell[]):ReportRow => ({ kind:"line", cells });
export const row = {
  line,
  group: (label:string):ReportRow => ({ kind:"group", cells:[label] }),
  subtotal: (...cells:ReportCell[]):ReportRow => ({ kind:"subtotal", cells }),
  total: (...cells:ReportCell[]):ReportRow => ({ kind:"total", cells }),
  blank: ():ReportRow => ({ kind:"blank", cells:[] }),
};

const rupiah = new Intl.NumberFormat("id-ID",{ maximumFractionDigits:0 });
/** Rp tanpa spasi tak-putus, supaya aman untuk huruf standar PDF. */
const moneyText = (value:number) => `${value<0?"-":""}Rp${rupiah.format(Math.abs(value))}`;
const dateText = (value:string) => {
  const [year,month,day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};
const isoDate = (value:ReportCell) => typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

function cellText(cell:ReportCell, column?:ReportColumn) {
  if (cell===null || cell===undefined) return "";
  if (typeof cell==="number") return column?.kind==="money" ? moneyText(cell) : rupiah.format(cell);
  if (column?.kind==="date" && isoDate(cell)) return dateText(cell);
  return cell;
}

async function venue() {
  try {
    const { info } = await loadVenueInfo();
    return { name: brandName(info), address: info.address || "" };
  } catch { return { name: brandName(null), address:"" } }
}

function printedAt() {
  return new Date().toLocaleString("id-ID",{ day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function save(blob:Blob, filename:string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- CSV ---------------------------------------------------------------------

export function csvBlob(doc:ReportDoc) {
  const escape = (cell:ReportCell) => cell===null ? "" : typeof cell==="number" ? String(cell) : `"${cell.replace(/"/g,'""')}"`;
  const rows:ReportCell[][] = [
    [doc.title], ...doc.meta.map(([label,value]) => [label,value]), [],
    doc.columns.map(column => column.header),
    ...doc.rows.map(item => item.kind==="group" ? [item.cells[0] ?? ""] : item.cells),
    ...(doc.notes?.length ? [[], ...doc.notes.map(note => [note])] : []),
  ];
  const body = rows.map(cells => cells.map(escape).join(";")).join("\r\n");
  return new Blob(["﻿"+body],{ type:"text/csv;charset=utf-8" });
}

// --- Excel -------------------------------------------------------------------

export async function xlsxBlob(doc:ReportDoc) {
  const [{ default:ExcelJS }, place] = await Promise.all([import("exceljs"), venue()]);
  const book = new ExcelJS.Workbook();
  book.creator = place.name;
  book.created = new Date();
  const sheet = book.addWorksheet(doc.title.replace(/[\\/?*[\]:]/g," ").slice(0,31), {
    pageSetup:{ paperSize:9, orientation: doc.landscape ? "landscape" : "portrait", fitToPage:true, fitToWidth:1, fitToHeight:0,
      margins:{ left:0.5, right:0.5, top:0.6, bottom:0.6, header:0.3, footer:0.3 } },
    headerFooter:{ oddFooter:`&L${doc.title}&RHalaman &P dari &N` },
  });
  const span = doc.columns.length;
  const moneyFormat = '"Rp"#,##0;[Red]-"Rp"#,##0;"Rp"0';
  const border = { style:"thin" as const, color:{ argb:"FFBFBFBF" } };

  sheet.columns = doc.columns.map(column => ({ width: column.width ?? (column.kind==="money" ? 20 : column.kind==="date" ? 12 : 22) }));
  const title = (text:string, size:number, bold:boolean, color="FF000000") => {
    const added = sheet.addRow([text]);
    sheet.mergeCells(added.number,1,added.number,span);
    added.getCell(1).font = { size, bold, color:{ argb:color } };
    return added;
  };
  title(place.name, 10, false, "FF595959");
  title(doc.title, 15, true);
  for (const [label,value] of doc.meta) {
    const added = sheet.addRow([`${label}: ${value}`]);
    sheet.mergeCells(added.number,1,added.number,span);
    added.getCell(1).font = { size:10, color:{ argb:"FF404040" } };
  }
  sheet.addRow([]);

  const head = sheet.addRow(doc.columns.map(column => column.header));
  head.eachCell((cell,index) => {
    cell.font = { bold:true, color:{ argb:"FFFFFFFF" } };
    cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF1F3A5F" } };
    cell.alignment = { vertical:"middle", horizontal: doc.columns[index-1]?.kind==="money" ? "right" : "left" };
    cell.border = { bottom:border };
  });
  head.height = 20;
  sheet.views = [{ state:"frozen", ySplit:head.number }];
  sheet.pageSetup.printTitlesRow = `${head.number}:${head.number}`;

  for (const item of doc.rows) {
    if (item.kind==="blank") { sheet.addRow([]); continue }
    if (item.kind==="group") {
      const added = sheet.addRow([item.cells[0]]);
      sheet.mergeCells(added.number,1,added.number,span);
      added.getCell(1).font = { bold:true, color:{ argb:"FF1F3A5F" } };
      added.getCell(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFEAF0F7" } };
      continue;
    }
    const values = doc.columns.map((column,index) => {
      const cell = item.cells[index] ?? null;
      if (column.kind==="date" && isoDate(cell)) return new Date(`${cell}T00:00:00Z`);
      return cell;
    });
    const added = sheet.addRow(values);
    doc.columns.forEach((column,index) => {
      const cell = added.getCell(index+1);
      if (column.kind==="money") { cell.numFmt = moneyFormat; cell.alignment = { horizontal:"right", vertical:"top" } }
      if (column.kind==="date") cell.numFmt = "dd/mm/yyyy";
      if (column.kind!=="money") cell.alignment = { vertical:"top", wrapText:true };
      if (item.kind==="subtotal" || item.kind==="total") {
        cell.font = { bold:true };
        cell.border = { top:border, ...(item.kind==="total" ? { bottom:{ style:"double" as const } } : {}) };
      }
      if (item.kind==="total") cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFF2F2F2" } };
    });
  }

  sheet.addRow([]);
  for (const note of [...(doc.notes ?? []), `Diunduh ${printedAt()}`]) {
    const added = sheet.addRow([note]);
    sheet.mergeCells(added.number,1,added.number,span);
    added.getCell(1).font = { italic:true, size:9, color:{ argb:"FF7F7F7F" } };
    added.getCell(1).alignment = { wrapText:true, vertical:"top" };
    added.height = Math.max(15, Math.ceil(note.length/110)*13);
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer],{ type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// --- PDF ---------------------------------------------------------------------

export async function pdfBlob(doc:ReportDoc) {
  const [{ jsPDF }, { autoTable }, place] = await Promise.all([import("jspdf"), import("jspdf-autotable"), venue()]);
  const pdf = new jsPDF({ orientation: doc.landscape ? "landscape" : "portrait", unit:"mm", format:"a4" });
  const width = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;
  pdf.setFont("helvetica","bold"); pdf.setFontSize(9); pdf.setTextColor(90);
  pdf.text(place.name.toUpperCase(), margin, y);
  if (place.address) { pdf.setFont("helvetica","normal"); pdf.setFontSize(8); y += 4; pdf.text(pdf.splitTextToSize(place.address, width-margin*2)[0] ?? "", margin, y) }
  y += 8;
  pdf.setFont("helvetica","bold"); pdf.setFontSize(15); pdf.setTextColor(20);
  pdf.text(doc.title, margin, y);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(9); pdf.setTextColor(70);
  for (const [label,value] of doc.meta) { y += 5; pdf.text(`${label}: ${value}`, margin, y) }
  y += 4;
  pdf.setDrawColor(200); pdf.line(margin, y, width-margin, y);

  const span = doc.columns.length;
  const body = doc.rows.map(item => {
    if (item.kind==="blank") return [{ content:"", colSpan:span, styles:{ minCellHeight:3, cellPadding:0 } }];
    if (item.kind==="group") return [{ content:String(item.cells[0] ?? ""), colSpan:span }];
    return doc.columns.map((column,index) => cellText(item.cells[index] ?? null, column));
  });
  const kinds = doc.rows.map(item => item.kind ?? "line");
  const columnStyles = Object.fromEntries(doc.columns.map((column,index) => [index, {
    halign: column.kind==="money" ? "right" as const : "left" as const,
    ...(column.kind==="money" || column.kind==="date" ? { cellWidth:"wrap" as const } : {}),
  }]));
  autoTable(pdf, {
    startY: y+4,
    head: [doc.columns.map(column => column.header)],
    body,
    theme: "plain",
    margin: { left:margin, right:margin, bottom:16 },
    styles: { font:"helvetica", fontSize:8.5, cellPadding:{ top:1.6, bottom:1.6, left:2, right:2 }, textColor:30, overflow:"linebreak" },
    headStyles: { fillColor:[31,58,95], textColor:255, fontStyle:"bold" },
    columnStyles,
    didParseCell: data => {
      if (data.section==="head") {
        if (doc.columns[data.column.index]?.kind==="money") data.cell.styles.halign = "right";
        return;
      }
      if (data.section!=="body") return;
      const kind = kinds[data.row.index];
      if (kind==="group") { data.cell.styles.fontStyle = "bold"; data.cell.styles.fillColor = [234,240,247]; data.cell.styles.textColor = [31,58,95] }
      if (kind==="subtotal" || kind==="total") data.cell.styles.fontStyle = "bold";
      if (kind==="total") data.cell.styles.fillColor = [242,242,242];
      const raw = doc.rows[data.row.index]?.cells[data.column.index];
      if (typeof raw==="number" && raw<0 && doc.columns[data.column.index]?.kind==="money") data.cell.styles.textColor = [176,32,32];
    },
    didDrawCell: data => {
      if (data.section!=="body") return;
      const kind = kinds[data.row.index];
      if (kind==="subtotal" || kind==="total") {
        pdf.setDrawColor(150); pdf.setLineWidth(0.2);
        pdf.line(data.cell.x, data.cell.y, data.cell.x+data.cell.width, data.cell.y);
      } else if (kind==="line") {
        pdf.setDrawColor(230); pdf.setLineWidth(0.1);
        pdf.line(data.cell.x, data.cell.y+data.cell.height, data.cell.x+data.cell.width, data.cell.y+data.cell.height);
      }
    },
  });

  const after = (pdf as unknown as { lastAutoTable?:{ finalY:number } }).lastAutoTable?.finalY ?? y;
  if (doc.notes?.length) {
    let noteY = after + 7;
    pdf.setFont("helvetica","italic"); pdf.setFontSize(8); pdf.setTextColor(110);
    for (const note of doc.notes) {
      const lines = pdf.splitTextToSize(note, width-margin*2) as string[];
      if (noteY + lines.length*3.6 > pdf.internal.pageSize.getHeight()-16) { pdf.addPage(); noteY = 18 }
      pdf.text(lines, margin, noteY);
      noteY += lines.length*3.6 + 1.5;
    }
  }

  const pages = pdf.getNumberOfPages();
  const stamp = `Dicetak ${printedAt()}`;
  for (let page=1; page<=pages; page++) {
    pdf.setPage(page);
    const bottom = pdf.internal.pageSize.getHeight()-8;
    pdf.setFont("helvetica","normal"); pdf.setFontSize(7.5); pdf.setTextColor(130);
    pdf.text(`${place.name} · ${doc.title} · ${stamp}`, margin, bottom);
    pdf.text(`Halaman ${page} dari ${pages}`, width-margin, bottom, { align:"right" });
  }
  pdf.setProperties({ title:doc.title, author:place.name, creator:place.name });
  return pdf.output("blob");
}

/** Bangun file sesuai format lalu unduh ke perangkat. */
export async function exportReport(doc:ReportDoc, format:ExportFormat) {
  const blob = format==="xlsx" ? await xlsxBlob(doc) : format==="pdf" ? await pdfBlob(doc) : csvBlob(doc);
  save(blob, `${doc.filename}.${format}`);
}
