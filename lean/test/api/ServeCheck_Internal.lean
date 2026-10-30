/-
Socket API check for toolchains with the TCP API under `Std.Internal.IO.Async`
(v4.29.0): `serve` uses it.
-/
import Std.Internal.Async.TCP

#check @Std.Internal.IO.Async.TCP.Socket.Server.mk
#check @Std.Internal.IO.Async.TCP.Socket.Server.bind
#check @Std.Internal.IO.Async.TCP.Socket.Server.listen
#check @Std.Internal.IO.Async.TCP.Socket.Server.accept
#check @Std.Internal.IO.Async.TCP.Socket.Client.recv?
#check @Std.Net.SocketAddress.port
