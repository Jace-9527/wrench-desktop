const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("./tool-utils.js");

const sampleCert = `-----BEGIN CERTIFICATE-----
MIIDgjCCAmqgAwIBAgIUM/8lZHIYSrNaHnhEqUmtnHSfEOYwDQYJKoZIhvcNAQEL
BQAwOzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MQ8wDQYDVQQKDAZXcmVuY2gxETAP
BgNVBAsMCEZyb250ZW5kMB4XDTI2MDYxODA4MjYyN1oXDTI2MDYxOTA4MjYyN1ow
OzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MQ8wDQYDVQQKDAZXcmVuY2gxETAPBgNV
BAsMCEZyb250ZW5kMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtqlB
l7LBNVTmtbPGh6Bu3jgi+KLf3BHsnSFdavCSlo8Kh/C6OPFc2vR0o/SM9JA0T66x
0tDZvaM1CEmA9J0QRez5zQ2Fhx99Ha5F+faPkytlkQIOaYN/PfbXvjGLZnTgdBS5
apNn9LzHmo9UzS/Qj4EKtOqu0oMBjNxmTVuIBvAA6fMaKePhESzL/+gZxLmIKZds
UVDsKn7/wQNZqTIhOInGRlEsOLcDFayRb1nJSLL3HUiPodjmp0yf0D4B2MScp/uV
TD9rCu6KeSjgXXIauFZcPxI+91IbwDJo3GL3u9TMlgSQcRfGFE/ARJEtJsY2N3RI
lEbYW4POlL9WPT+ahQIDAQABo34wfDAdBgNVHQ4EFgQUfLyj1JTF0kVimv/MsjF7
BmDBnhkwHwYDVR0jBBgwFoAUfLyj1JTF0kVimv/MsjF7BmDBnhkwDwYDVR0TAQH/
BAUwAwEB/zApBgNVHREEIjAgggxleGFtcGxlLnRlc3SCEHd3dy5leGFtcGxlLnRl
c3QwDQYJKoZIhvcNAQELBQADggEBACtmiU3GhlC3NN+KUe/oksYFu1jN3Fs2z9kZ
7GxykCT4giWsBQPqb/MvA+8XjJ1XUUw8NdeIb5ESng/gOh+E/IUfbfa+kIY4RVUm
eJ4GY/GlIx4xGjml5W6bEJKAYx1UInRnHpWC63cUK9N4EmvckGJVABDldt6hty+t
VACZ+WJeW5cY3JIYkJkDKS42G/5wxAtRj4fvJrMwmDexFd8JB4iFLUrAFmMMZfsN
YKllQC5q/BfFcri0YP065JHQkiGa2s5EuK/HxLz+bLYFkev3vp9ZvbgGXowbv7Mw
KjrxFVSwsZWUmuzHIl1u0pbwJMpTN0+ZuswPIbv8kfudQ0SW2/k=
-----END CERTIFICATE-----`;

const sampleCSR = `-----BEGIN CERTIFICATE REQUEST-----
MIICyDCCAbACAQAwPzEZMBcGA1UEAwwQY3NyLmV4YW1wbGUudGVzdDEPMA0GA1UE
CgwGV3JlbmNoMREwDwYDVQQLDAhGcm9udGVuZDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALapQZeywTVU5rWzxoegbt44Ivii39wR7J0hXWrwkpaPCofw
ujjxXNr0dKP0jPSQNE+usdLQ2b2jNQhJgPSdEEXs+c0NhYcffR2uRfn2j5MrZZEC
DmmDfz32174xi2Z04HQUuWqTZ/S8x5qPVM0v0I+BCrTqrtKDAYzcZk1biAbwAOnz
Ginj4REsy//oGcS5iCmXbFFQ7Cp+/8EDWakyITiJxkZRLDi3AxWskW9ZyUiy9x1I
j6HY5qdMn9A+AdjEnKf7lUw/awruinko4F1yGrhWXD8SPvdSG8AyaNxi97vUzJYE
kHEXxhRPwESRLSbGNjd0SJRG2FuDzpS/Vj0/moUCAwEAAaBEMEIGCSqGSIb3DQEJ
DjE1MDMwMQYDVR0RBCowKIIQY3NyLmV4YW1wbGUudGVzdIIUd3d3LmNzci5leGFt
cGxlLnRlc3QwDQYJKoZIhvcNAQELBQADggEBABpcj9QschuZjnfDOwCHfqtTQ1Dk
05qkuIC80f1q7KIVOSS5lAtF884QSYq2EoYa0G/hdNVFcLUmqo4g/CfGHKyVd9YH
WEuZflS8D+adhs1JPFTzmtnT7YEnfjA8bkfnHg++cCsjCw+eY14vL7toh/n6t4BP
xzYxRthpV/6PpGA89k5mIDD4BNtqYAp853sZEyVr52bcij0MfR77v4hBBVx/otOi
MWkyewg1jtsbs9DAeaWpfCvdmbNEWvg1zRFr23hhcIzUFtXuckZADwezKrfNO77F
GIvpPuWFDmim12W4jP8Hrw30/kbQyfAjn9NXxTDiuxl+jmxEXkz1IgH5daY=
-----END CERTIFICATE REQUEST-----`;

