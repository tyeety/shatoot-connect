# Shatoot Connect

Windows remote desktop, nearby-computer discovery, private/group chat and file transfer. English is the default; Persian/RTL is available in the client and Server Manager. This repository contains the client, coordinator, Windows service manager, native input helper, tests and packaging sources.

[راهنمای فارسی](README.fa.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/tyeety/shatoot-connect/releases) · [Issues](https://github.com/tyeety/shatoot-connect/issues)

## Version 0.10.0

| Package | Purpose |
| --- | --- |
| `ShatootConnect-Setup-0.10.0-win-x64.exe` | Offline Windows installer |
| `ShatootConnect-0.10.0-win-x64.exe` | Portable client |
| `ShatootConnect-Server-0.10.0-win-x64.zip` | Coordinator, runtime and service manager |

Builds go to `release/`. Binaries belong in GitHub Release assets, not source control. Update both clients and the coordinator for chat by Internet ID. Serverless LAN chat requires only updated clients. Remote-desktop protocol 2 remains compatible with earlier protocol-2 coordinators; fixed/unattended access requires their fixed-password feature.

## Features

- Direct WebRTC desktop video: speed and balanced profiles target 1080p60, economy 720p30 and quality up to 4K60. These are targets, not guaranteed throughput or hardware encoding.
- Optional fixed password, explicit unattended access, encrypted saved-computer credentials and named desktop shortcuts.
- Independent guest input that leaves the physical host cursor alone by default; separate guest/host pointer indicators, a glass host-disconnect panel and video fullscreen.
- Automatically refreshed nearby devices across private IPv4 LAN/VPN interfaces.
- Standalone private/group conversations, searchable local history, queued text and approved file transfers, independent of desktop sharing.
- Compact connection form, tabbed settings, offline Vazirmatn fonts and Material SVG icons.

## Installation, upgrade and removal

Windows 10/11 or Windows Server 2016+ x64 is required. Run Setup, select English/Persian, current-user/all-user scope and a dedicated local **Shatoot Connect** folder. Current-user installation normally needs no administrator access; all-user installation requests elevation. Desktop/Start menu shortcuts and a Windows Installed apps entry are created.

Setup checks the OS/architecture, destination, write access, destination/TEMP disk space, accidental downgrades and running application processes. It rejects unrelated nonempty directories, network destinations and a junction at the final folder. Close the app before upgrading; Setup does not terminate active sessions. The payload uses forced installer CRC, checked ZIP extraction and SHA-256 verification of every packaged file before successful registration. Locked-file upgrade/removal errors stop the operation and attempt to restore the previous files.

Run the same installer to upgrade or repair. Settings, saved computers, encrypted credentials and history stay in the same Windows profile as the portable app. Opening the installed client refreshes app-created saved-computer shortcuts. Uninstall retains personal data and received files. DPAPI-protected data cannot simply be copied to another Windows account and decrypted. Hardware failures, power loss and antivirus intervention cannot be fully transactional; rerun Setup to repair a partial installation.

```powershell
ShatootConnect-Setup-0.10.0-win-x64.exe /S /currentuser
ShatootConnect-Setup-0.10.0-win-x64.exe /S /allusers
ShatootConnect-Setup-0.10.0-win-x64.exe /S /currentuser /D=C:\Apps\Shatoot Connect
```

For `/allusers`, use an elevated process. `/D=` must be the final argument, without quotes, following NSIS syntax. Silent installation does not launch the app. Custom exit codes: `0` success, `10` unsupported system, `11` unsafe folder, `12` write denied, `13` insufficient space, `14` payload integrity failure, `16` newer version installed, `17` registration failure, `1603` other installation/removal failure and `1618` application running. Diagnostics append to `%TEMP%\ShatootConnect-Setup.log` without passwords. Windows/NSIS can handle damaged-download, cancellation or elevation errors before custom checks. A trusted signing certificate is not included; unsigned builds can trigger SmartScreen.

The client installer does not install a privileged desktop agent or the coordinator service. Use the separate Server Manager package for that service.

## Nearby computers, VPNs and proxies

Open the app on each computer. **Nearby computers** lists reachable devices running Shatoot Connect, independently of Internet registration or screen sharing. Discovery refreshes every five seconds, expires stale peers after about twenty seconds, notices interface changes and deduplicates multiple addresses by device identity.

UDP 8789 sends multicast `239.255.87.89` and subnet broadcast separately on each active private IPv4 interface. This includes physical LAN, VPN, link-local and private `100.64.0.0/10` overlay addresses. A bounded Windows fallback probes `/presence` on TCP 8788 for existing IPv4 neighbor-cache entries every thirty seconds; it does not sweep a subnet. Presence announces the device identifier, computer name, listener port and app capabilities, never passwords or chat history.

LAN signaling uses main-process Node TCP sockets and the most-specific matching local interface, bypassing HTTP proxy configuration. Discovery does not discard physical adapters merely because a VPN changes the default route. Internet coordination retains its configured WSS/proxy behavior. WebRTC remains subject to OS routing, firewall and VPN restrictions.

**This is not an inventory of every powered-on computer.** Devices without the app, sleeping devices, isolated Wi-Fi clients, other VLANs, IPv6-only networks and blocked broadcasts may not appear. VPN kill switches or disabled LAN access can prevent local connectivity. The app does not disable a VPN, edit system routes, bypass security policy or silently open the firewall. Allow the application on trusted private networks and enable VPN LAN access only where your policy permits. Routed VPN peers may need a manually entered private IP because routers normally do not forward local discovery broadcasts.

## LAN desktop access without a coordinator

The app starts a local TCP 8788 listener and displays addresses/password in **Settings → LAN**. Enter the host's private IPv4 address, optionally with a custom port, in **Remote ID or LAN IP**; enter its LAN/fixed password. The nearby-device monitor button fills that address into the connection form. The host approves access unless explicitly configured unattended authentication applies.

No coordinator, Internet ID, STUN or TURN is used. **Settings → Internet server** can disable automatic Internet registration while fixed passwords, saved LAN connections, chat, files and clipboard remain usable. The client must remain running on a signed-in, unlocked Windows desktop. LAN signaling is plain WebSocket for a trusted LAN/VPN; video/input/collaboration content uses encrypted WebRTC transport. Do not expose the plain LAN listener directly on the public Internet.

## Desktop permissions and input

Set a fixed password of 8–128 characters in **Host and access**. Empty restores random passwords. Passwords are DPAPI-encrypted and never placed in desktop shortcut arguments. Fixed credentials apply to coordinator registration and the direct listener. **Allow unattended access with fixed password** is off by default; enabling it permits authenticated fixed-password view/control/file sessions without a further host dialog. Clearing the password disables it.

Saved computers keep name, ID/IP, server endpoint and encrypted password. One click reconnects. App-created shortcuts contain only a local record identifier. Keep a portable executable available until its shortcuts have migrated to the installed version.

Independent guest input uses window messages without moving the physical host pointer. Some raw-input apps/nonclient gestures require the optional **Allow guest to move my cursor** setting. The small always-on-top host panel provides disconnect and remains visible when minimized; guest clicks target the underlying app. A click-through overlay draws the guest pointer. Capture exclusion depends on Windows support; older Windows can include it in video.

Keyboard layouts synchronize in both directions with versioned conflict resolution and restoration when control ends. Focus the remote video to capture supported shortcuts; leaving it releases capture. `Ctrl+Shift+F12` disconnects locally. Interface language is independent of keyboard language. Elevated windows, UAC/secure desktops, `Ctrl+Alt+Delete`, pre-login/locked desktops, audio and arbitrary raw hardware input are not supported.

## Private chat and history

Open **Chats and files**, enter an Internet ID/private LAN IP or click a nearby device's chat button. The recipient accepts an independent invitation. Chat needs no desktop password and grants no screen, mouse, keyboard or clipboard access. ID chat requires both devices on the same updated coordinator; LAN chat needs no coordinator/STUN/TURN.

A separate reliable WebRTC data connection carries messages/files. The coordinator sees invitation and ICE/SDP signaling, not their contents. Direct traffic bypasses the coordinator; optional TURN relays encrypted transport and consumes relay bandwidth. Closing the messenger dialog keeps chat connected; **Disconnect chat** does not end a desktop session.

Contacts, groups, transcripts and queued text are atomically saved in a DPAPI-encrypted `%APPDATA%\shatoot-connect\chat-<device-id>.dat` file. Search and **Load older messages** operate locally. A delivery acknowledgement follows recipient persistence; it is not a human read receipt. Text to disconnected saved contacts queues until a new approved connection. There is no server-hosted offline mailbox. Limits are 50,000 messages / 32 MiB; full or unreadable history reports an error without silently overwriting the old transcript. Received file contents are ordinary Downloads files, not encrypted database blobs.

LAN announcements/plain signaling are not cryptographic human-identity certificates. Verify computer names and accept intended invitations. Internet registration verifies a persisted device secret against the coordinator, not a directory login or a person's identity. Names/text are rendered as text, never executable HTML.

## Groups

Connect at least two contacts, choose **New group**, enter a name and select participants. Each contact approves joining. The limit is sixteen participants including the creator. Accepted contacts can use LAN and/or ID routes.

The creator's client is the **owner and relay**. It forwards group messages to members and persists a queue for temporarily disconnected members. The owner must be online for group delivery. If it is offline, members retain outgoing text until reconnecting. A member's delivery acknowledgement confirms persistence by the owner, not delivery/read status for every member.

The owner is an intended group participant and can read/forward messages. This is not a sender-to-all cryptographic mesh, server-hosted group, owner-election system or high-availability service. History remains in each Windows profile; there is no cloud sync, account system or client service after logout.

## Files and clipboard

Use messenger **Send files** or drag local files onto a conversation. Every incoming batch requires separate recipient approval. Group-owner uploads fan out to members; member uploads go to the owner and then other online members, with separate approvals. All intended recipients must be connected for a new group upload. Offline file forwarding is not automatic; a received owner copy remains in history/Downloads for manual use later.

Messenger transfer neither reads nor changes the system clipboard. An attachment's folder button reveals the received file instead of executing it. Unique folders under `Downloads\Shatoot Connect\Chat` preserve names and never overwrite prior batches. Relative paths, file order, length and SHA-256 hashes are validated. Partial receives are cleaned on error/disconnect. Limits are 1,000 entries / 10 GiB per batch; symbolic links and unsafe Windows paths are rejected. Chunks use bounded acknowledgement/backpressure and low-priority data channels. Incomplete file deliveries remain visibly undelivered; file selections are not silently retried after restart.

Approved **desktop control** sessions have a separate clipboard channel for Unicode text and Explorer files/folders in both directions. A file drop on remote video transfers, clicks the target and pastes; it is not arbitrary OLE drop support. Clipboard failure after completed delivery does not discard received files. Rich text/image clipboard formats are not synchronized. Chat alone never grants this clipboard permission.

## Internet coordinator and Windows service

The coordinator exchanges IDs, invitations, approvals and connection information. It is not a streaming proxy, chat database or file server. Direct mode uses small signaling/heartbeat traffic. NAT, CGNAT or firewall restrictions can prevent direct paths; configure optional TURN or allow a clear connection failure. Application content is never silently routed through the signaling server.

A WSS subdomain can stay behind a CDN supporting WebSocket upgrades; typically HTTPS proxies to `127.0.0.1:8787` on the origin. Ordinary HTTP CDN proxying does not supply UDP STUN/TURN. STUN discovers mappings without relaying video. An own public STUN/TURN endpoint reveals that endpoint's IP; use a separate/managed relay if the origin's IP must stay separate. Avoid forced relay when relay bandwidth is unwanted.

Extract the complete server ZIP and run `ShatootConnect.Server.exe` as administrator. Configure endpoint, enrollment key, ICE and service settings. The manager installs the coordinator as LocalService with automatic startup/recovery; closing the manager or logging out does not stop that service. This is distinct from the signed-in desktop client. Export `shatootconnect.connection.json` to intended clients and place it beside the portable app for bootstrap. It contains a client enrollment key, never the management token. Do not commit real keys/configuration or device registries.

[English server guide](server/README.en.md) · [راهنمای سرور](server/README.fa.md)

| Purpose | Default | Notes |
| --- | --- | --- |
| Coordinator | TCP 8787 on origin, HTTPS 443 publicly | WebSocket upgrade and public TLS |
| Direct LAN listener / presence | TCP 8788 | Trusted LAN/VPN only |
| Nearby discovery | UDP 8789 | Multicast/subnet broadcast per interface |
| WebRTC peers | Dynamic UDP ports | OS/firewall/NAT dependent |
| Optional STUN/TURN | Administrator-defined | A reachable transport is required |

## Build and verification

Use Windows x64, Node.js 24, npm and .NET SDK 10. Dependencies/build outputs are ignored by Git.

```powershell
npm ci
npm run build:native
npm start
npm test
npm run test:smoke
npm run check:release
npm run dist
npm run test:installer
npm run dist:server
```

`test:smoke` requires an interactive, unlocked desktop. It uses isolated profiles/downloads and auto-approves prompts only in unpackaged development; native remote input injection stays disabled. It checks real WebRTC desktop video, standalone ID/LAN messaging, three-peer groups, offline queues, DPAPI persistence and bidirectional/group file contents. This does not prove acceptance on two physical PCs, a real VPN/Internet/CDN path or service logout/reboot.

`test:installer` requires `release/win-unpacked` and an account with no existing installation/app shortcuts. A guarded fixture tests invalid/occupied/unwritable destinations, running-app refusal, fresh install, downgrade refusal, locked upgrade/removal, repair, uninstall and personal-data preservation, then cleans up. CI runs protocol/store/network tests and builds native components. A service-based CI runner does not establish interactive desktop-capture acceptance.

Source: `desktop/main.cjs` owns trusted Windows/IPC operations; `desktop/ui/` is sandboxed UI/WebRTC; `discovery.cjs`, `chat-store.cjs` and `collaboration-host.cjs` implement local discovery, encrypted history and file grants. `server/` handles signaling, `shared/` protocol/network helpers, `native/` Windows input/keyboard/clipboard, `server-manager/` service management, and `build/`/`tests/` packaging and verification.

## Future versions and changelog

Add user-visible changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md), using Added/Changed/Fixed and compatibility/security notes where relevant. Before publication, move them under `## <version> — YYYY-MM-DD`, update both package files/build links and run relevant checks. `npm run check:release` rejects missing/duplicate/placeholder release notes and mismatched package versions.

Commit to `main`, then create/push matching `v<version>`. The tagged Windows workflow validates version/changelog, tests/builds installer/portable/server packages, checks the installer lifecycle and publishes a GitHub Release using exactly that version's changelog section. Corrections after publication get a new version; do not overwrite published history. Never commit credentials, live configuration, user data, received files, signing keys or binaries.

Bundled Vazirmatn/Material assets retain their licenses alongside the assets; the server bundle includes Node's runtime license. The owner has not yet specified a project-wide redistribution license.