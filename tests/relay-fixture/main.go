// Ephemeral LAN TURN fixture for acceptance tests. Not part of the server product.
package main

import (
  "encoding/json"
  "fmt"
  "net"
  "os"
  "os/signal"
  "github.com/pion/turn/v4"
)
type observedConn struct { net.PacketConn; count int }
func (c *observedConn) ReadFrom(b []byte) (int, net.Addr, error) {
  n, addr, err := c.PacketConn.ReadFrom(b)
  c.count++; if c.count < 12 { fmt.Fprintf(os.Stderr, "TURN datagram %d: bytes=%d error=%v\n", c.count, n, err) }
  return n, addr, err
}

func main() {
  relayIP := net.ParseIP("127.0.0.1")
  addresses, _ := net.InterfaceAddrs()
  for _, a := range addresses { if ip, ok := a.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() { candidate := ip.IP.To4(); if candidate[0] == 192 && candidate[1] == 168 { relayIP = candidate; break } } }
  if configured := os.Getenv("SHATOOTCONNECT_TEST_RELAY_IP"); configured != "" { relayIP = net.ParseIP(configured) }
  conn, err := net.ListenPacket("udp4", net.JoinHostPort(relayIP.String(), "0"))
  if err != nil { panic(err) }
  srv, err := turn.NewServer(turn.ServerConfig{
    Realm: "shatootconnect.test",
    AuthHandler: func(username, realm string, srcAddr net.Addr) ([]byte, bool) {
      if username != "local-test-user" { return nil, false }
      return turn.GenerateAuthKey(username, realm, "local-test-password"), true
    },
    PacketConnConfigs: []turn.PacketConnConfig{{
      PacketConn: &observedConn{PacketConn:conn},
      RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{ RelayAddress: relayIP, Address: "0.0.0.0" },
    }},
  })
  if err != nil { panic(err) }
  defer srv.Close()
  ready, _ := json.Marshal(map[string]interface{}{"port": conn.LocalAddr().(*net.UDPAddr).Port, "host": relayIP.String()})
  fmt.Println(string(ready))
  stop := make(chan os.Signal, 1); signal.Notify(stop, os.Interrupt); <-stop
}
