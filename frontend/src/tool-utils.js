(function (root) {
  const pemHeaders = {
    cert: {
      header: "-----BEGIN CERTIFICATE-----",
      footer: "-----END CERTIFICATE-----"
    },
    csr: {
      header: "-----BEGIN CERTIFICATE REQUEST-----",
      footer: "-----END CERTIFICATE REQUEST-----"
    }
  };

  const oidNames = {
    "1.2.840.113549.1.1.1": "RSA",
    "1.2.840.10045.2.1": "ECDSA",
    "1.2.156.10197.1.301": "SM2",
    "1.2.840.113549.1.1.5": "SHA1-RSA",
    "1.2.840.113549.1.1.11": "SHA256-RSA",
    "1.2.840.113549.1.1.12": "SHA384-RSA",
    "1.2.840.113549.1.1.13": "SHA512-RSA",
    "1.2.840.10045.4.3.2": "ECDSA-SHA256",
    "1.2.840.10045.4.3.3": "ECDSA-SHA384",
    "1.2.840.10045.4.3.4": "ECDSA-SHA512",
    "1.2.156.10197.1.501": "SM2-SM3",
    "2.5.4.3": "CN",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "2.5.29.17": "subjectAltName",
    "2.5.29.19": "basicConstraints",
    "1.2.840.113549.1.9.14": "extensionRequest"
  };

  function normalizeEscapedText(input) {
    return String(input || "")
      .trim()
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function stripWhitespaceText(s) {
    return String(s || "").trim().replace(/[\s\t\n\r]/g, "");
  }

  function wrapPEMBody(body) {
    const clean = stripWhitespaceText(body);
    const lines = [];
    for (let i = 0; i < clean.length; i += 64) {
      lines.push(clean.slice(i, i + 64));
    }
    return lines.join("\n");
  }

  function extractPEMBody(input, kind) {
    const spec = pemHeaders[kind];
    if (!spec) throw new Error("unknown PEM kind");

    const text = normalizeEscapedText(input);
    const start = text.indexOf(spec.header);
    const end = text.indexOf(spec.footer, start + spec.header.length);
    if (start === -1 || end === -1) return text;
    return text.slice(start + spec.header.length, end).trim();
  }

  function normalizePEM(input, kind) {
    const spec = pemHeaders[kind];
    if (!spec) throw new Error("unknown PEM kind");

    const body = stripWhitespaceText(extractPEMBody(input, kind));
    if (!body) {
      throw new Error(kind === "csr" ? "csr body is empty" : "certificate body is empty");
    }
    return `${spec.header}\n${wrapPEMBody(body)}\n${spec.footer}\n`;
  }

  function splitCertificatePEMs(input) {
    const spec = pemHeaders.cert;
    const text = normalizeEscapedText(input);
    const certs = [];
    let current = 0;

    while (current < text.length) {
      const start = text.indexOf(spec.header, current);
      if (start === -1) break;
      const footerStart = text.indexOf(spec.footer, start + spec.header.length);
      if (footerStart === -1) throw new Error("incomplete certificate found: missing footer");
      const end = footerStart + spec.footer.length;
      certs.push(normalizePEM(text.slice(start, end), "cert"));
      current = end;
    }

    if (certs.length === 0) {
      certs.push(normalizePEM(text, "cert"));
    }

    return certs;
  }

  function bytesFromBase64(base64Text) {
    const body = stripWhitespaceText(base64Text).replace(/-/g, "+").replace(/_/g, "/");
    const binary = root.atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function pemToBytes(pem, kind) {
    return bytesFromBase64(extractPEMBody(pem, kind));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha1Hex(bytes) {
    if (!root.crypto || !root.crypto.subtle) throw new Error("crypto.subtle is not available");
    const digest = await root.crypto.subtle.digest("SHA-1", bytes);
    return bytesToHex(new Uint8Array(digest)).toUpperCase();
  }

  function decodeDER(bytes) {
    function readLength(offset) {
      const first = bytes[offset];
      if (first < 0x80) return { length: first, bytesRead: 1 };
      const count = first & 0x7f;
      if (count === 0 || count > 4) throw new Error("unsupported ASN.1 length");
      let length = 0;
      for (let i = 0; i < count; i += 1) {
        length = (length << 8) | bytes[offset + 1 + i];
      }
      return { length, bytesRead: 1 + count };
    }

    function parseNode(offset, limit) {
      if (offset >= limit) throw new Error("unexpected ASN.1 end");
      const tagByte = bytes[offset];
      const tag = tagByte & 0x1f;
      const cls = tagByte >> 6;
      const constructed = (tagByte & 0x20) !== 0;
      const lenInfo = readLength(offset + 1);
      const headerLength = 1 + lenInfo.bytesRead;
      const valueStart = offset + headerLength;
      const valueEnd = valueStart + lenInfo.length;
      if (valueEnd > limit) throw new Error("ASN.1 length exceeds input");

      const node = {
        tag,
        cls,
        constructed,
        start: offset,
        headerLength,
        valueStart,
        valueEnd,
        end: valueEnd,
        children: [],
        bytes
      };

      if (constructed || tag === 16 || tag === 17) {
        let childOffset = valueStart;
        while (childOffset < valueEnd) {
          const child = parseNode(childOffset, valueEnd);
          node.children.push(child);
          childOffset = child.end;
        }
      }

      return node;
    }

    const rootNode = parseNode(0, bytes.length);
    if (rootNode.end !== bytes.length) throw new Error("trailing ASN.1 data");
    return rootNode;
  }

  function nodeBytes(node) {
    return node.bytes.slice(node.valueStart, node.valueEnd);
  }

  function integerToBigInt(node) {
    let value = 0n;
    for (const b of nodeBytes(node)) {
      value = (value << 8n) + BigInt(b);
    }
    return value;
  }

  function integerToDecimal(node) {
    return integerToBigInt(node).toString(10);
  }

  function integerBitLength(node) {
    const data = Array.from(nodeBytes(node));
    while (data.length > 0 && data[0] === 0) data.shift();
    if (data.length === 0) return 0;
    let bits = (data.length - 1) * 8;
    let first = data[0];
    while (first > 0) {
      bits += 1;
      first >>= 1;
    }
    return bits;
  }

  function decodeOID(node) {
    const data = nodeBytes(node);
    if (data.length === 0) return "";
    const first = data[0];
    const parts = [Math.floor(first / 40), first % 40];
    let value = 0;
    for (let i = 1; i < data.length; i += 1) {
      value = (value << 7) | (data[i] & 0x7f);
      if ((data[i] & 0x80) === 0) {
        parts.push(value);
        value = 0;
      }
    }
    return parts.join(".");
  }

  function decodeStringNode(node) {
    const data = nodeBytes(node);
    if (node.tag === 30) {
      let out = "";
      for (let i = 0; i + 1 < data.length; i += 2) {
        out += String.fromCharCode((data[i] << 8) | data[i + 1]);
      }
      return out;
    }
    if (node.tag === 12) return new TextDecoder("utf-8").decode(data);
    return new TextDecoder("latin1").decode(data);
  }

  function decodeTime(node) {
    const value = decodeStringNode(node);
    if (node.tag === 23) {
      const year = parseInt(value.slice(0, 2), 10);
      const fullYear = year >= 50 ? 1900 + year : 2000 + year;
      return new Date(Date.UTC(
        fullYear,
        parseInt(value.slice(2, 4), 10) - 1,
        parseInt(value.slice(4, 6), 10),
        parseInt(value.slice(6, 8), 10),
        parseInt(value.slice(8, 10), 10),
        parseInt(value.slice(10, 12), 10)
      )).toISOString();
    }
    if (node.tag === 24) {
      return new Date(Date.UTC(
        parseInt(value.slice(0, 4), 10),
        parseInt(value.slice(4, 6), 10) - 1,
        parseInt(value.slice(6, 8), 10),
        parseInt(value.slice(8, 10), 10),
        parseInt(value.slice(10, 12), 10),
        parseInt(value.slice(12, 14), 10)
      )).toISOString();
    }
    return value;
  }

  function parseName(nameNode) {
    const pairs = [];
    const fields = {
      commonName: "",
      country: [],
      organization: [],
      organizationalUnit: [],
      locality: [],
      province: []
    };

    nameNode.children.forEach(setNode => {
      setNode.children.forEach(attrNode => {
        const oid = decodeOID(attrNode.children[0]);
        const label = oidNames[oid] || oid;
        const value = decodeStringNode(attrNode.children[1]);
        pairs.push(`${label}=${value}`);
        if (label === "CN") fields.commonName = value;
        if (label === "C") fields.country.push(value);
        if (label === "O") fields.organization.push(value);
        if (label === "OU") fields.organizationalUnit.push(value);
        if (label === "L") fields.locality.push(value);
        if (label === "ST") fields.province.push(value);
      });
    });

    return { text: pairs.join(", "), fields };
  }

  function parseAlgorithmIdentifier(node) {
    const oid = node && node.children[0] ? decodeOID(node.children[0]) : "";
    return oidNames[oid] || oid || "N/A";
  }

  function parseSubjectPublicKeyInfo(node) {
    const algorithm = parseAlgorithmIdentifier(node.children[0]);
    let publicKeySize = 0;
    if (algorithm === "RSA" && node.children[1]) {
      try {
        const bitString = node.children[1];
        const keyBytes = node.bytes.slice(bitString.valueStart + 1, bitString.valueEnd);
        const rsaKey = decodeDER(keyBytes);
        if (rsaKey.children[0]) publicKeySize = integerBitLength(rsaKey.children[0]);
      } catch (e) {
        publicKeySize = 0;
      }
    } else if ((algorithm === "ECDSA" || algorithm === "SM2") && node.children[1]) {
      publicKeySize = Math.max(0, node.children[1].valueEnd - node.children[1].valueStart - 1) * 8;
    }
    return { algorithm, publicKeySize };
  }

  function parseGeneralNames(node) {
    const out = {
      dnsNames: [],
      emailAddresses: [],
      ipAddresses: [],
      uris: []
    };

    node.children.forEach(name => {
      const data = nodeBytes(name);
      if (name.cls !== 2) return;
      if (name.tag === 1) out.emailAddresses.push(new TextDecoder("latin1").decode(data));
      if (name.tag === 2) out.dnsNames.push(new TextDecoder("latin1").decode(data));
      if (name.tag === 6) out.uris.push(new TextDecoder("latin1").decode(data));
      if (name.tag === 7) out.ipAddresses.push(Array.from(data).join("."));
    });

    return out;
  }

  function mergeGeneralNames(target, names) {
    target.dnsNames.push(...names.dnsNames);
    target.emailAddresses.push(...names.emailAddresses);
    target.ipAddresses.push(...names.ipAddresses);
    target.uris.push(...names.uris);
  }

  function parseExtensionList(node) {
    const result = {
      isCA: false,
      dnsNames: [],
      emailAddresses: [],
      ipAddresses: [],
      uris: []
    };

    node.children.forEach(ext => {
      const oid = decodeOID(ext.children[0]);
      let valueNode = ext.children[1];
      if (valueNode && valueNode.tag === 1) valueNode = ext.children[2];
      if (!valueNode || valueNode.tag !== 4) return;

      try {
        const inner = decodeDER(nodeBytes(valueNode));
        if (oid === "2.5.29.19") {
          const caNode = inner.children.find(child => child.tag === 1);
          result.isCA = Boolean(caNode && nodeBytes(caNode)[0] !== 0);
        }
        if (oid === "2.5.29.17") {
          mergeGeneralNames(result, parseGeneralNames(inner));
        }
      } catch (e) {
        // Keep the parser tolerant for extensions it does not handle yet.
      }
    });

    return result;
  }

  function parseCSRAttributes(attributesNode) {
    const extensions = {
      dnsNames: [],
      emailAddresses: [],
      ipAddresses: [],
      uris: []
    };
    if (!attributesNode) return extensions;

    attributesNode.children.forEach(attr => {
      if (!attr.children || attr.children.length < 2) return;
      const oid = decodeOID(attr.children[0]);
      if (oid !== "1.2.840.113549.1.9.14") return;
      const values = attr.children[1];
      const extensionList = values.children[0];
      if (!extensionList) return;
      const parsed = parseExtensionList(extensionList);
      mergeGeneralNames(extensions, parsed);
    });

    return extensions;
  }

  async function parseCertificatePEM(pem) {
    const normalized = normalizePEM(pem, "cert");
    const bytes = pemToBytes(normalized, "cert");
    const rootNode = decodeDER(bytes);
    const tbs = rootNode.children[0];
    let index = 0;
    let version = 1;

    if (tbs.children[0] && tbs.children[0].cls === 2 && tbs.children[0].tag === 0) {
      version = Number(integerToBigInt(tbs.children[0].children[0])) + 1;
      index = 1;
    }

    const serialNumber = integerToDecimal(tbs.children[index]);
    const issuer = parseName(tbs.children[index + 2]);
    const validity = tbs.children[index + 3];
    const subject = parseName(tbs.children[index + 4]);
    const signatureAlgorithm = parseAlgorithmIdentifier(tbs.children[index + 1]);
    const publicKey = parseSubjectPublicKeyInfo(tbs.children[index + 5]);
    const extensionWrapper = tbs.children.find(child => child.cls === 2 && child.tag === 3);
    const extensions = extensionWrapper && extensionWrapper.children[0] ? parseExtensionList(extensionWrapper.children[0]) : { isCA: false };

    return {
      pem: normalized,
      subject: subject.text,
      issuer: issuer.text,
      notBefore: decodeTime(validity.children[0]),
      notAfter: decodeTime(validity.children[1]),
      serialNumber,
      version,
      isCA: Boolean(extensions.isCA),
      sha1: await sha1Hex(bytes),
      publicKeyAlgorithm: publicKey.algorithm,
      publicKeySize: publicKey.publicKeySize,
      signatureAlgorithm
    };
  }

  function parseCSRPEM(csr) {
    const normalized = normalizePEM(csr, "csr");
    const rootNode = decodeDER(pemToBytes(normalized, "csr"));
    const cri = rootNode.children[0];
    const subject = parseName(cri.children[1]);
    const publicKey = parseSubjectPublicKeyInfo(cri.children[2]);
    const extensions = parseCSRAttributes(cri.children.find(child => child.cls === 2 && child.tag === 0));

    return {
      pem: normalized,
      subject: subject.text,
      commonName: subject.fields.commonName,
      country: subject.fields.country,
      organization: subject.fields.organization,
      organizationalUnit: subject.fields.organizationalUnit,
      locality: subject.fields.locality,
      province: subject.fields.province,
      dnsNames: extensions.dnsNames,
      emailAddresses: extensions.emailAddresses,
      ipAddresses: extensions.ipAddresses,
      uris: extensions.uris,
      publicKeyAlgorithm: publicKey.algorithm,
      publicKeySize: publicKey.publicKeySize,
      signatureAlgorithm: parseAlgorithmIdentifier(rootNode.children[1])
    };
  }

  function extractJSONText(input) {
    const source = String(input || "").trim();
    let startIdx = -1;
    let startChar = "";

    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{" || ch === "[") {
        startIdx = i;
        startChar = ch;
        break;
      }
    }

    if (startIdx === -1) return source;

    const endChar = startChar === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < source.length; i += 1) {
      const ch = source[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === startChar) {
        depth += 1;
      } else if (ch === endChar) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIdx, i + 1);
        }
      }
    }

    return source;
  }

  function formatJSONText(input, indent) {
    const source = String(input || "").trim();
    if (!source) throw new Error("输入为空");

    const jsonText = extractJSONText(source);
    try {
      return JSON.stringify(JSON.parse(jsonText), null, Math.max(0, indent || 2));
    } catch (e) {
      throw new Error("invalid JSON: " + e.message);
    }
  }

  function minifyJSONText(input) {
    const source = String(input || "").trim();
    if (!source) throw new Error("输入为空");

    const jsonText = extractJSONText(source);
    try {
      return JSON.stringify(JSON.parse(jsonText));
    } catch (e) {
      throw new Error("invalid JSON: " + e.message);
    }
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return root.btoa(binary);
  }

  function base64ToUtf8(base64Text) {
    let normalized = (base64Text || "")
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }
    const binary = root.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function encodeURLText(text) {
    return encodeURIComponent(text);
  }

  function decodeURLText(text) {
    return decodeURIComponent(String(text || "").replace(/\+/g, " "));
  }

  function splitIDText(input) {
    return String(input || "")
      .replace(/[，、；;]/g, ",")
      .split(/[\s,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function isNumericID(value) {
    return /^[-+]?(?:\d+|\d+\.\d+)$/.test(value);
  }

  function quoteSQLString(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  function toPGArray(input, options = {}) {
    const mode = options.mode || "auto";
    const unique = options.unique !== false;
    let items = splitIDText(input);

    if (unique) {
      items = Array.from(new Set(items));
    }

    if (items.length === 0) {
      throw new Error("输入为空");
    }

    let effectiveMode = mode;
    if (effectiveMode === "auto") {
      effectiveMode = items.every(isNumericID) ? "number" : "string";
    }

    if (effectiveMode === "number") {
      const invalid = items.find(item => !isNumericID(item));
      if (invalid) {
        throw new Error("数字模式包含非数字值：" + invalid);
      }
      return "(" + items.join(",") + ")";
    }

    if (effectiveMode === "string") {
      return "(" + items.map(quoteSQLString).join(",") + ")";
    }

    throw new Error("未知输出模式");
  }

  const api = {
    normalizeEscapedText,
    normalizePEM,
    splitCertificatePEMs,
    pemToBytes,
    parseCertificatePEM,
    parseCSRPEM,
    extractJSONText,
    formatJSONText,
    minifyJSONText,
    utf8ToBase64,
    base64ToUtf8,
    encodeURLText,
    decodeURLText,
    splitIDText,
    toPGArray
  };

  root.WrenchUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
