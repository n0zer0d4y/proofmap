import Proofmap.Serve
import ProofmapTests.Harness

/-! `serve` request handling: path resolution never leaves the served folder,
and only local Host headers are answered. -/

namespace ProofmapTests

open Proofmap.Serve

def serveTests : TestM Unit := do
  checkEq "root" (resolve "/") (some [])
  checkEq "plain path" (resolve "/data/proofmap.json") (some ["data", "proofmap.json"])
  checkEq "query and fragment ignored" (resolve "/a.json?x=1#y") (some ["a.json"])
  checkEq "percent decoding" (resolve "/data/My%20File.json") (some ["data", "My File.json"])
  checkEq "UTF-8 decoding" (resolve "/%E2%8A%A2.json") (some ["⊢.json"])
  for bad in ["/../x", "/a/../../x", "/%2e%2e/x", "/data/..%2f..%2fx", "/..".push (Char.ofNat 92) ++ "x", "/C:/x",
      "/a%00b", "/%zz", "x", "/%C3", "/%5c..%5cx", "/%5c%5chost%5cshare", "/index.html::$DATA",
      "/CON", "/nul.txt", "/data/Com1.json", "/LPT9", "/conout$"] do
    checkEq s!"refused: {bad}" (resolve bad) none
  checkEq "request line"
    ((parseRequest "GET /a HTTP/1.1\r\nHost: localhost:80\r\nX: a:b").map fun r => (r.method, r.target, r.headers))
    (some ("GET", "/a", [("host", "localhost:80"), ("x", "a:b")]))
  checkEq "bad request line" ((parseRequest "GET\r\n").map (·.method)) none
  check "local host allowed" (hostAllowed 8080 (some "127.0.0.1:8080") && hostAllowed 8080 (some "LOCALHOST:8080"))
  check "foreign host refused" (!hostAllowed 8080 (some "evil.example") && !hostAllowed 8080 (some "localhost:9090"))
  check "host needs the port" (!hostAllowed 8080 (some "localhost") && !hostAllowed 8080 none)
  checkEq "device-like names that are fine" (["console.json", "com10.js", "nulls", "LPT"].map isDeviceName) [false, false, false, false]
  checkEq "content types" (["a.html", "b.JSON", "c.js", "d"].map contentType)
    ["text/html; charset=utf-8", "application/json", "text/javascript; charset=utf-8", "application/octet-stream"]

end ProofmapTests
