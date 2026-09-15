/**
 * Turning the attributes form into a GBP write.
 *
 * Extracted from attributes-step.tsx so it can be tested directly, and
 * because the rules are not obvious: Google builds its attributeMask from
 * whatever this payload contains, so an attribute left out is left exactly as
 * it is on the profile, and an attribute named for removal with no matching
 * entry is deleted.
 *
 * The form lists every attribute the location's category offers — around 40
 * for a gutter service, most of them unset. Sending all of them would write
 * an explicit "false" onto every box nobody ticked, so only attributes that
 * actually hold a value are sent.
 */

export type GBPAttributeValueType = "BOOL" | "ENUM" | "REPEATED_ENUM" | "URL";

interface InitialValue {
  boolValue?: boolean;
  enumValue?: string;
  repeatedEnumValues?: string[];
  urlValue?: string;
}

export interface GBPAttribute {
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: GBPAttributeValueType;
  currentValue: unknown;
  valueMetadata?: Array<{ value: string; displayName: string }>;
}

export interface AttributeState {
  attributeId: string;
  displayName: string;
  groupDisplayName: string;
  valueType: GBPAttributeValueType;
  /**
   * Whether Google had a value for this attribute when the form loaded. With
   * most rows unset, this is what separates an edit from an untouched row —
   * and what makes clearing a field a deletion rather than a silent no-op.
   */
  wasSet: boolean;
  /**
   * The value as loaded, kept so a push can send only what the person
   * actually changed. A checkbox cannot show the difference between "unset"
   * and "explicitly false", so an untouched row must not be written at all —
   * pushing the checkbox state would turn every deliberate "No" on the
   * profile into a deletion.
   */
  initial: InitialValue;
  boolValue?: boolean;
  enumValue?: string;
  repeatedEnumValues?: string[];
  urlValue?: string;
  valueMetadata?: Array<{ value: string; displayName: string }>;
}

export function parseAttribute(attr: GBPAttribute): AttributeState {
  const repeated =
    attr.valueType === "REPEATED_ENUM"
      ? (attr.currentValue as { setValues?: string[] } | null)
      : null;

  const base = {
    attributeId: attr.attributeId,
    displayName: attr.displayName,
    groupDisplayName: attr.groupDisplayName,
    valueType: attr.valueType,
    valueMetadata: attr.valueMetadata,
    wasSet:
      attr.valueType === "REPEATED_ENUM"
        ? (repeated?.setValues?.length ?? 0) > 0
        : attr.currentValue !== null && attr.currentValue !== undefined,
  };

  switch (attr.valueType) {
    case "BOOL": {
      const boolValue = attr.currentValue === true;
      return { ...base, boolValue, initial: { boolValue } };
    }
    case "ENUM": {
      const enumValue = (attr.currentValue as string) ?? "";
      return { ...base, enumValue, initial: { enumValue } };
    }
    case "REPEATED_ENUM": {
      const repeatedEnumValues = repeated?.setValues ?? [];
      const initial = { repeatedEnumValues: [...repeatedEnumValues] };
      return { ...base, repeatedEnumValues, initial };
    }
    case "URL": {
      const urlValue = (attr.currentValue as string) ?? "";
      return { ...base, urlValue, initial: { urlValue } };
    }
    default:
      return { ...base, initial: {} };
  }
}

/** Has the person changed this attribute since the form loaded? */
export function isChanged(attr: AttributeState): boolean {
  switch (attr.valueType) {
    case "BOOL":
      return (attr.boolValue ?? false) !== (attr.initial.boolValue ?? false);
    case "ENUM":
      return (attr.enumValue ?? "") !== (attr.initial.enumValue ?? "");
    case "REPEATED_ENUM": {
      const now = [...(attr.repeatedEnumValues ?? [])].sort();
      const before = [...(attr.initial.repeatedEnumValues ?? [])].sort();
      return now.length !== before.length || now.some((v, i) => v !== before[i]);
    }
    case "URL":
      return (attr.urlValue ?? "") !== (attr.initial.urlValue ?? "");
    default:
      return false;
  }
}

/** Does the form currently hold a value worth sending for this attribute? */
export function hasValue(attr: AttributeState): boolean {
  switch (attr.valueType) {
    case "BOOL":
      return attr.boolValue === true;
    case "ENUM":
      return Boolean(attr.enumValue);
    case "REPEATED_ENUM":
      return (attr.repeatedEnumValues?.length ?? 0) > 0;
    case "URL":
      return Boolean(attr.urlValue);
    default:
      return false;
  }
}

export interface AttributeWrite {
  attributeId: string;
  valueType: GBPAttributeValueType;
  values?: unknown[];
  repeatedEnumValue?: { setValues: string[]; unsetValues: string[] };
  uriValues?: Array<{ uri: string }>;
}

export interface AttributePushPayload {
  attributes: AttributeWrite[];
  removeAttributeIds: string[];
}

/**
 * Build the write for a form the person has edited.
 *
 * Only changed attributes travel, which is what keeps an untouched row
 * untouched on the profile: Google derives its attributeMask from this
 * payload, so anything absent is left exactly as it is. A changed attribute
 * that now holds a value is written; a changed one that is now empty is
 * removed.
 */
export function buildAttributePush(
  attributes: AttributeState[]
): AttributePushPayload {
  const changed = attributes.filter(isChanged);

  const writes = changed.filter(hasValue).map((attr): AttributeWrite => {
    switch (attr.valueType) {
      case "BOOL":
        return { attributeId: attr.attributeId, valueType: "BOOL", values: [true] };
      case "ENUM":
        return {
          attributeId: attr.attributeId,
          valueType: "ENUM",
          values: [attr.enumValue],
        };
      case "REPEATED_ENUM":
        return {
          attributeId: attr.attributeId,
          valueType: "REPEATED_ENUM",
          repeatedEnumValue: {
            setValues: attr.repeatedEnumValues ?? [],
            unsetValues: [],
          },
        };
      case "URL":
        return {
          attributeId: attr.attributeId,
          valueType: "URL",
          uriValues: [{ uri: attr.urlValue! }],
        };
    }
  });

  // Set when the form loaded, emptied since: unticking a box or clearing a
  // link has to actually remove it from the profile.
  const removeAttributeIds = changed
    .filter((attr) => attr.wasSet && !hasValue(attr))
    .map((attr) => attr.attributeId);

  return { attributes: writes, removeAttributeIds };
}
