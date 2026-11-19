import type { ReactNode } from "react";
import { Field, Section, TitleField } from "../../components/forms/form-rows";

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
      <TitleField
        label="Title"
        leading={icon}
        value={title}
        onChangeText={onTitleChange}
        placeholder={placeholder}
      />
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
