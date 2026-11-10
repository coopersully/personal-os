import { type FinanceAccount, financeInstitutionBrandingSchema } from "@personal-os/domain";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "../../theme";

/** Provider-supplied artwork is never tinted; unavailable artwork uses honest initials. */
export function InstitutionLogo({
  account,
}: {
  account: Pick<FinanceAccount, "institution" | "institutionBranding">;
}) {
  const t = useTheme();
  const parsed = financeInstitutionBrandingSchema.safeParse(account.institutionBranding);
  const uri = parsed.success ? parsed.data.logo : null;
  const [failed, setFailed] = useState<string | null>(null);
  const initials =
    account.institution
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <View
      accessible
      accessibilityLabel={account.institution}
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        backgroundColor: t.surface,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {uri && failed !== uri ? (
        <Image
          source={{ uri }}
          onError={() => setFailed(uri)}
          resizeMode="contain"
          style={{ width: 44, height: 44 }}
        />
      ) : (
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>{initials}</Text>
      )}
    </View>
  );
}
