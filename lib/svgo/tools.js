import { attrsGroups, referencesProps } from '../../plugins/_collections.js';
import { visit } from '../util/visit.js';

/**
 * @typedef CleanupOutDataParams
 * @property {boolean=} noSpaceAfterFlags
 * @property {boolean=} leadingZero
 * @property {boolean=} negativeExtraSpace
 */

const regReferencesUrl = /\burl\((["'])?#(.+?)\1\)/g;
const regReferencesHref = /^#(.+?)$/;
const regReferencesBegin = /(\w+)\.[a-zA-Z]/;

/**
 * Encode plain SVG data string into Data URI string.
 *
 * @param {string} str
 * @param {import('../types.js').DataUri=} type
 * @returns {string}
 */
export const encodeSVGDatauri = (str, type) => {
  let prefix = 'data:image/svg+xml';
  if (!type || type === 'base64') {
    // base64
    prefix += ';base64,';
    str = prefix + Buffer.from(str).toString('base64');
  } else if (type === 'enc') {
    // URI encoded
    str = prefix + ',' + encodeURIComponent(str);
  } else if (type === 'unenc') {
    // unencoded
    str = prefix + ',' + str;
  }
  return str;
};

/**
 * Decode SVG Data URI string into plain SVG string.
 *
 * @param {string} str
 * @returns {string}
 */
export const decodeSVGDatauri = (str) => {
  const regexp = /data:image\/svg\+xml(;charset=[^;,]*)?(;base64)?,(.*)/;
  const match = regexp.exec(str);

  // plain string
  if (!match) {
    return str;
  }

  const data = match[3];

  if (match[2]) {
    // base64
    str = Buffer.from(data, 'base64').toString('utf8');
  } else if (data.charAt(0) === '%') {
    // URI encoded
    str = decodeURIComponent(data);
  } else if (data.charAt(0) === '<') {
    // unencoded
    str = data;
  }
  return str;
};

/**
 * Convert a row of numbers to an optimized string view.
 *
 * @example
 * [0, -1, .5, .5] → "0-1 .5.5"
 *
 * @param {ReadonlyArray<number>} data
 * @param {CleanupOutDataParams} params
 * @param {import('../types.js').PathDataCommand=} command
 * @returns {string}
 */
export const cleanupOutData = (data, params, command) => {
  let str = '';
  let delimiter;
  /** @type {number} */
  let prev;

  data.forEach((item, i) => {
    // space delimiter by default
    delimiter = ' ';

    // no extra space in front of first number
    if (i == 0) {
      delimiter = '';
    }

    // no extra space after arc command flags (large-arc and sweep flags)
    // a20 60 45 0 1 30 20 → a20 60 45 0130 20
    if (params.noSpaceAfterFlags && (command == 'A' || command == 'a')) {
      const pos = i % 7;
      if (pos == 4 || pos == 5) {
        delimiter = '';
      }
    }

    // remove floating-point numbers leading zeros
    // 0.5 → .5
    // -0.5 → -.5
    const itemStr = params.leadingZero
      ? removeLeadingZero(item)
      : item.toString();

    // no extra space in front of negative number or
    // in front of a floating number if a previous number is floating too
    if (
      params.negativeExtraSpace &&
      delimiter != '' &&
      (item < 0 || (itemStr.charAt(0) === '.' && prev % 1 !== 0))
    ) {
      delimiter = '';
    }
    // save prev item value
    prev = item;
    str += delimiter + itemStr;
  });
  return str;
};

/**
 * Remove floating-point numbers leading zero.
 *
 * @param {number} value
 * @returns {string}
 * @example
 * 0.5 → .5
 * -0.5 → -.5
 */
export const removeLeadingZero = (value) => {
  const strValue = value.toString();

  if (0 < value && value < 1 && strValue.startsWith('0')) {
    return strValue.slice(1);
  }

  if (-1 < value && value < 0 && strValue[1] === '0') {
    return strValue[0] + strValue.slice(2);
  }

  return strValue;
};

const hasScriptsEventAttrs = [
  ...attrsGroups.animationEvent,
  ...attrsGroups.documentEvent,
  ...attrsGroups.documentElementEvent,
  ...attrsGroups.globalEvent,
  ...attrsGroups.graphicalEvent,
];

/** URI indicating the SVG namespace. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Matches a `javascript:` URI. Browsers parse the scheme case-insensitively
 * and ignore leading whitespace, so both are tolerated here too.
 */
const regJavaScriptUri = /^\s*javascript:/i;

/**
 * If the given attribute value is a `javascript:` URI, which browsers
 * execute when the link is followed.
 *
 * @param {string=} value Attribute value to check.
 * @returns {boolean} If the value is a `javascript:` URI.
 */
export const isJavaScriptUri = (value) =>
  value != null && regJavaScriptUri.test(value);

/**
 * Creates a tracker that resolves namespace prefixes to the URI they are
 * bound to while traversing the document. `enter` and `exit` must be called
 * from the respective visitor callbacks of every element to keep the
 * in-scope bindings balanced.
 */
export const createNamespaceResolver = () => {
  /** @type {Map<string, string>[]} */
  const scopes = [];

  return {
    /** @param {import('../types.js').XastElement} node */
    enter: (node) => {
      /** @type {Map<string, string>} */
      const bindings = new Map();
      for (const [name, value] of Object.entries(node.attributes)) {
        if (name.startsWith('xmlns:')) {
          bindings.set(name.slice('xmlns:'.length), value);
        }
      }
      scopes.push(bindings);
    },
    exit: () => {
      scopes.pop();
    },
    /**
     * @param {string} prefix Namespace prefix to resolve.
     * @returns {string | undefined} Namespace URI the prefix is currently
     *   bound to, or undefined if it's not bound.
     */
    resolve: (prefix) => {
      for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const uri = scopes[i].get(prefix);
        if (uri != null) {
          return uri;
        }
      }
      return undefined;
    },
  };
};

/**
 * If the element is a `<script>` element. This is the case for unprefixed
 * `script` elements, and for prefixed elements like `svg:script` whose
 * prefix resolves to the SVG namespace, which browsers execute the same as
 * an unprefixed `script`. Elements named `script` in other namespaces are
 * not scripts and are left alone.
 *
 * @param {import('../types.js').XastElement} node Current node to check against.
 * @param {(prefix: string) => string | undefined} resolvePrefix Resolves a
 *   namespace prefix to the URI it's bound to in the node's scope.
 * @returns {boolean} If the current node is a script element.
 */
export const isScriptElement = (node, resolvePrefix) => {
  if (node.name === 'script') {
    return true;
  }

  const colonIndex = node.name.indexOf(':');
  if (colonIndex === -1) {
    return false;
  }

  return (
    node.name.slice(colonIndex + 1) === 'script' &&
    resolvePrefix(node.name.slice(0, colonIndex)) === SVG_NAMESPACE
  );
};

/**
 * If the document contains any scripts. This looks at the whole document,
 * checking for script elements, event attributes, and links to
 * `javascript:` URIs.
 *
 * @param {import('../types.js').XastRoot} root Document to check against.
 * @returns {boolean} If the document contains scripts.
 */
export const hasScripts = (root) => {
  const nsResolver = createNamespaceResolver();
  let scriptsFound = false;

  visit(root, {
    element: {
      enter: (node) => {
        nsResolver.enter(node);

        if (scriptsFound) {
          return;
        }

        if (
          isScriptElement(node, nsResolver.resolve) &&
          node.children.length !== 0
        ) {
          scriptsFound = true;
          return;
        }

        if (node.name === 'a') {
          const hasJsLinks = Object.entries(node.attributes).some(
            ([attrKey, attrValue]) =>
              (attrKey === 'href' || attrKey.endsWith(':href')) &&
              isJavaScriptUri(attrValue),
          );

          if (hasJsLinks) {
            scriptsFound = true;
            return;
          }
        }

        if (
          hasScriptsEventAttrs.some((attr) => node.attributes[attr] != null)
        ) {
          scriptsFound = true;
        }
      },
      exit: () => {
        nsResolver.exit();
      },
    },
  });

  return scriptsFound;
};

/**
 * For example, a string that contains one or more of following would match and
 * return true:
 *
 * * `url(#gradient001)`
 * * `url('#gradient001')`
 *
 * @param {string} body
 * @returns {boolean} If the given string includes a URL reference.
 */
export const includesUrlReference = (body) => {
  return new RegExp(regReferencesUrl).test(body);
};

/**
 * @param {string} attribute
 * @param {string} value
 * @returns {string[]}
 */
export const findReferences = (attribute, value) => {
  const results = [];

  if (referencesProps.has(attribute)) {
    const matches = value.matchAll(regReferencesUrl);
    for (const match of matches) {
      results.push(match[2]);
    }
  }

  if (attribute === 'href' || attribute.endsWith(':href')) {
    const match = regReferencesHref.exec(value);
    if (match != null) {
      results.push(match[1]);
    }
  }

  if (attribute === 'begin') {
    const match = regReferencesBegin.exec(value);
    if (match != null) {
      results.push(match[1]);
    }
  }

  return results.map((body) => decodeURI(body));
};

/**
 * Does the same as {@link Number.toFixed} but without casting
 * the return value to a string.
 *
 * @param {number} num
 * @param {number} precision
 * @returns {number}
 */
export const toFixed = (num, precision) => {
  const pow = 10 ** precision;
  return Math.round(num * pow) / pow;
};
