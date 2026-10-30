import Std.Internal.Async.TCP

/-!
Socket adapter for `serve` on toolchains with the TCP API under `Std.Internal` (such as v4.29.0). Selected by the lakefile; the
counterpart lives in `compat/async`. Only the module that provides the TCP API differs
between toolchains, so this file is a thin wrapper and the HTTP handling itself is shared
(`Proofmap/Serve.lean`).
-/

namespace Proofmap.Compat

open Std.Internal.IO.Async.TCP Std.Net

/-- The socket API `serve` uses on this toolchain (shown by `proofmap --version`). -/
def serveBackend : String := "Std.Internal.IO.Async.TCP"

/-- One accepted connection, with blocking operations. -/
structure Conn where
  /-- Up to 64 KiB, or `none` once the peer has closed its side. -/
  recv? : IO (Option ByteArray)
  send : ByteArray → IO Unit
  close : IO Unit

/-- A listening socket on 127.0.0.1, and the port it is bound to. -/
structure Listener where
  private server : Socket.Server
  port : UInt16

/-- Listen on 127.0.0.1 only (`serve` is private by default). Port 0 picks a free port. -/
def listenLocal (port : UInt16) : IO Listener := do
  let server ← Socket.Server.mk
  server.bind (SocketAddress.v4 ⟨IPv4Addr.ofParts 127 0 0 1, port⟩)
  server.listen 64
  return { server, port := (← server.getSockName).port }

/-- Wait for the next connection. -/
def Listener.accept (l : Listener) : IO Conn := do
  let client ← l.server.accept.block
  return {
    recv? := (client.recv? 65536).block
    send := fun b => (client.send b).block
    close := (client.shutdown).block }

end Proofmap.Compat
