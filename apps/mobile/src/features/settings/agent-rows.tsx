import { View } from "react-native";
import { formBlock } from "../../components/forms/form-rows";
import { SettingDetail, SettingLabel } from "../../components/settings-row-content";
import { permissionLines } from "./agent-copy";

/**
 * A label above a value that needs the full row width: an address, a prompt to copy, a list
 * of permissions. It is the shared stacked block, so it lines up with the rows around it.
 */
export function DetailBlock({
  label,
  lines,
  selectable = false,
}: {
  label: string;
  lines: string[];
  selectable?: boolean;
}) {
  return (
    <View style={formBlock}>
      <SettingDetail>{label}</SettingDetail>
      {lines.map((line) => (
        <SettingLabel key={line} selectable={selectable} style={{ flex: 0 }}>
          {line}
        </SettingLabel>
      ))}
    </View>
  );
}

/** What a connection, token or app may do, one short line for each part of nohmi. */
export function PermissionBlock({ scopes }: { scopes: readonly string[] }) {
  const lines = permissionLines(scopes);
  return <DetailBlock label="Permissions" lines={lines.length ? lines : ["None"]} />;
}

/** A record's name and what it is about, as the first block of its group. */
export function RecordSummary({ title, summary }: { title: string; summary: string }) {
  return (
    <View style={formBlock}>
      <SettingLabel style={{ flex: 0, fontWeight: "600" }}>{title}</SettingLabel>
      <SettingDetail>{summary}</SettingDetail>
    </View>
  );
}
