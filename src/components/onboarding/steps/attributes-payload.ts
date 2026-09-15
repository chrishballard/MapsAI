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
    case "BOOL":
      return { ...base, boolValue: attr.currentValue === true };
    case "ENUM":
      return { ...base, enumValue: (attr.currentValue as string) ?? "" };
    case "REPEATED_ENUM":
      return { ...base, repeatedEnumValues: repeated?.setValues ?? [] };
    case "URL":
      return { ...base, urlValue: (attr.currentValue as string) ?? "" };
    default:
      return base;
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

export function buildAttributePush(
  attributes: AttributeState[]
): AttributePushPayload {
  const writes = attributes.filter(hasValue).map((attr): AttributeWrite => {
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
  const removeAttributeIds = attributes
    .filter((attr) => attr.wasSet && !hasValue(attr))
    .map((attr) => attr.attributeId);

  return { attributes: writes, removeAttributeIds };
}
