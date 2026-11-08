import { toBackup } from "../data/migrate";
import { isoDate, txnsForPeriod, type PeriodSpec } from "../lib/businessDay";
import { saveFile } from "../platform/files";
import { buildCSV, buildReportHTML, printReport } from "../reports/reports";
import { useApp } from "./appStore";

export function exportReport(format: "csv" | "pdf", spec: PeriodSpec) {
  const { data } = useApp.getState();
  const txns = txnsForPeriod(data.history, spec, data.settings);
  if (!txns.length) return;
  const input = { spec, txns, hours: data.settings, businessName: data.settings.businessName, tableList: data.tableList };
  if (format === "csv") {
    const { filename, csv } = buildCSV(input);
    void saveFile(filename, "text/csv;charset=utf-8", csv);
  } else {
    printReport(buildReportHTML(input));
  }
}

export async function exportAllData() {
  const { data, showToast } = useApp.getState();
  const json = JSON.stringify(toBackup(data), null, 2);
  await saveFile(`order_board_backup_${isoDate(new Date())}.json`, "application/json", json);
  showToast({ text: "Backup exported. Keep a copy off this phone.", tone: "success" });
}
