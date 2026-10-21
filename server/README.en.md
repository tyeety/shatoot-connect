# Shatoot Connect Server 0.11.1

For standalone chat/file invitations by Internet ID, deploy this complete 0.11.1 bundle and update both clients. The coordinator advertises collaboration-v1 and forwards only invitations and WebRTC signaling, never chat/file contents or history. Private LAN discovery/chat does not use this service. Groups are relayed by their creator's client, not by the coordinator. Earlier protocol-2 desktop clients remain supported. See the root README for permissions, VPN/discovery behavior and current group/history limits.

Update the server for client fixed-password support. Clients 0.6 can choose a fixed host password or retain rotating random passwords. Fixed secrets stay encrypted in the client profile and are supplied on authenticated registration; the broker keeps only an in-memory hash. Host approval is required unless the host explicitly enables unattended access with its fixed password. Upgrade the broker and both clients to 0.6; older brokers do not mark verified fixed-password requests, so approval remains required. The host client must stay running in an unlocked, signed-in Windows desktop. Update both clients to 0.7 for bidirectional keyboard-layout synchronization, the separate Settings dialog and the independent host cursor indicator. Existing 0.6 brokers remain protocol compatible.

Extract the complete ZIP and run `ShatootConnect.Server.exe`. English is default; Persian is selectable. Elevate using **Run as administrator**, configure, then **Install service**. The LocalService Windows service starts automatically and recovers after failure. Closing the manager or logging out does not stop it. **Save & restart** applies configuration changes.

## Default: direct P2P

1. Publish `connect.shatootsoft.com` through HTTPS/CDN with WebSocket support. Route it to `127.0.0.1:8787` using your reverse proxy or tunnel. Do not publicly expose the broker port.
2. Leave **Cloudflare Realtime TURN** and **Force relay** unchecked. The default ICE URL is the public STUN endpoint `stun:stun.cloudflare.com:3478`, which needs no TURN key. STUN only discovers public network mappings; it does not carry video. Replace it with your own reachable STUN service if desired; its UDP endpoint must be reachable outside the ordinary HTTP CDN proxy.
3. Install/start the service and export the client connection file. Place `shatootconnect.connection.json` beside the client EXE on intended computers. It contains the client enrollment key, not any TURN management token.
4. The client gets its ID automatically and exchanges setup information through WSS. Video/input use direct WebRTC when possible. Only coordination and heartbeats use broker bandwidth. Confirm the live route says **Direct connection**.

Some NAT/CGNAT/firewall combinations prevent direct connections. Optional TURN permits relaying at the cost of relay bandwidth. Static credentials, a TURN REST shared secret, or Cloudflare Realtime TURN credentials are supported. Managed TURN is optional and must be enabled explicitly. Force relay is for deliberate relay usage/testing. Never advertise TURN on the main origin IP if that IP must remain hidden.

## LAN

No Windows server service is needed. Each client starts its own direct listener on TCP 8788, displays local addresses and a LAN password, and accepts connections after native host approval or explicitly enabled unattended fixed-password authentication. Enter the host's private IPv4 address and LAN password in the client. Allow the app on trusted private networks in Windows Firewall (TCP 8788 plus WebRTC UDP). LAN setup uses plain WebSocket; media and input are encrypted through WebRTC. Public insecure IP signaling is rejected.

## Operations

Configuration, device IDs and bounded logs live in `%ProgramData%\ShatootConnect\Server` with restricted access for Administrators, SYSTEM and LocalService. Keep protected backups of configuration and `devices.json`. The manager does not change IIS, DNS or firewall rules. `/health` exposes minimal status only. The public health check validates HTTPS reachability/certificate; verify actual WSS registration in a client too.

Direct TLS supports PEM certificates/keys; issuance and renewal belong to your TLS terminator. `START-SERVER.cmd` is a foreground diagnostic runner, not the Windows service. Validate actual video/control on two physical machines and different internet networks, and verify target service logoff/reboot behavior before production acceptance.

Client 0.8 adds a five-tab Settings dialog, Internet-independent LAN passwords and LAN-only mode, host-visible independent guest pointers, and file delivery/progress improvements. Update both clients; existing 0.6+ brokers remain compatible.
