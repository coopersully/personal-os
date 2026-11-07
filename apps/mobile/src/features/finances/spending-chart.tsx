import type { FinanceSpendingDailyBin } from "@personal-os/domain";
import { Text, View } from "react-native";
import { useTheme, workspaceColor } from "../../theme";
import { formatMoney } from "./presentation";

/** Daily bins are server-calculated; this component only scales their visual height. */
export function SpendingChart({ bins }: { bins: readonly FinanceSpendingDailyBin[] }) {
  const t = useTheme();
  const scale = Math.max(1, ...bins.map((bin) => Math.abs(bin.netCents)));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, paddingTop: 12 }}>
      {bins.map((bin) => (
        <View
          key={bin.date}
          accessible
          accessibilityLabel={`${bin.date}: ${formatMoney(bin.netCents / 100, "USD")}${bin.future ? ", future date" : ""}${bin.provisional ? ", provisional" : ""}`}
          style={{ flex: 1, alignItems: "center", gap: 8 }}
        >
          <View style={{ height: 72, justifyContent: "flex-end", width: "100%", maxWidth: 32 }}>
            <View
              style={{
                height: bin.future ? 2 : Math.max(3, (Math.abs(bin.netCents) / scale) * 72),
                borderRadius: 4,
                backgroundColor: bin.netCents < 0 ? t.information : workspaceColor(t, "finances"),
                opacity: bin.future ? 0.15 : bin.provisional ? 0.6 : 1,
              }}
            />
          </View>
          {bins.length <= 7 && (
            <Text style={{ fontSize: 12, color: t.secondary }}>
              {new Date(`${bin.date}T12:00:00Z`).toLocaleDateString(undefined, {
                weekday: "narrow",
                timeZone: "UTC",
              })}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
