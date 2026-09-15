import { describe, it, expect } from 'vitest';
import {
  buildAttributePush,
  parseAttribute,
  type AttributeState,
  type GBPAttribute,
} from '../../src/components/onboarding/steps/attributes-payload';

// Google builds its attributeMask from whatever this payload contains, so an
// attribute left out is left alone and an attribute named for removal with no
// entry is deleted. The form lists every attribute the category offers —
// around 40, most unset — so what is NOT sent matters as much as what is.

function state(over: Partial<AttributeState> & Pick<AttributeState, 'attributeId' | 'valueType'>): AttributeState {
  return {
    displayName: over.attributeId,
    groupDisplayName: 'Other',
    wasSet: false,
    ...over,
  };
}

describe('parseAttribute', () => {
  function attr(over: Partial<GBPAttribute>): GBPAttribute {
    return {
      attributeId: 'a',
      displayName: 'A',
      groupDisplayName: 'Other',
      valueType: 'BOOL',
      currentValue: null,
      ...over,
    };
  }

  it('marks an attribute Google has no value for as not set', () => {
    expect(parseAttribute(attr({ valueType: 'BOOL', currentValue: null })).wasSet).toBe(false);
    expect(parseAttribute(attr({ valueType: 'URL', currentValue: null })).wasSet).toBe(false);
  });

  it('marks an explicit false as set — Google is holding a value', () => {
    const parsed = parseAttribute(attr({ valueType: 'BOOL', currentValue: false }));
    expect(parsed.wasSet).toBe(true);
    expect(parsed.boolValue).toBe(false);
  });

  it('treats an empty REPEATED_ENUM as not set', () => {
    const empty = parseAttribute(
      attr({ valueType: 'REPEATED_ENUM', currentValue: { setValues: [], unsetValues: [] } })
    );
    expect(empty.wasSet).toBe(false);

    const filled = parseAttribute(
      attr({ valueType: 'REPEATED_ENUM', currentValue: { setValues: ['X'] } })
    );
    expect(filled.wasSet).toBe(true);
    expect(filled.repeatedEnumValues).toEqual(['X']);
  });
});

describe('buildAttributePush', () => {
  // The regression that matters: before the attribute reads were fixed the
  // form saw nothing, so this never bit. With the catalog working it lists
  // ~40 attributes, and sending them all would write an explicit "false" onto
  // every box nobody ticked.
  it('does not send untouched, unticked BOOL attributes', () => {
    const result = buildAttributePush([
      state({ attributeId: 'is_black_owned', valueType: 'BOOL', boolValue: false }),
      state({ attributeId: 'has_restroom', valueType: 'BOOL', boolValue: false }),
      state({ attributeId: 'has_parking_lot_free', valueType: 'BOOL', boolValue: true }),
    ]);

    expect(result.attributes).toHaveLength(1);
    expect(result.attributes[0].attributeId).toBe('has_parking_lot_free');
    expect(result.removeAttributeIds).toEqual([]);
  });

  it('sends a ticked BOOL as true', () => {
    const result = buildAttributePush([
      state({ attributeId: 'has_parking_lot_free', valueType: 'BOOL', boolValue: true }),
    ]);

    expect(result.attributes[0]).toEqual({
      attributeId: 'has_parking_lot_free',
      valueType: 'BOOL',
      values: [true],
    });
  });

  it('removes an attribute the person unticked', () => {
    const result = buildAttributePush([
      state({
        attributeId: 'has_parking_lot_free',
        valueType: 'BOOL',
        boolValue: false,
        wasSet: true,
      }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['has_parking_lot_free']);
  });

  // Clearing a link used to be a silent no-op: the entry was dropped from the
  // payload, so it never reached the mask and stayed live on the profile.
  it('removes a URL the person cleared instead of silently keeping it', () => {
    const result = buildAttributePush([
      state({ attributeId: 'url_facebook', valueType: 'URL', urlValue: '', wasSet: true }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['url_facebook']);
  });

  it('never removes an attribute that was never set', () => {
    const result = buildAttributePush([
      state({ attributeId: 'url_tiktok', valueType: 'URL', urlValue: '', wasSet: false }),
      state({ attributeId: 'some_enum', valueType: 'ENUM', enumValue: '', wasSet: false }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual([]);
  });

  it('sends each value type in its own field', () => {
    const result = buildAttributePush([
      state({ attributeId: 'a_enum', valueType: 'ENUM', enumValue: 'SOME_VALUE' }),
      state({ attributeId: 'a_repeated', valueType: 'REPEATED_ENUM', repeatedEnumValues: ['X', 'Y'] }),
      state({ attributeId: 'a_url', valueType: 'URL', urlValue: 'https://x.test' }),
    ]);

    expect(result.attributes).toEqual([
      { attributeId: 'a_enum', valueType: 'ENUM', values: ['SOME_VALUE'] },
      {
        attributeId: 'a_repeated',
        valueType: 'REPEATED_ENUM',
        repeatedEnumValue: { setValues: ['X', 'Y'], unsetValues: [] },
      },
      { attributeId: 'a_url', valueType: 'URL', uriValues: [{ uri: 'https://x.test' }] },
    ]);
  });

  it('emptying a REPEATED_ENUM that had values is a removal', () => {
    const result = buildAttributePush([
      state({
        attributeId: 'a_repeated',
        valueType: 'REPEATED_ENUM',
        repeatedEnumValues: [],
        wasSet: true,
      }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['a_repeated']);
  });

  it('a form where nothing is set produces an empty push, not a mask meaning "all"', () => {
    const result = buildAttributePush([
      state({ attributeId: 'x', valueType: 'BOOL', boolValue: false }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual([]);
  });
});
