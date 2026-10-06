import { parseSvg } from '../parser.js';
import {
  createNamespaceResolver,
  hasScripts,
  isJavaScriptUri,
  isScriptElement,
} from './tools.js';

describe('isJavaScriptUri', () => {
  it('matches javascript: URIs regardless of case and leading whitespace', () => {
    expect(isJavaScriptUri('javascript:alert(1)')).toBe(true);
    expect(isJavaScriptUri('JavaScript:alert(1)')).toBe(true);
    expect(isJavaScriptUri('JAVASCRIPT:alert(1)')).toBe(true);
    expect(isJavaScriptUri(' javascript:alert(1)')).toBe(true);
    expect(isJavaScriptUri('\t JavaScript:alert(1)')).toBe(true);
  });

  it('does not match other URIs', () => {
    expect(isJavaScriptUri('https://example.com')).toBe(false);
    expect(isJavaScriptUri('#id')).toBe(false);
    expect(isJavaScriptUri('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isJavaScriptUri('javascriptx:alert(1)')).toBe(false);
    expect(isJavaScriptUri(undefined)).toBe(false);
  });
});

describe('isScriptElement', () => {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  /** @param {Record<string, string>} namespaces */
  const resolverFor = (namespaces) => (/** @type {string} */ prefix) =>
    namespaces[prefix];

  it('matches unprefixed script elements', () => {
    expect(
      isScriptElement(
        { type: 'element', name: 'script', attributes: {}, children: [] },
        resolverFor({}),
      ),
    ).toBe(true);
  });

  it('matches prefixed script elements in the SVG namespace', () => {
    expect(
      isScriptElement(
        { type: 'element', name: 'svg:script', attributes: {}, children: [] },
        resolverFor({ svg: svgNamespace }),
      ),
    ).toBe(true);
  });

  it('does not match elements named script in other namespaces', () => {
    expect(
      isScriptElement(
        { type: 'element', name: 'foo:script', attributes: {}, children: [] },
        resolverFor({ foo: 'http://example.com/foo' }),
      ),
    ).toBe(false);
    expect(
      isScriptElement(
        { type: 'element', name: 'svg:script', attributes: {}, children: [] },
        resolverFor({ svg: 'http://example.com/foo' }),
      ),
    ).toBe(false);
  });

  it('does not match other elements', () => {
    expect(
      isScriptElement(
        { type: 'element', name: 'scriptable', attributes: {}, children: [] },
        resolverFor({}),
      ),
    ).toBe(false);
    expect(
      isScriptElement(
        { type: 'element', name: 'svg:rect', attributes: {}, children: [] },
        resolverFor({ svg: svgNamespace }),
      ),
    ).toBe(false);
  });
});

describe('hasScripts', () => {
  /** @param {string} svg */
  const detect = (svg) => hasScripts(parseSvg(svg));

  it('detects script elements', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ).toBe(true);
  });

  it('ignores script elements without children', () => {
    expect(
      detect('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    ).toBe(false);
  });

  it('detects script elements with a prefix bound to the SVG namespace', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>',
      ),
    ).toBe(true);
  });

  it('detects script elements with a namespace declared on the element itself', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script></svg>',
      ),
    ).toBe(true);
  });

  it('detects script elements when the prefix is rebound to the SVG namespace in a nested scope', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:p="http://example.com/foo"><g xmlns:p="http://www.w3.org/2000/svg"><p:script>alert(1)</p:script></g></svg>',
      ),
    ).toBe(true);
  });

  it('ignores elements named script in other namespaces', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:foo="http://example.com/foo"><foo:script>private data</foo:script></svg>',
      ),
    ).toBe(false);
  });

  it('ignores elements named script when the prefix is rebound to another namespace in a nested scope', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:p="http://www.w3.org/2000/svg"><g xmlns:p="http://example.com/foo"><p:script>private data</p:script></g></svg>',
      ),
    ).toBe(false);
  });

  it('detects links to javascript: URIs regardless of case and leading whitespace', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">uwu</a></svg>',
      ),
    ).toBe(true);
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="JavaScript:alert(1)">uwu</a></svg>',
      ),
    ).toBe(true);
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href=" JAVASCRIPT:alert(1)">uwu</a></svg>',
      ),
    ).toBe(true);
  });

  it('ignores links to other URIs', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com">uwu</a></svg>',
      ),
    ).toBe(false);
  });

  it('detects event attributes', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>',
      ),
    ).toBe(true);
  });

  it('ignores documents without scripts', () => {
    expect(
      detect(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle id="a" r="5"/></svg>',
      ),
    ).toBe(false);
  });
});

describe('createNamespaceResolver', () => {
  it('resolves prefixes to the innermost binding', () => {
    const resolver = createNamespaceResolver();
    resolver.enter({
      type: 'element',
      name: 'svg',
      attributes: { 'xmlns:p': 'http://example.com/outer' },
      children: [],
    });
    expect(resolver.resolve('p')).toBe('http://example.com/outer');
    resolver.enter({
      type: 'element',
      name: 'g',
      attributes: { 'xmlns:p': 'http://example.com/inner' },
      children: [],
    });
    expect(resolver.resolve('p')).toBe('http://example.com/inner');
    resolver.exit();
    expect(resolver.resolve('p')).toBe('http://example.com/outer');
    resolver.exit();
    expect(resolver.resolve('p')).toBe(undefined);
  });
});
