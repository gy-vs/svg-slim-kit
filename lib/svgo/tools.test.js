import {
  createNamespaceTracker,
  hasScripts,
  isJavaScriptUrl,
  isScriptElement,
} from './tools.js';

/**
 * @param {string} name
 * @param {?Record<string, string>} attrs
 * @param {import('../types.js').XastChild[]} children
 * @returns {import('../types.js').XastElement}
 */
const x = (name, attrs = null, children = []) => {
  return { type: 'element', name, attributes: attrs || {}, children };
};

/**
 * @param {string} value
 * @returns {import('../types.js').XastText}
 */
const text = (value) => {
  return { type: 'text', value };
};

test('isJavaScriptUrl matches the scheme case-insensitively', () => {
  expect(isJavaScriptUrl('javascript:alert(1)')).toBe(true);
  expect(isJavaScriptUrl('JavaScript:alert(1)')).toBe(true);
  expect(isJavaScriptUrl('JAVASCRIPT:alert(1)')).toBe(true);
  expect(isJavaScriptUrl('  javascript:alert(1)')).toBe(true);
  expect(isJavaScriptUrl('\tJavaScript:alert(1)')).toBe(true);
  expect(isJavaScriptUrl('https://example.com')).toBe(false);
  expect(isJavaScriptUrl('data:image/svg+xml,<svg/>')).toBe(false);
  expect(isJavaScriptUrl('javascript')).toBe(false);
  expect(isJavaScriptUrl('')).toBe(false);
});

test('isScriptElement only matches script in the SVG namespace', () => {
  const namespaces = createNamespaceTracker();
  namespaces.enter(
    x('svg', {
      'xmlns:svg': 'http://www.w3.org/2000/svg',
      'xmlns:foo': 'http://example.com/foo',
    }),
  );

  expect(isScriptElement(x('script'), namespaces)).toBe(true);
  expect(isScriptElement(x('svg:script'), namespaces)).toBe(true);
  expect(isScriptElement(x('foo:script'), namespaces)).toBe(false);
  // undeclared prefix
  expect(isScriptElement(x('bar:script'), namespaces)).toBe(false);
  // other prefixed names are not scripts
  expect(isScriptElement(x('svg:scriptable'), namespaces)).toBe(false);

  // declarations go out of scope with the element that declared them
  namespaces.exit();
  expect(isScriptElement(x('script'), namespaces)).toBe(true);
  expect(isScriptElement(x('svg:script'), namespaces)).toBe(false);
});

test('isScriptElement honors nested declarations shadowing outer ones', () => {
  const namespaces = createNamespaceTracker();
  namespaces.enter(x('svg', { 'xmlns:svg': 'http://www.w3.org/2000/svg' }));
  expect(isScriptElement(x('svg:script'), namespaces)).toBe(true);

  namespaces.enter(x('g', { 'xmlns:svg': 'http://example.com/not-svg' }));
  expect(isScriptElement(x('svg:script'), namespaces)).toBe(false);

  namespaces.exit();
  expect(isScriptElement(x('svg:script'), namespaces)).toBe(true);
  namespaces.exit();
});

test('isScriptElement resolves prefixes declared on the element itself', () => {
  const namespaces = createNamespaceTracker();
  namespaces.enter(x('svg'));

  const selfDeclared = x('svg:script', {
    'xmlns:svg': 'http://www.w3.org/2000/svg',
  });
  namespaces.enter(selfDeclared);
  expect(isScriptElement(selfDeclared, namespaces)).toBe(true);
  namespaces.exit();

  expect(isScriptElement(x('svg:script'), namespaces)).toBe(false);
  namespaces.exit();
});

test('isScriptElement ignores prefixed names without a tracker', () => {
  expect(isScriptElement(x('script'))).toBe(true);
  expect(isScriptElement(x('svg:script'))).toBe(false);
});

test('hasScripts detects scripts consistently', () => {
  const namespaces = createNamespaceTracker();
  namespaces.enter(
    x('svg', {
      'xmlns:svg': 'http://www.w3.org/2000/svg',
      'xmlns:foo': 'http://example.com/foo',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    }),
  );

  // script elements with content
  expect(hasScripts(x('script', null, [text('alert(1)')]), namespaces)).toBe(
    true,
  );
  expect(
    hasScripts(x('svg:script', null, [text('alert(1)')]), namespaces),
  ).toBe(true);
  expect(
    hasScripts(x('foo:script', null, [text('alert(1)')]), namespaces),
  ).toBe(false);

  // empty script elements are not considered scripts
  expect(hasScripts(x('script'), namespaces)).toBe(false);
  expect(hasScripts(x('svg:script'), namespaces)).toBe(false);

  // javascript: links are matched case-insensitively
  expect(hasScripts(x('a', { href: 'javascript:alert(1)' }), namespaces)).toBe(
    true,
  );
  expect(hasScripts(x('a', { href: 'JavaScript:alert(1)' }), namespaces)).toBe(
    true,
  );
  expect(
    hasScripts(x('a', { 'xlink:href': ' JAVASCRIPT:alert(1)' }), namespaces),
  ).toBe(true);
  expect(hasScripts(x('a', { href: 'https://example.com' }), namespaces)).toBe(
    false,
  );

  // event attributes
  expect(hasScripts(x('rect', { onclick: 'alert(1)' }), namespaces)).toBe(true);
  expect(hasScripts(x('rect', { fill: 'red' }), namespaces)).toBe(false);

  namespaces.exit();
});

test('hasScripts keeps legacy behavior when no tracker is passed', () => {
  expect(hasScripts(x('script', null, [text('alert(1)')]))).toBe(true);
  expect(hasScripts(x('svg:script', null, [text('alert(1)')]))).toBe(false);
  expect(hasScripts(x('a', { href: 'JavaScript:alert(1)' }))).toBe(true);
});
