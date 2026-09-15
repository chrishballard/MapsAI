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

/** An attribute exactly as it came back from Google, before anyone edits it. */
function loaded(
  attributeId: string,
  valueType: GBPAttribute['valueType'],
  currentValue: unknown
): AttributeState {
  return parseAttribute({
    attributeId,
    displayName: attributeId,
    groupDisplayName: 'Other',
    valueType,
    currentValue,
  });
}

/** The person changes something in the form. `initial` stays as loaded. */
function edit(attr: AttributeState, changes: Partial<AttributeState>): AttributeState {
  return { ...attr, ...changes };
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
  // An untouched form must write nothing. A checkbox cannot show the
  // difference between "unset" and "explicitly false", so pushing the
  // checkbox state of every row would turn each deliberate "No" on the
  // profile into a deletion.
  it('pushes nothing at all when the person changed nothing', () => {
    const result = buildAttributePush([
      loaded('has_parking_lot_free', 'BOOL', true),
      loaded('has_wheelchair_accessible_entrance', 'BOOL', false),
      loaded('is_black_owned', 'BOOL', null),
      loaded('url_facebook', 'URL', 'https://facebook.com/badger'),
      loaded('url_tiktok', 'URL', null),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual([]);
  });

  // Regression: an attribute Google holds as an explicit false reads as
  // "no value" to hasValue(). Removing it on an untouched push would drop a
  // deliberate "No" — which Maps displays — without anyone asking.
  it('never removes an explicitly-false attribute the person did not touch', () => {
    const result = buildAttributePush([
      loaded('has_wheelchair_accessible_entrance', 'BOOL', false),
    ]);

    expect(result.removeAttributeIds).toEqual([]);
    expect(result.attributes).toEqual([]);
  });

  // The hazard that fixing the attribute reads exposed: the form lists every
  // attribute the category offers (~40, most unset), and sending them all
  // would write an explicit false onto every box nobody ticked.
  it('does not send untouched, never-set BOOL attributes', () => {
    const result = buildAttributePush([
      loaded('is_black_owned', 'BOOL', null),
      loaded('has_restroom', 'BOOL', null),
      edit(loaded('has_parking_lot_free', 'BOOL', null), { boolValue: true }),
    ]);

    expect(result.attributes).toHaveLength(1);
    expect(result.attributes[0]).toEqual({
      attributeId: 'has_parking_lot_free',
      valueType: 'BOOL',
      values: [true],
    });
  });

  it('removes an attribute the person unticked', () => {
    const result = buildAttributePush([
      edit(loaded('has_parking_lot_free', 'BOOL', true), { boolValue: false }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['has_parking_lot_free']);
  });

  // Clearing a link used to be a silent no-op: the entry was dropped from the
  // payload, so it never reached the mask and stayed live on the profile.
  it('removes a URL the person cleared instead of silently keeping it', () => {
    const result = buildAttributePush([
      edit(loaded('url_facebook', 'URL', 'https://facebook.com/badger'), { urlValue: '' }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['url_facebook']);
  });

  it('sends an edited URL as its new value', () => {
    const result = buildAttributePush([
      edit(loaded('url_facebook', 'URL', 'https://facebook.com/old'), {
        urlValue: 'https://facebook.com/new',
      }),
    ]);

    expect(result.attributes).toEqual([
      {
        attributeId: 'url_facebook',
        valueType: 'URL',
        uriValues: [{ uri: 'https://facebook.com/new' }],
      },
    ]);
    expect(result.removeAttributeIds).toEqual([]);
  });

  it('never removes a field that was already empty when the form loaded', () => {
    const result = buildAttributePush([
      loaded('url_tiktok', 'URL', null),
      loaded('some_enum', 'ENUM', null),
    ]);

    expect(result.removeAttributeIds).toEqual([]);
  });

  it('sends each changed value type in its own field', () => {
    const result = buildAttributePush([
      edit(loaded('a_enum', 'ENUM', null), { enumValue: 'SOME_VALUE' }),
      edit(loaded('a_repeated', 'REPEATED_ENUM', { setValues: [] }), {
        repeatedEnumValues: ['X', 'Y'],
      }),
      edit(loaded('a_url', 'URL', null), { urlValue: 'https://x.test' }),
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
      edit(loaded('a_repeated', 'REPEATED_ENUM', { setValues: ['X'] }), {
        repeatedEnumValues: [],
      }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual(['a_repeated']);
  });

  it('does not treat a reordered REPEATED_ENUM as a change', () => {
    const result = buildAttributePush([
      edit(loaded('a_repeated', 'REPEATED_ENUM', { setValues: ['X', 'Y'] }), {
        repeatedEnumValues: ['Y', 'X'],
      }),
    ]);

    expect(result.attributes).toEqual([]);
    expect(result.removeAttributeIds).toEqual([]);
  });
});
