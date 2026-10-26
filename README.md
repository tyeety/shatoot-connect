# Shatoot Connect

Windows remote desktop, nearby-computer discovery, private/group chat and file transfer. English is the default; Persian/RTL is available in the client and Server Manager. Client Settings uses a vertical tab sidebar (left in English, right in Persian) with independently scrolling content and Up/Down, Home/End keyboard navigation. In the client, **Settings > Display and language > Theme** switches between Dark (default) and Light; the saved choice applies immediately to main/chat windows, notifications and connection panels. This repository contains the client, coordinator, Windows service manager, native input helper, tests and packaging sources.

[راهنمای فارسی](README.fa.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/tyeety/shatoot-connect/releases) · [Issues](https://github.com/tyeety/shatoot-connect/issues)

The chat window uses a blue speech-bubble icon and a role-first **Chats · Shatoot Connect** title, distinct from the main purple application icon. Both update buttons keep a dedicated download percentage visible in English and Persian, even when the status text is clipped in a narrow header.

## Version 0.19.0

The main sidebar combines saved and recent computers into one list, sorted by the last successful connection. Saved systems have a muted outline star; unsaved recent systems have a clock. A saved system does not also appear as a recent row. Rename is an icon action; saving, credentials and existing shortcuts retain their identities.

| Package | Purpose |
| --- | --- |
| `ShatootConnect-Setup-0.19.0-win-x64.exe` | Offline Windows installer |
| `ShatootConnect-0.19.0-win-x64.exe` | Portable client |
| `ShatootConnect-Server-0.19.0-win-x64.zip` | Coordinator, runtime and service manager |

Builds go to `release/`. Binaries belong in GitHub Release assets, not source control. Update both clients and the coordinator for chat by Internet ID. Serverless LAN chat requires only updated clients. An exact application version match is not required: remote-desktop protocol 2 remains compatible with earlier protocol-2 coordinators; fixed/unattended access requires their fixed-password feature.

## Features

- Direct WebRTC desktop video: speed and balanced profiles target 1080p60, economy 720p30 and quality up to 4K60. These are targets, not guaranteed throughput or hardware encoding.
- Optional fixed password, explicit unattended access, encrypted saved-computer credentials and named desktop shortcuts.
- Independent guest input that leaves the physical host cursor alone by default; separate guest/host pointer indicators, a glass host-disconnect panel and video fullscreen.
- Automatically refreshed nearby devices across private IPv4 LAN/VPN interfaces.
- Standalone private/group conversations, searchable local history, queued text and approved file transfers, independent of desktop sharing.
- Compact connection form, tabbed settings, offline Vazirmatn fonts and Material SVG icons.

## Installation, upgrade and removal

Windows 10/11 or Windows Server 2016+ x64 is required. Run Setup, select English/Persian, current-user/all-user scope and a dedicated local **Shatoot Connect** folder. Current-user installation normally needs no administrator access; all-user installation requests elevation. Desktop/Start menu shortcuts and a Windows Installed apps entry are created.

Setup checks the OS/architecture, destination, write access, destination/TEMP disk space, accidental downgrades and running application processes. It rejects unrelated nonempty directories, network destinations and a junction at the final folder. Setup closes verified background instances in the same Windows account/session when no product window is visible. Visible app/chat windows must be closed first. Current versions exit gracefully; older background versions without that command are closed after a second visibility check. This can end background connections/transfers. Unknown same-name programs and other users/sessions are preserved. The payload uses forced installer CRC, checked 7z extraction and SHA-256 verification of every packaged file before successful registration. Locked-file upgrade/removal errors stop the operation and attempt to restore the previous files.

If version 0.19.3 or earlier reports **Update installer could not start (0)**, download the latest Setup from [Releases](https://github.com/tyeety/shatoot-connect/releases/latest) and install it manually once over the existing installation. Do not uninstall first. The old running launcher cannot be replaced by merely downloading a newer installer; 0.19.4 and later contain the corrected launcher.

Run the same installer to upgrade or repair. Settings, saved computers, encrypted credentials and history stay in the same Windows profile as the portable app. Opening the installed client refreshes app-created saved-computer shortcuts. Uninstall retains personal data and received files. DPAPI-protected data cannot simply be copied to another Windows account and decrypted. Hardware failures, power loss and antivirus intervention cannot be fully transactional; rerun Setup to repair a partial installation.

```powershell
ShatootConnect-Setup-0.19.0-win-x64.exe /S /currentuser
ShatootConnect-Setup-0.19.0-win-x64.exe /S /allusers
ShatootConnect-Setup-0.19.0-win-x64.exe /S /currentuser /D=C:\Apps\Shatoot Connect
```

For `/allusers`, use an elevated process. `/D=` must be the final argument, without quotes, following NSIS syntax. Silent installation does not launch the app. Custom exit codes: `0` success, `10` unsupported system, `11` unsafe folder, `12` write denied, `13` insufficient space, `14` payload integrity failure, `16` newer version installed, `17` registration failure, `1603` other installation/removal failure and `1618` application running. Diagnostics append to `%TEMP%\ShatootConnect-Setup.log` without passwords. Windows/NSIS can handle damaged-download, cancellation or elevation errors before custom checks. A trusted signing certificate is not included; unsigned builds can trigger SmartScreen.

The client installer does not install a privileged desktop agent or the coordinator service. Use the separate Server Manager package for that service.

## Nearby computers, VPNs and proxies

Open the app on each computer. **Nearby computers** lists reachable devices running Shatoot Connect, independently of Internet registration or screen sharing. Discovery refreshes every five seconds, expires stale peers after about twenty seconds, notices interface changes and deduplicates multiple addresses by device identity.

UDP 8789 sends multicast `239.255.87.89` and subnet broadcast separately on each active private IPv4 interface. This includes physical LAN, VPN, link-local and private `100.64.0.0/10` overlay addresses. A bounded Windows fallback probes `/presence` on TCP 8788 for existing IPv4 neighbor-cache entries every thirty seconds; a bounded TCP fallback also checks /presence on port 8788 across /24 blocks inferred from saved LAN computers and directly attached /24 interfaces. It checks at most four blocks per pass with sixteen concurrent requests, rotating blocks every minute; discovered peers are rechecked every ten seconds. Custom ports are retained for known endpoints. Presence announces the device identifier, computer name, listener port and app capabilities, never passwords or chat history.

LAN signaling uses main-process Node TCP sockets and the most-specific matching local interface, bypassing HTTP proxy configuration. Discovery does not discard physical adapters merely because a VPN changes the default route. Internet coordination retains its configured WSS/proxy behavior. WebRTC remains subject to OS routing, firewall and VPN restrictions.

**This is not an inventory of every powered-on computer.** Devices without the app, sleeping devices, isolated Wi-Fi clients, other VLANs, IPv6-only networks and blocked broadcasts may not appear. VPN kill switches or disabled LAN access can prevent local connectivity. The app does not disable a VPN, edit system routes, bypass security policy or silently open the firewall. Allow the application on trusted private networks and enable VPN LAN access only where your policy permits. Routed VPN discovery uses saved private IPs as network seeds because routers normally do not forward local discovery broadcasts. On a new installation, save one company IP first; other reachable devices in that /24 block then appear automatically. Other company subnets require their own seed.

## LAN desktop access without a coordinator

The app starts a local TCP 8788 listener and displays addresses/password in **Settings → LAN**. Enter the host's private IPv4 address, optionally with a custom port, in **Remote ID or LAN IP**; enter its LAN/fixed password. The nearby-device monitor button fills that address into the connection form. The host approves access unless explicitly configured unattended authentication applies.

No coordinator, Internet ID, STUN or TURN is used. **Settings → Internet server** can disable automatic Internet registration while fixed passwords, saved LAN connections, chat, files and clipboard remain usable. The client must remain running on a signed-in, unlocked Windows desktop. LAN signaling is plain WebSocket for a trusted LAN/VPN; video/input/collaboration content uses encrypted WebRTC transport. Do not expose the plain LAN listener directly on the public Internet.

## Desktop permissions and input

Set a fixed password of 8–128 characters in **Host and access**. Empty restores random passwords. Passwords are DPAPI-encrypted and never placed in desktop shortcut arguments. Fixed credentials apply to coordinator registration and the direct listener. **Allow unattended access with fixed password** is off by default; enabling it permits authenticated fixed-password view/control/file sessions without a further host dialog. Clearing the password disables it.

Save computer on the connection form needs only an ID/IP; a nickname is optional. Recent connections records up to 200 approved connection attempts with time and reuse count. Reconnect or save directly from each history row; choose a nickname in the save dialog or use the visible Rename action. Enter submits the dialog; renaming preserves credentials and shortcut identity. The obsolete Saved computers settings tab has been removed. Saved computers keep name, ID/IP, server endpoint and an optional encrypted password. One click reconnects if credentials are available, otherwise the password input receives focus. App-created shortcuts contain only a local record identifier. Desktop shortcuts use a stable launcher in the Windows profile and follow the latest opened version, including a changed executable path. Known older shortcuts migrate when the app opens. Open a moved executable once to register its new location.

**Use shared mouse (recommended)** is enabled by default, including a one-time migration for existing installations. Remote movement, clicks, wheel input and drags use standard Windows SendInput on the real host cursor. Pointer moves share the ordered channel with button down/up. All authorized viewers on one app instance share one native input worker: only one controls at a time. A controller keeps its turn while any button/key is held; after release and two seconds without input, another viewer may take control. Physical host mouse/keyboard activity releases remote input immediately and pauses every guest until all physical keys/buttons are up and the host has been quiet for two seconds. The viewer shows the pause/busy state. Disconnect, focus loss and channel interruption release held inputs. Turning the option off retains the limited independent pointer mode; drag, raw-input apps and custom controls are not guaranteed in that mode. Update both clients for ordered input and status feedback. The small always-on-top host panel provides disconnect and remains visible when minimized; guest clicks target the underlying app. A click-through overlay draws the guest pointer. Capture exclusion depends on Windows support; older Windows can include it in video.

Keyboard layouts synchronize in both directions with versioned conflict resolution and restoration when control ends. Focus the remote video to capture supported shortcuts; leaving it releases capture. `Ctrl+Shift+F12` disconnects locally. Interface language is independent of keyboard language. Elevated windows, UAC/secure desktops, `Ctrl+Alt+Delete`, pre-login/locked desktops, audio and arbitrary raw hardware input are not supported.

Closing the remote-view window disconnects the desktop session before hiding the app to the tray. The first remote view fits the native host image to the guest work area; later views reuse the last size within those limits, restoring the original main-window geometry on disconnect. Outgoing desktop connections show **Cancel connection** throughout validation, approval and video negotiation. The Internet settings and chat connection form have their own cancel controls. Cancelling a pending chat leaves established chats intact.

Local nicknames are shared between saved/recent/nearby computer cards and chat lists, titles, message history and group-member labels. The name button in a private chat changes your local nickname; it does not change the remote profile published to other people. The self-profile chip opens your own display-name/photo settings. Chat lists always show a profile picture or default icon.

Computer card backgrounds use the Windows desktop wallpaper file, never a screenshot of open windows. Nearby LAN devices advertise a bounded 320×180 wallpaper thumbnail through their local profile, without a chat, screen-sharing session or desktop password. Saved LAN endpoints are probed automatically as well. Known chat peers exchange wallpaper over WebRTC, including saved Internet-ID computers on the current server. The encrypted cache follows known device identities and remains visible offline, beneath a dark purple readability overlay. Legacy screenshot caches are not displayed. Both peers need version 0.19.1 or later to provide wallpaper; unreachable devices with no wallpaper cached yet have a plain background. Windows solid-color backgrounds use their desktop color.

Native popup-menu actions use Windows UI Automation Invoke/ExpandCollapse patterns, with an MSAA fallback for classic menu items. This handles modern menu providers without moving the host's physical cursor or dismissing the popup by foregrounding it. The input helper runs on the host, so update that computer too. Applications that do not expose compatible input/accessibility providers can still require the explicitly enabled shared-cursor option.

The app keeps local crash minidumps in `%APPDATA%\shatoot-connect\crashes` with uploads disabled, and bounded lifecycle/process records in `logs\process.log`. Lifecycle records distinguish a hidden/closed window from a renderer/GPU crash or normal application exit; they omit participant names and chat/clipboard contents. Minidumps contain process-memory diagnostics and are not sent automatically. A previously reported first-frame viewer exit remains unconfirmed until captured; successful local video tests do not establish that its original cause is fixed.

## Private chat and history

Open **Chats and files**, enter an Internet ID/private LAN IP or click a nearby device's chat button. Known chats reconnect automatically on startup and periodically, preferring a discovered LAN route and falling back to the saved LAN/Internet route. Selecting a contact or sending text/files also connects without a separate Connect click. Offline text remains queued. Outgoing messages show a clock while awaiting delivery, one tick after delivery, two ticks after reading, or an error icon after a failed send attempt. Read receipts require both clients to support them and a focused chat with the message displayed. Group ticks require all intended recipients; receipts persist while offline and synchronize after reconnection. Ordinary messages connect without a recipient approval prompt by default. Settings > Chat and files can restore explicit chat approval. Chat needs no desktop password. Updated clients exchange their Windows wallpaper thumbnail on chat connection and when it changes; the last image is encrypted locally and remains on offline cards. Wallpaper sharing grants no screen capture, mouse, keyboard or clipboard permission. Older clients retain normal chat/file compatibility. ID chat requires both devices on the same updated coordinator; LAN chat needs no coordinator/STUN/TURN.

A separate reliable WebRTC data connection carries messages/files. The coordinator sees invitation and ICE/SDP signaling, not their contents. Direct traffic bypasses the coordinator; optional TURN relays encrypted transport and consumes relay bandwidth. The messenger runs in a separate window. Closing either main/chat UI keeps the background engine and connected sessions alive in the tray; use the tray to restore the main UI. Quit completely in Settings > Application or the tray exits the process and ends sessions; Known chats reconnect automatically; there is no separate Connect/Disconnect chat action.

Use the bell beside the chat title to mute or unmute that conversation. Muting persists locally and suppresses new text/voice/file-completion popups; receiving messages/files, unread counts, history and explicit file/connection approval requests remain active. A crossed bell marks muted conversations in the list.

Use the pin icon on any conversation to keep it above unpinned chats. Active pins tilt. The combined saved/recent computer list has its own Pin/Unpin buttons: pinned connections stay at the top, with the most recently used first within each section. Connection pins persist locally and are independent of chat pins. Drag pinned rows/cards to change their order, or focus a control in a pinned item and use Alt+Up/Down. A drop line shows the destination. Manual order survives restarts, new messages and reconnects; unpinned items keep their recent-first ordering. The last selected chat is restored; a first-time chat window selects the first available contact. Presence is a colored dot. Local unread counts appear beside contacts, on Chats and files and on the Windows taskbar; opening and focusing the matching conversation at the latest messages clears its count. When reading older history, new arrivals remain unread until viewed. In Settings > Chat and files, Show the chat window in remote sessions controls whether the host chat is visible to viewers. It is off by default, persists, and takes effect for open and newly opened chat windows immediately. When off, Windows 10 2004+ excludes the chat from capture; older Windows may show a black region.

Contacts, groups, transcripts and queued text are atomically saved in a DPAPI-encrypted `%APPDATA%\shatoot-connect\chat-<device-id>.dat` file. Search and **Load older messages** operate locally. A delivery acknowledgement follows recipient persistence; it is not a human read receipt. Text to disconnected saved contacts queues until a new approved connection. There is no server-hosted offline mailbox. Limits are 50,000 messages / 32 MiB; full or unreadable history reports an error without silently overwriting the old transcript. Received file contents are ordinary Downloads files, not encrypted database blobs.

Messages are grouped by local calendar day, with a small centered sticky date and time-only footers. Displaced dates fade after scrolling stops and reappear while scrolling. History refreshes and loading older messages preserve the reading position; the floating down arrow shows a new-message count and jumps to the first unread arrival, or to the latest message when no new arrivals are pending.

Images have inline thumbnails; other attachments show a file card with name, format and size. Click a preview to open that attachment. Previews are generated locally and cached; missing or unsupported files retain their filename.

Attachments offer separate **Open** and **Open containing folder** actions; the latter selects the local file in Explorer. Each message has **Copy**. Message body text also supports partial selection and normal plain-text Copy; other app labels remain non-selectable. For attachments, Copy places the original local files on the Windows clipboard for Paste in Explorer; it does not copy their names as text. Missing or moved sources report an error. Your own text messages also have **Edit message**; **Delete message** is available for your own text, file and voice messages. Changes persist and queue for offline recipients, including group-owner relay. With version 0.19.4 on both clients, deleted messages disappear without a placeholder; internal deletion records prevent replay. Files remain on disk. All participants, including a group owner, need 0.18.1 or newer to synchronize edits/deletions; older clients continue ordinary messaging, and queued changes wait for an upgraded peer.

LAN announcements/plain signaling are not cryptographic human-identity certificates. Verify computer names and accept intended invitations. Internet registration verifies a persisted device secret against the coordinator, not a directory login or a person's identity. Names/text are rendered as text, never executable HTML.

Copied remote-session files use the native Windows virtual-file clipboard in 0.20.0: Copy exchanges metadata only; Explorer Paste requests file bytes and writes into the selected folder. The app uses a private temporary rendering cache, cleaned on normal exit, rather than automatically placing clipboard files in Downloads. Both clients need 0.20.0 for this path. Explicit chat/file-send actions continue to use Downloads. Ordinary host copies remain available for local Paste; a newer local clipboard change takes precedence over an incoming synchronization race.

## Groups

Choose **New group** and enter a name. You may create it with no other members, then use **Edit group** later. Only the owner can edit the name, description, photo, shared contact-card background (with a dark purple overlay; the message timeline keeps the theme background) and member list; connected members receive metadata changes immediately and offline members receive them after reconnecting. The chooser includes saved chat contacts and discovered LAN peers, including offline contacts. There is no minimum or fixed group-member count. Invitations are offered when a selected contact connects; the recipient still approves joining. Stored membership does not imply acceptance. Actual concurrent transports remain bounded (16 chat connections per client/coordinator socket); very large groups are not a guarantee of unlimited simultaneous connectivity. LAN and ID routes can be mixed.

The creator's client is the **owner and relay**. It forwards group messages to members and persists a queue for temporarily disconnected members. The owner must be online for group delivery. If it is offline, members retain outgoing text until reconnecting. A member's delivery acknowledgement confirms persistence by the owner, not delivery/read status for every member.

The owner is an intended group participant and can read/forward messages. This is not a sender-to-all cryptographic mesh, server-hosted group, owner-election system or high-availability service. History remains in each Windows profile; there is no cloud sync, account system or client service after logout.

## Voice messages

In a private or group chat, press **Record voice**, then **Send voice**, or **Cancel recording** to discard. The timer is visible while the microphone is active. Recordings stop at five minutes and are limited to 10 MB. Switching conversations or closing the chat cancels an active recording and stops its microphone tracks. An unavailable/blocked microphone reports an error; allow microphone access in Windows Settings if necessary.

Press **Play voice** on a voice bubble to load and play it inside the chat. Standard audio controls provide pause, seeking and volume. Only one voice player plays at a time; there is no automatic playback on receipt. History refreshes preserve loaded players. Voice files use Opus/WebM and the existing encrypted file-transfer path, including hashes, Downloads, per-chat/global file reception rules, notification focus rules and group-owner relay. Recipients must be online/reachable under the normal file-transfer rules. Older compatible clients receive a regular WebM attachment; this version adds inline recording/playback without changing the coordinator protocol.

Microphone permission is separate from desktop view/control and grants no camera permission. Original recordings are retained in the local profile's sent-voice cache so sent history can still open/play them; encrypted history stores attachment references. Received recordings remain with received files in Downloads. Playback reads only the explicitly selected, bounded voice attachment from local history.

## Files and clipboard

Use messenger **Send files** or drag local files onto a conversation. Files are received automatically by default. Settings > Chat and files > **Ask before receiving files** enables approval globally, including desktop-session files. Each private or group chat has its own **Incoming files** selector: use the global setting, always receive automatically, or always ask. Overrides persist across reconnects/restarts and do not change another chat's policy. Explicit existing global preferences are preserved. Files never open automatically; path/size/hash checks still apply. Group-owner uploads fan out to members; member uploads go to the owner and then other online members, following each recipient's file-acceptance setting. All intended recipients must be connected for a new group upload. Offline file forwarding is not automatic; a received owner copy remains in history/Downloads for manual use later.

Paste a clipboard image into the message field to send it through the existing file-transfer protocol as a PNG (up to 10 MB); normal text paste is unchanged. The local sent-image cache is retained for chat history. Clicking an attachment opens the received file or the original sent file; multiple selections open their containing directory. A source that has been moved/deleted reports an error. Original source paths and attachment tokens are never sent to peers. Incoming text/file notices appear in the shared bottom-right queue only when their conversation is not actively focused. Keeping the app in the tray retains chat delivery; Quit completely stops it. New transfers use unique `Receive-*` folders directly under the Windows **Downloads** folder, preserving names without overwriting earlier batches. Existing attachment locations remain valid. Relative paths, file order, length and SHA-256 hashes are validated. Partial receives are cleaned on error/disconnect. Limits are 1,000 entries / 10 GiB per batch; symbolic links and unsafe Windows paths are rejected. Chunks use bounded acknowledgement/backpressure and low-priority data channels. Incomplete file deliveries remain visibly undelivered; file selections are not silently retried after restart.

Approved **desktop control** sessions have a separate clipboard channel for Unicode text and Explorer files/folders in both directions. A file drop on remote video transfers, clicks the target and pastes; it is not arbitrary OLE drop support. Clipboard failure after completed delivery does not discard received files. Rich text/image clipboard formats are not synchronized. Chat alone never grants this clipboard permission.

## Updates, profile and availability

Update installation rechecks the recent published GitHub releases before and after downloading and chooses the highest stable version, even if GitHub's latest marker or a previous check points at an older release. An incomplete newer release reports an error. The current process stays open until the verified update worker acknowledges readiness. The worker installs, visibly relaunches the app and verifies its version/startup acknowledgement; failures remain in `%APPDATA%\shatoot-connect\updates\last-update.json` and are shown on the next launch. The installed update/restart path is tested on a clean Windows runner; personal settings and history remain in the same Windows profile.

The packaged client checks the latest stable GitHub Release at startup and every six hours. Settings > Updates also provides a manual check. **Update and restart** downloads the matching installed/portable Windows x64 package, checks its exact length and GitHub asset SHA-256 digest, then runs the update worker after the old process exits. A failed/corrupt download leaves the running app untouched. Installed editions use the existing installer/installation folder; portable editions replace the original executable and keep a `.previous` backup until the new client confirms successful startup. Successful startup removes that backup, the downloaded package and obsolete updater-cache packages. Portable startup failure restores the working executable. Startup also cleans recognized backups left by older updaters; manually downloaded copies outside the updater cache are preserved. Updating never deletes the Windows user profile, encrypted passwords, favorites or chat database. Keep the same Windows account so DPAPI data remains readable. Updating restarts the client and ends active sessions/transfers. Source/dev launches cannot install updates. Version 0.10.0 needs one manual upgrade to acquire the updater. Server service upgrades still use the separate server package.

Profile and status settings support a display name, cropped local PNG/JPEG/AVIF/WebP/GIF photo (up to 10 MB; animated GIFs use their first frame), and Available, Busy, Away, Do not disturb or Appear offline. These are per-device identities, not centralized user accounts. Photos are stored as bounded PNG thumbnails; LAN neighbors retrieve the public profile locally and connected chat peers receive updates over WebRTC. The selected status is advisory; it does not disable hosting or disconnect peers. Display names/photos do not prove identity. Do not disturb does not revoke incoming-message permission.

The header firewall shortcut is hidden during startup and when access is already allowed. A read-only Windows firewall policy check reveals it only for blocked/missing inbound permissions for this executable on an active enabled profile; unknown status stays hidden. Status is rechecked after repair, on focus and periodically. Empty discovery lists and unavailable Internet servers do not by themselves reveal the shortcut. Settings > LAN keeps manual repair available. **Repair Windows Firewall access** requests Windows administrator permission and can be retried after cancellation or a missing initial firewall prompt. It repairs this executable's local inbound block rules and creates LAN/discovery/WebRTC allowances restricted to local subnets on Private/Domain profiles; it does not disable the firewall, bypass organization policies, change VPN routes or allow public Internet inbound access. On a Public-profile LAN, mark the trusted network Private or ask its administrator. Source/dev runs target their Electron executable; packaged runs target the installed/portable executable.

Up to eight viewers can connect to one updated host, using LAN, ID, or both. Each needs the password and independent host approval (or configured unattended access), its own WebRTC connection and a separate disconnect panel. One guest disconnecting does not revoke the others. The viewers share one Windows desktop, cursor and keyboard layout; the host serializes control to one active viewer, with physical host input taking priority. Every connection adds capture/encoding/network load. Old servers/clients keep their single-viewer behavior; upgrade the coordinator and host for ID multi-viewer use.

LAN IP connections automatically select **LAN · Ultra**, preserving available display resolution up to 8K at 60 fps with a 100 Mbit/s ceiling and resolution-prioritized adaptation. This is a cap, not a guaranteed frame rate or lossless format. The real display, GPU/encoder and network determine delivered quality. Change Live quality to reduce load. Internet ID connections keep their saved quality preference.

## Desktop experience and remembered credentials

Settings > Application controls **Remember the last password for each computer** (on by default). The last entered password is stored with Windows encryption, keyed by LAN IP/port or by Internet ID plus coordinator address. Default LAN port 8788 and an omitted port refer to the same cache entry. Typing an address fills its own password; stale asynchronous lookups cannot overwrite a different address or a user-entered password. Turning the setting off deletes the automatic cache and disables autofill. Explicitly saved computers retain their own credentials. Clearing connection history removes recent rows without deleting saved computers or chat history. History stores connection metadata, not plaintext passwords.

The app adopts Shatoot's purple palette (#7400a8 / #9f38d7) on dark surfaces with larger type and a redesigned multi-resolution Windows icon. All buttons provide press feedback; refreshed lists animate and settings/update actions report through a local snackbar. Static UI text/images do not select or drag; text inputs remain editable/selectable and external file drops still work. Enter activates the matching connection/server/password/profile action; chat/group forms retain normal Enter submission.

Closing the main window hides it to the tray even without an open chat. **Quit completely** is available in Settings > Application and the tray. Packaged clients enable startup with Windows by default and open in the tray using the installed/portable executable; the Application tab can turn startup off. Source/smoke runs never modify real Windows startup. A signed-in desktop session is still required; this is not pre-login or post-logout desktop service support.

All application notifications share a themed bottom-right stack and queue. Up to three are visible within the screen work area; visible host panels reserve space. Critical approvals take priority without losing queued informational notices. File completion appears directly in the selected chat when that chat tool has keyboard focus (including the separate chat window with main UI hidden); otherwise it produces a desktop notice. Passive notices have **Hide**, remain while the system is idle, and fade after about 6.5 seconds of activity; hovering pauses dismissal. Required-action prompts retain a bounded, safe-decline expiry. Native file/folder pickers, Windows elevation and installer dialogs remain OS dialogs. A host can hide its connection panel without disconnecting guests, then restore panels from Settings or the tray. Emergency disconnect remains available.

Windowed viewing fits the received display aspect ratio and measured controls/chrome, caps size to the current work area, and preserves the ratio during manual resize. Ending viewing restores normal main-window dimensions. Fullscreen continues to apply to the video panel.

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
npm run test:chat-ui
npm run check:release
npm run dist
npm run test:packaged
npm run test:installer
npm run test:updater
npm run dist:server
```

`test:smoke` requires an interactive, unlocked desktop. It uses isolated profiles/downloads and auto-approves prompts only in unpackaged development; native remote input injection stays disabled. It checks real WebRTC desktop video, standalone ID/LAN messaging, three-peer groups, offline queues, DPAPI persistence and bidirectional/group file contents. This does not prove acceptance on two physical PCs, a real VPN/Internet/CDN path or service logout/reboot.

`test:crash-recorder` crashes only a blank fixture renderer under the isolated smoke profile and verifies local dump capture with uploads disabled. `npm run test:smoke -- --quality-smoke` also exercises the VP9 quality path.

`test:chat-ui` is a focused Electron/real LAN WebRTC test with isolated profiles/Downloads. It verifies global/per-chat controls, actual received bytes, focused-chat notification suppression, background/different-chat notices, Hide and fade, plus both language layouts. It requires an interactive Windows desktop but does not capture its screen or inject remote input. Notification unit tests use a controlled activity/clock source to verify idle retention, hover pauses, priority, queuing, display changes and non-overlap.

`test:installer` requires `release/win-unpacked` and an account with no existing installation/app shortcuts. A guarded fixture tests invalid/occupied/unwritable destinations, running-app refusal, fresh install, downgrade refusal, locked upgrade/removal, repair, uninstall and personal-data preservation, then cleans up. CI runs protocol/store/network tests and builds native components. A service-based CI runner does not establish interactive desktop-capture acceptance.

`test:updater` exercises portable replacement, readiness-confirmed cleanup, startup-failure rollback, legacy backup cleanup, profile preservation and an unchanged Windows shortcut opening a newer executable in an isolated fixture. `npm run test:connection-ui` exercises actual stalled desktop/coordinator/chat transports, cancellation/retry and computer naming without capturing the desktop. For an optional real GitHub metadata/download/hash check without installation, run `node_modules/.bin/electron.cmd tests/update-network.cjs --download`. Windows update checks use Electron networking so system proxy settings apply.

`test:packaged` executes the final portable launcher in Electron's Node mode and verifies its extracted payload hash, without opening the personal profile. Release CI also passes `--ui` on a clean Windows runner to open the packaged renderer with an isolated profile and check both language layouts and SVG loading. Keep `nsis.useZip` disabled: installer and portable builds share an archive cache, while the default portable extractor expects 7z.

Source: `desktop/main.cjs` owns trusted Windows/IPC operations; `desktop/ui/` is sandboxed UI/WebRTC; `discovery.cjs`, `chat-store.cjs` and `collaboration-host.cjs` implement local discovery, encrypted history and file grants. `server/` handles signaling, `shared/` protocol/network helpers, `native/` Windows input/keyboard/clipboard, `server-manager/` service management, and `build/`/`tests/` packaging and verification.

## Future versions and changelog

Add user-visible changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md), using Added/Changed/Fixed and compatibility/security notes where relevant. Before publication, move them under `## <version> — YYYY-MM-DD`, update both package files/build links and run relevant checks. `npm run check:release` rejects missing/duplicate/placeholder release notes and mismatched package versions.

Commit to `main`, then create/push matching `v<version>`. The tagged Windows workflow validates version/changelog, tests/builds installer/portable/server packages, checks the installer lifecycle and publishes a GitHub Release using exactly that version's changelog section. Corrections after publication get a new version; do not overwrite published history. Never commit credentials, live configuration, user data, received files, signing keys or binaries.

Bundled Vazirmatn/Material assets retain their licenses alongside the assets; the server bundle includes Node's runtime license. The owner has not yet specified a project-wide redistribution license.

Process failures are recorded locally in the application profile's logs/process.log (rotated at 256 KiB, retaining one previous file). Only process/exception categories and stack frames are recorded; chat, clipboard and profile payloads are excluded. These logs do not upload automatically.

Action snackbars can be dismissed immediately with OK (تأیید), and still expire automatically. Selecting a chat conversation uses visual click feedback without a Done message.

Update workers start through a hidden Windows process handoff and confirm readiness before the app exits. Per-attempt worker/diagnostic files prevent concurrent clients from replacing an active script; old diagnostic attempts are pruned. Clients affected by the older PowerShell detached-start failure (including 0.18.1) need a one-time manual installer upgrade; personal settings and history are retained. Message deletion removes the bubble and visible history on both updated peers, while internal deletion records prevent replay. Downloaded files are not deleted from disk. Click chat/file notifications to restore the matching conversation and highlight the message; update-failure notices open Updates. Approval still requires its explicit button.
