/-
Socket API check for toolchains that ship `Std.Async.TCP` (v4.35.0): `serve` uses it.
-/
import Std.Async.TCP

#check @Std.Async.TCP.Socket.Server.mk
#check @Std.Async.TCP.Socket.Server.bind
#check @Std.Async.TCP.Socket.Server.listen
#check @Std.Async.TCP.Socket.Server.accept
#check @Std.Async.TCP.Socket.Client.recv?
#check @Std.Net.SocketAddress.port
