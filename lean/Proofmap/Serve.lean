import ProofmapCompat.Serve
import Lean.Data.Json
import Proofmap.Util

/-!
# `serve`

A minimal HTTP/1.1 server for the generated viewer: GET and HEAD only, one request per
connection, bound to 127.0.0.1 so it is private by default. It serves the files under one
directory, with the page at `/`, plus `/__proofmap/version`, which returns the current build id.
The viewer polls that endpoint every 2 s and reloads when it changes; that is the live reload.

Only the socket calls differ between toolchains (`ProofmapCompat.Serve`); everything here is
shared.
-/

namespace Proofmap.Serve

/-- What `serve` serves: the files under `root`, with `index` (a file in `root`) at `/`. -/
structure Site where
  root : System.FilePath
  index : String
  deriving Inhabited

def contentType (file : String) : String :=
  match ((file.splitOn ".").getLast?.getD "").toLower with
  | "html" => "text/html; charset=utf-8"
  | "json" => "application/json"
  | "js" => "text/javascript; charset=utf-8"
  | "css" => "text/css; charset=utf-8"
  | "svg" => "image/svg+xml"
  | "png" => "image/png"
  | "txt" => "text/plain; charset=utf-8"
  | _ => "application/octet-stream"

private def hexVal? (c : Char) : Option Nat :=
  if '0' ≤ c && c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c && c ≤ 'f' then some (c.toNat - 'a'.toNat + 10)
  else if 'A' ≤ c && c ≤ 'F' then some (c.toNat - 'A'.toNat + 10)
  else none

/-- Decode `%XX` escapes (as UTF-8). `none` for a malformed escape or invalid UTF-8. -/
def percentDecode (s : String) : Option String := Id.run do
  let cs := s.toList.toArray
  let mut out := ByteArray.empty
  let mut i := 0
  while i < cs.size do
    let c := cs[i]!
    if c == '%' then
      let some h := (cs[i+1]?).bind hexVal? | return none
      let some l := (cs[i+2]?).bind hexVal? | return none
      out := out.push (h * 16 + l).toUInt8
      i := i + 3
    else
      out := out ++ c.toString.toUTF8
      i := i + 1
  String.fromUTF8? out

/-- Windows device names (`CON`, `NUL`, `COM1`, ...), which name a device in every folder,
with or without an extension. -/
def isDeviceName (seg : String) : Bool :=
  let stem := ((seg.splitOn ".").headD "").trimAscii.toString.toUpper
  ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains stem ||
    ((stem.startsWith "COM" || stem.startsWith "LPT") && stem.length == 4 &&
      (stem.toList.getLast?.getD 'x').isDigit)

/-- The path segments of a request target, or `none` when it could escape the served
directory (`..`, `.`, encoded slashes, backslashes (so UNC paths too), drive letters, `:`
anywhere (alternate data streams), NUL, Windows device names) or is malformed.
Segments are checked after decoding, so `..%2f` cannot slip through. Query and fragment are
ignored. `/` gives `[]`. -/
def resolve (target : String) : Option (List String) := do
  let path := ((target.splitOn "?").headD "").splitOn "#" |>.headD ""
  guard (path.startsWith "/")
  let segs ← ((path.drop 1).toString.splitOn "/").filter (· ≠ "") |>.mapM percentDecode
  guard <| segs.all fun s =>
    s ≠ "." && s ≠ ".." && !isDeviceName s &&
      !s.any (fun c => c == '/' || c == '\\' || c == ':' || c == '\x00')
  return segs

/-- Request line and headers, as sent. -/
structure Request where
  method : String
  target : String
  headers : List (String × String)

def parseRequest (head : String) : Option Request := do
  let lines := head.splitOn "\r\n"
  let first ← lines.head?
  let [method, target, _version] := first.splitOn " " | none
  let headers := lines.tail.filterMap fun l =>
    match l.splitOn ":" with
    | k :: v :: rest => some (k.trimAscii.toString.toLower, (":".intercalate (v :: rest)).trimAscii.toString)
    | _ => none
  return { method, target, headers }

/-- Only requests addressed to this machine by name are answered. A web page elsewhere can
make the browser resolve its own host name to 127.0.0.1 (DNS rebinding); its requests then
carry that foreign host name and are refused. -/
def hostAllowed (port : UInt16) (host : Option String) : Bool :=
  match host with
  | none => false
  | some h => [s!"127.0.0.1:{port}", s!"localhost:{port}"].contains h.toLower

