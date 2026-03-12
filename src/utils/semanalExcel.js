const ExcelJS = require('exceljs');
const { formatMinutesClock, formatWeekLabelFromIso } = require('./semanalReport');

const BORDER_STYLE = {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
};

function styleHeaderCell(cell) {
    cell.font = { bold: true, color: { argb: 'FF1D3FAE' }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER_STYLE;
}

function styleNameCell(cell) {
    cell.font = { bold: true, color: { argb: 'FF111111' }, size: 12 };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    cell.border = BORDER_STYLE;
}

function styleDeltaCell(cell, minutes, isTotal = false) {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER_STYLE;

    if (!Number.isFinite(minutes)) {
        cell.font = { color: { argb: 'FF666666' }, size: 11 };
        return;
    }

    if (minutes < 0) {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFDECEC' }
        };
        cell.font = { color: { argb: 'FFC00000' }, size: isTotal ? 12 : 11, bold: isTotal };
        return;
    }

    if (minutes > 0) {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFB7E1CD' }
        };
        cell.font = { color: { argb: 'FF4F4F4F' }, size: isTotal ? 12 : 11, bold: isTotal };
        return;
    }

    cell.font = { color: { argb: 'FF5E5E5E' }, size: isTotal ? 12 : 11, bold: isTotal };
}

async function buildSemanalWorkbookBuffer({ matrix, title = 'Horas Extra' }) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kronos Bot';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(title, {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
    });

    const totalColumns = Math.max(2, matrix.weeks.length + 2);
    worksheet.mergeCells(1, 1, 1, totalColumns);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };

    worksheet.getRow(1).height = 22;
    worksheet.getRow(2).height = 20;

    worksheet.getCell(2, 1).value = '';
    styleHeaderCell(worksheet.getCell(2, 1));

    matrix.weeks.forEach((weekIso, index) => {
        const col = index + 2;
        const cell = worksheet.getCell(2, col);
        cell.value = formatWeekLabelFromIso(weekIso);
        styleHeaderCell(cell);
    });

    const totalColumn = matrix.weeks.length + 2;
    const totalHeaderCell = worksheet.getCell(2, totalColumn);
    totalHeaderCell.value = 'TOTAL';
    styleHeaderCell(totalHeaderCell);

    const dataStartRow = 3;
    matrix.people.forEach((person, rowIndex) => {
        const rowNumber = dataStartRow + rowIndex;
        const row = worksheet.getRow(rowNumber);
        row.height = 22;

        const targetText = Number.isFinite(person.targetMinutes)
            ? `${Math.round(person.targetMinutes / 60)}`
            : '--';

        const nameCell = worksheet.getCell(rowNumber, 1);
        nameCell.value = `${targetText} ${person.personName}`;
        styleNameCell(nameCell);

        matrix.weeks.forEach((weekIso, index) => {
            const col = index + 2;
            const value = person.weekly[weekIso];
            const cell = worksheet.getCell(rowNumber, col);
            cell.value = Number.isFinite(value) ? formatMinutesClock(value) : '';
            styleDeltaCell(cell, value, false);
        });

        const totalCell = worksheet.getCell(rowNumber, totalColumn);
        totalCell.value = formatMinutesClock(person.totalDeltaMinutes);
        styleDeltaCell(totalCell, person.totalDeltaMinutes, true);
    });

    worksheet.getColumn(1).width = 30;
    for (let col = 2; col <= totalColumn; col += 1) {
        worksheet.getColumn(col).width = 10;
    }

    return workbook.xlsx.writeBuffer();
}

module.exports = {
    buildSemanalWorkbookBuffer
};
