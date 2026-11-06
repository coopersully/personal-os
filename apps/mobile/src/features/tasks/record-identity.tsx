import type { ReactNode } from "react";
import { View } from "react-native";
import { Field, Section, TitleField } from "./ui";

/** Shared identity block; the description uses each domain's existing notes/description field. */
export function RecordIdentity({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  placeholder,
  descriptionPlaceholder,
  icon,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  placeholder: string;
  descriptionPlaceholder: string;
  icon?: ReactNode;
}) {
  return (
    <Section>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {icon && (
          <View
            style={{
              marginLeft: 16,
              marginTop: 16,
              width: 44,
              minHeight: 56,
              alignItems: "center",
            }}
          >
            {icon}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <TitleField
            label="Title"
            value={title}
            onChangeText={onTitleChange}
            placeholder={placeholder}
          />
        </View>
      </View>
      <Field
        compact={false}
        label="Description"
        value={description}
        onChangeText={onDescriptionChange}
        multiline
        maxLength={10000}
        placeholder={descriptionPlaceholder}
      />
    </Section>
  );
}