/-- Whether `file`, with links resolved, is inside `root` (compared case-insensitively where
the file system is). A second line of defence after `resolve`. -/
def isInside (root file : System.FilePath) : IO Bool := do
  let norm (p : System.FilePath) : String :=
    let s := p.toString.map fun c => if c == '\\' then '/' else c
    if System.Platform.isWindows || System.Platform.isOSX then s.toLower else s
  let r := norm (← IO.FS.realPath root)
  let f := norm (← IO.FS.realPath file)
  return f.startsWith (if r.endsWith "/" then r else r ++ "/")

def response (status : String) (ctype : String) (body : ByteArray) (withBody := true)
    (extra : List String := []) : ByteArray :=
  let hdrs := [s!"HTTP/1.1 {status}", s!"Content-Type: {ctype}", s!"Content-Length: {body.size}",
    "Cache-Control: no-store", "X-Content-Type-Options: nosniff", "Connection: close"] ++ extra
  ("\r\n".intercalate hdrs ++ "\r\n\r\n").toUTF8 ++ (if withBody then body else .empty)

def textResponse (status : String) (msg : String) (withBody := true) (extra : List String := []) : ByteArray :=
  response status "text/plain; charset=utf-8" (msg ++ "\n").toUTF8 withBody extra

/-- Changes whenever the page or its data is rewritten (size and modification time). -/
def buildId (site : Site) : IO String := do
  let mut parts := #[]
  for f in [site.root / site.index, site.root / "data" / "page.json"] do
    if ← f.pathExists then
      let m ← f.metadata
      parts := parts.push s!"{m.byteSize}-{m.modified.sec}-{m.modified.nsec}"
  return "/".intercalate parts.toList

/-- Answer one request (pure routing on top of the file system). -/
def answer (site : Site) (port : UInt16) (req : Request) : IO ByteArray := do
  let withBody := req.method == "GET"
  unless req.method == "GET" || req.method == "HEAD" do
    return textResponse "405 Method Not Allowed" "only GET and HEAD are supported" (extra := ["Allow: GET, HEAD"])
  unless hostAllowed port (req.headers.lookup "host") do
    return textResponse "403 Forbidden" "proofmap serve only answers requests for 127.0.0.1 or localhost" withBody
  let some segs := resolve req.target | return textResponse "400 Bad Request" "bad path" withBody
  if segs == ["__proofmap", "version"] then
    let id ← buildId site
    -- The project folder, for "Open in VS Code" links; served on 127.0.0.1 only.
    let root := Proofmap.Util.slashes (← IO.currentDir)
    return response "200 OK" "application/json" (Lean.Json.compress (.mkObj [("build", .str id), ("root", .str root)])).toUTF8 withBody
  let file := if segs.isEmpty then site.root / site.index else segs.foldl (fun (p : System.FilePath) (s : String) => p / s) site.root
  if ← file.isDir then return textResponse "404 Not Found" "not found" withBody
  unless ← file.pathExists do return textResponse "404 Not Found" "not found" withBody
  unless ← isInside site.root file do return textResponse "404 Not Found" "not found" withBody
  let body ← IO.FS.readBinFile file
  return response "200 OK" (contentType (segs.getLast?.getD site.index)) body withBody

private def headEnd? (b : ByteArray) : Option Nat := Id.run do
  if b.size < 4 then return none
  for i in [0:b.size - 3] do
    if b[i]! == 13 && b[i+1]! == 10 && b[i+2]! == 13 && b[i+3]! == 10 then return some i
  return none

/-- Read up to the end of the request head (at most 64 KiB). -/
partial def readHead (c : Compat.Conn) (acc : ByteArray := .empty) : IO (Option String) := do
  if let some i := headEnd? acc then return String.fromUTF8? (acc.extract 0 i)
  if acc.size > 65536 then return none
  match ← c.recv? with
  | some b => if b.isEmpty then return none else readHead c (acc ++ b)
  | none => return none

def handle (site : Site) (port : UInt16) (c : Compat.Conn) : IO Unit := do
  try
    let reply ← match (← readHead c).bind parseRequest with
      | some req => answer site port req
      | none => pure (textResponse "400 Bad Request" "malformed request")
    c.send reply
  catch e =>
    IO.eprintln s!"proofmap serve: {e}"
  try c.close catch _ => pure ()

/-- Accept connections forever; each is handled on its own thread. -/
partial def run (l : Compat.Listener) (site : Site) : IO Unit := do
  let c ← l.accept
  let _ ← IO.asTask (prio := .dedicated) (handle site l.port c)
  run l site

end Proofmap.Serve