test("formatJSONText extracts JSON from log text", () => {
  const input = "2026-06-03T10:24:59.020615572+08:00 stderr F {\"ok\":true,\"items\":[1,2]} trailing";
  assert.equal(utils.formatJSONText(input, 2), "{\n  \"ok\": true,\n  \"items\": [\n    1,\n    2\n  ]\n}");
});

test("minifyJSONText handles arrays and string delimiters", () => {
  const input = "prefix [\"}\",{\"a\":1}] suffix";
  assert.equal(utils.minifyJSONText(input), "[\"}\",{\"a\":1}]");
});

test("base64 UTF-8 round trip", () => {
  const encoded = utils.utf8ToBase64("中文 test");
  assert.equal(encoded, "5Lit5paHIHRlc3Q=");
  assert.equal(utils.base64ToUtf8(encoded), "中文 test");
});

test("URL encode and decode", () => {
  const encoded = utils.encodeURLText("name=张三&x=1 2");
  assert.equal(encoded, "name%3D%E5%BC%A0%E4%B8%89%26x%3D1%202");
  assert.equal(utils.decodeURLText("name%3D%E5%BC%A0%E4%B8%89%26x%3D1+2"), "name=张三&x=1 2");
});

test("toPGArray auto formats numeric IDs", () => {
  assert.equal(utils.toPGArray("1\n2, 3，4"), "(1,2,3,4)");
});

test("toPGArray formats string IDs and escapes quotes", () => {
  assert.equal(utils.toPGArray("Hjx1121 Nkjda O'Reilly"), "('Hjx1121','Nkjda','O''Reilly')");
});

test("toPGArray supports forced modes and duplicates", () => {
  assert.equal(utils.toPGArray("1 1 2", { mode: "string", unique: false }), "('1','1','2')");
  assert.throws(() => utils.toPGArray("1 A", { mode: "number" }), /数字模式包含非数字值/);
});

test("normalizePEM wraps escaped CSR input", () => {
  const body = sampleCSR
    .replace("-----BEGIN CERTIFICATE REQUEST-----", "")
    .replace("-----END CERTIFICATE REQUEST-----", "")
    .replace(/\s+/g, "");
  const escaped = `-----BEGIN CERTIFICATE REQUEST-----\\n${body}\\n-----END CERTIFICATE REQUEST-----`;
  const normalized = utils.normalizePEM(escaped, "csr");
  assert.match(normalized, /^-----BEGIN CERTIFICATE REQUEST-----\n/);
  assert.match(normalized, /\n-----END CERTIFICATE REQUEST-----\n$/);
  assert.equal(normalized.split("\n")[1].length, 64);
});

test("splitCertificatePEMs splits certificate chains", () => {
  const certs = utils.splitCertificatePEMs(`${sampleCert}\n${sampleCert}`);
  assert.equal(certs.length, 2);
  assert.equal(certs[0], utils.normalizePEM(sampleCert, "cert"));
});

test("parseCertificatePEM extracts common fields", async () => {
  const cert = await utils.parseCertificatePEM(sampleCert);
  assert.equal(cert.subject, "CN=example.test, O=Wrench, OU=Frontend");
  assert.equal(cert.issuer, "CN=example.test, O=Wrench, OU=Frontend");
  assert.equal(cert.publicKeyAlgorithm, "RSA");
  assert.equal(cert.publicKeySize, 2048);
  assert.equal(cert.signatureAlgorithm, "SHA256-RSA");
  assert.equal(cert.version, 3);
  assert.equal(cert.isCA, true);
  assert.equal(cert.sha1.length, 40);
});

test("parseCSRPEM extracts subject and SAN", () => {
  const csr = utils.parseCSRPEM(sampleCSR);
  assert.equal(csr.subject, "CN=csr.example.test, O=Wrench, OU=Frontend");
  assert.equal(csr.commonName, "csr.example.test");
  assert.deepEqual(csr.dnsNames, ["csr.example.test", "www.csr.example.test"]);
  assert.equal(csr.publicKeyAlgorithm, "RSA");
  assert.equal(csr.publicKeySize, 2048);
  assert.equal(csr.signatureAlgorithm, "SHA256-RSA");
});
