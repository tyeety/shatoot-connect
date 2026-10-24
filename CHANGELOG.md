# Changelog

All notable changes are recorded here. Add work under Unreleased, then move it
into a dated version section before publishing. Versions follow major.minor.patch;
Git tags use v followed by the same package/lockfile version. Release automation
extracts the matching section and rejects missing or incomplete release notes.

## Unreleased

### Added

### Changed

### Fixed

## 0.14.2 — 2026-10-24

### Added

- Profile photo selection accepts AVIF, WebP and GIF alongside PNG/JPEG. Chromium decodes the actual source image before square cropping and thumbnail conversion; animated GIFs use their first frame.

### Fixed

- WebP no longer depends on nativeImage's PNG/JPEG decoder despite appearing in the file picker. All accepted formats normalize to the existing bounded PNG avatar format, preserving compatibility with LAN discovery, chat and earlier servers/clients.
- Real Electron UI tests cover AVIF, WebP, animated GIF first-frame selection, PNG/JPEG, center cropping, preview, persisted profile data and malformed-image rejection. Photo decoding has a timeout and always disposes its hidden sandboxed window; the 10 MB input limit remains enforced.

## 0.14.1 — 2026-10-24

### Added

- A stable Windows desktop launcher follows the latest opened version, including saved-computer shortcuts. Known app shortcuts migrate automatically; saved passwords stay out of shortcut arguments. Opening an older executable cannot redirect shortcuts away from a newer available version.
- A name dialog when saving computers from the connection form or history, and a visible Rename action. Renaming or resaving a computer preserves its encrypted credentials and shortcut identity.
- Cancel controls for outgoing desktop connections, coordinator handshakes and pending chat connections, including stalled validation and approval. Cancelled work cannot restart a connection after a late asynchronous result; existing chats remain connected.
- Real Windows updater/shortcut fixtures and focused Electron UI checks for stalled transports, cancellation/retry and Persian computer nicknames.

### Changed

- Successful updates delete their previous executable backup and downloaded/obsolete update packages after the new client confirms startup. Portable startup failure restores the working executable. Settings, credentials, chat history and received files remain untouched.
- Startup also removes recognized backup files left by older updaters; unknown files and manually downloaded executables outside the updater cache are preserved.

### Fixed

- Windows PowerShell reads launcher manifests and update-startup acknowledgements explicitly as UTF-8, including files without a byte-order mark. Real Windows fixtures exercise Persian executable paths and an unchanged desktop shortcut across version changes.

## 0.14.0 — 2026-10-24

### Changed

- Validation build superseded by 0.14.1 before publication. Its changes are documented in the 0.14.1 entry.

## 0.13.0 — 2026-10-24

### Added

- Persistent file-reception overrides for each private/group chat: inherit the global preference, receive automatically, or ask before receiving. The global default is automatic reception; existing explicit choices are retained.
- File-completion notices consider the actual selected conversation, native window visibility/focus and focus inside the chat tool. A focused chat renders its new attachment directly; other cases receive a desktop notice, including tray/background use.
- A common bottom-right notification stack/queue with critical-request priority, safe prompt expiry, host-panel space reservation and display-change reflow. Passive notices provide Hide, wait during system idle, fade after active reading time and pause on hover.
- Notification clock/activity/queue tests and a focused Electron/actual WebRTC file-transfer test covering global/per-chat UI, Downloads bytes, active/background/different chats, Hide, fade and English/Persian layouts.

### Changed

- New chat and desktop file transfers use unique Receive-* folders directly under Windows Downloads, preserving previous files and existing attachment references.
- The global ask-before-receiving setting also applies to desktop-control file offers. File validation, integrity checks and separate desktop permissions remain enforced.

## 0.12.1 — 2026-10-21

### Fixed

- The portable launcher now receives a 7z payload matching its extractor. Both NSIS targets use 7z so electron-builder's shared architecture cache cannot reuse the installer's ZIP payload for the portable build.
- Live session buttons use centered 22-pixel Material icons and consistent square hit targets. Hidden button labels no longer occupy flex spacing; full-screen and disconnect controls retain translated accessible labels/tooltips.
- Shared Material icon definitions are available in every window, including the host panel's previously missing hide/eye icon.
- Release validation executes the final portable binary, checks the extracted ASAR against the packaged source, and opens its actual packaged renderer to verify SVG loading and icon alignment in English and Persian before publication.

## 0.12.0 — 2026-10-21

### Added

- Encrypted last-password recall per LAN IP/port or Internet ID/server, on by default, with a setting that erases/disables the automatic cache.
- A 200-entry recent-connection list with timestamps, reuse counts, direct reconnect/save actions and inline saved-computer renaming. Saving a computer no longer needs a separate name/password form.
- Themed bottom-left application notifications, topmost critical desktop approvals, priority over ordinary toasts, queued concurrent requests and safe cancellation.
- Default close-to-tray and packaged Windows startup in the tray, with settings and explicit full-exit actions. Hidden host panels can be restored without changing session permissions.
- A dark Shatoot-purple theme, larger readable fonts and a new multi-resolution application/installer icon.

### Changed

- Removed the Saved computers settings tab, the Workspace/Remote desktop breadcrumb and You are in control slogan.
- Groups can be created without any other contact and populated later from saved/offline/discovered contacts. Removed minimum-two and fixed membership-count restrictions; transport/storage bounds remain. Invitations are delivered when connected and still require recipient consent.
- Enter submits the relevant action in connection, server, password, profile and nickname inputs. Static UI text/images no longer select/drag; editable fields and incoming file drops retain their behavior.

### Fixed

- Favorite saving no longer depends on hidden/empty remote fields or a required nickname/password; IPC wrapper prefixes are removed from connection-form errors.
- Remembered-password lookup is scoped to the exact target/server and cannot overwrite a later address or user input. Immediate Enter waits for an available remembered password.
- Windowed viewing fits the incoming display and measured UI chrome, preserves aspect during resizing, stays inside the screen work area and restores normal main-window size afterward.
- Discovery/language updates reach an already-open independent chat window.

## 0.11.1 — 2026-10-21

### Included in this release

- Verified one-click GitHub updates for installed and portable clients without deleting settings or encrypted chat history.
- A separate chat window that stays usable with the main window closed, file drag/drop throughout chat, optional automatic file acceptance and ordinary messages without an approval prompt by default.
- Profile photos, display names, availability statuses, repeatable Windows Firewall repair, up to eight independent desktop viewers and automatic LAN Ultra image quality. See 0.11.0 below for complete implementation details.

### Fixed

- The Windows update worker and its integration test compute SHA-256 through the built-in .NET stream API, avoiding dependency on PowerShell module discovery. Includes all 0.11.0 features; 0.11.0 packages were withheld after this compatibility issue was detected by CI.

## 0.11.0 — 2026-10-21

### Added

- Automatic stable GitHub release detection at startup/every six hours, manual checks and one-click verified update/restart for installed and portable Windows clients. Exact asset naming, HTTPS origin checks, bounded downloads, SHA-256/length validation, post-exit installation and portable rollback preserve the Windows profile and encrypted history.
- An independent chat window backed by the existing engine; closing the main window keeps an open chat usable, with main-window restoration and tray access.
- Optional automatic acceptance of incoming chat files, disabled by default; ordinary messages need no approval by default, with an opt-in approval setting. Group membership and desktop permissions remain separate.
- Per-device profile photos, display names and availability statuses, propagated to LAN neighbors and connected chat peers.
- A repeatable Windows Firewall repair action requesting native elevation and limiting inbound rules to private/domain local subnets.
- Up to eight independently approved desktop viewers with isolated signaling, capture/control state and disconnect panels, over LAN or ID.
- LAN Ultra quality: available display resolution up to 8K60, a 100 Mbit/s bitrate cap and resolution-prioritized encoding, selected automatically for direct LAN IP connections.

### Fixed

- File drops anywhere in the chat panel, including the composer, use actual OS file paths through preload and work in the detached window.
- Material icon centering and chat message header height in both interface directions.
- Additional guest disconnects do not revoke other desktop sessions; chat window closure restores an otherwise hidden main window.

## 0.10.0 — 2026-10-21

### Added

- Automatic nearby-computer discovery across active private IPv4 interfaces, including physical LAN and VPN adapters. Uses per-interface multicast/broadcast, endpoint expiry, interface refresh and a bounded cached-neighbor presence probe on Windows.
- Standalone one-to-one chat over LAN IP or Internet ID, with an explicit invitation and no screen/control permission. Text and files use separate encrypted WebRTC data connections; the coordinator carries signaling only.
- Group invitations and owner-coordinated group messaging/file forwarding, with encrypted persistent message queues for disconnected members. Group owners must remain online to relay messages.
- Searchable, paginated chat history, persistent contacts/groups, delivery state, per-batch file approval, received-attachment folder access and drag/drop file selection.
- A public GitHub repository, English/Persian documentation, Windows CI and tagged-release builds with validated changelog-derived release notes.

### Changed

- LAN signaling sockets now use the main-process Node TCP stack with interface selection instead of inheriting an HTTP proxy. Discovery does not alter OS routing, firewall, proxy or VPN security settings.
- Added compact Nearby computers and a separate bilingual messenger, preserving the initial remote-connection form and tabbed settings.
- Server advertises collaboration-v1 while retaining protocol-2 remote-desktop compatibility. Both clients and the coordinator must be updated for chat by ID; serverless LAN chat does not need a coordinator.

### Security and limits

- Chat history is encrypted with Windows DPAPI and saved atomically. Corrupt or full history produces an error instead of silently replacing the old transcript. Chat never grants clipboard or desktop input access.
- Nearby listings contain only reachable computers running the app. VPN kill switches, disabled LAN access, isolated Wi-Fi/VLANs and blocked ports can prevent discovery/connectivity; the app does not bypass those restrictions.
- Group messages pass through the group owner's client; this is not a server-hosted or always-available group service. File recipients must be online, and each receive batch requires approval. Offline file forwarding is not automatic.

## 0.9.0 — 2026-10-21

- Added an offline Windows installer with an English/Persian wizard, per-user/all-user scope, destination selection, desktop/Start menu shortcuts and Windows uninstall registration. Kept the portable distribution.
- Added preflight checks for Windows/architecture, destination safety, write access, free space, downgrades and running sessions. Silent deployment returns bounded failure codes instead of terminating the app or waiting on a hidden process-close prompt.
- Added forced installer CRC, checked ZIP extraction and SHA-256 validation of every packaged file before successful registration. Previous-uninstall failures stop the upgrade; personal settings and encrypted credentials are retained.
- Added real Windows installation lifecycle checks covering invalid/occupied/unwritable destinations, a running app, fresh install, downgrade prevention, a locked-file upgrade, repair and uninstall.

## 0.8.0 — 2026-10-20

- Added the missing guest-to-host cursor visualization as an independent orange pointer in a click-through overlay; preserved the physical host cursor and excluded both overlays from remote input.
- Added five Settings tabs, local password saving without Internet readiness checks, LAN credential display/copy and a persistent LAN-only mode.
- Initialized channels that are already open and granted viewer exchange permission during normal session acceptance. File tests now use naturally negotiated control/file channels rather than manual setup.
- Added in-video file progress and Open received files; clipboard failures after delivery keep the successfully received files accessible.
- Verified offline password changes, natural bidirectional serverless LAN file transfer, host-visible guest cursor and real Windows file clipboard with original contents restored.

## 0.7.0 — 2026-10-20

- Moved advanced host, password, LAN, server, language, quality and saved-computer editing into a separate Settings dialog; added password reveal controls.
- Replaced the full-width auto-hiding remote toolbar with a small persistent control panel.
- Added bidirectional keyboard layout synchronization with versioned, deterministic updates and echo suppression.
- Added an optional independent host cursor indicator, enabled by default, without moving the guest cursor.
- Removed per-key IPC queries, cached layout names, started capture at the selected profile resolution, requested low receiver buffering and reduced pointer coalescing to 8 ms.
- Added layout conflict and real RTC synchronization coverage; actual Internet latency still requires two-device acceptance.

## 0.6.0 — 2026-10-20

- Added explicit unattended access with a fixed password; random-password sessions retain consent and clearing the password disables unattended access. Updated broker marks verified fixed-password requests.
- Captured physical guest shortcuts while the remote image is focused, with release on blur/disconnect and an independent emergency disconnect path. Secure Windows shortcuts and desktops remain unsupported.
- Added bidirectional plain-text and Explorer file/folder clipboard synchronization, Send files and file drops on the remote image followed by Paste.
- File transfer uses a separate encrypted reliable data channel, bounded chunks, acknowledgements, path validation, unique receive folders, SHA-256 verification and partial-transfer cleanup.
- Preserved the compact bilingual form and added transfer/protocol regression coverage.

## 0.5.0 — 2026-10-20

- Translucent host overlay; remote pointer hit testing targets the underlying window while host overlay controls remain interactive.
- Full initial client form fits without page scrolling at 1000x720 in both languages, with an independent saved-computers list.
- Optional fixed host password for Internet and LAN, encrypted using Windows DPAPI; fixed secrets are masked in the main display.
- Saved computer credentials, one-click connection, named Windows desktop shortcuts containing record IDs only, and shortcut target refresh after portable upgrades.
- Guest-authoritative Windows keyboard layout synchronization before each physical key, live refresh, explicit compatibility checks and restoration on session end.

## 0.4.0 — 2026-10-20

- Video-only HTML fullscreen with Escape, automatic exit on session end and restoration of window controls.
- Compact client layout with all connection inputs visible at 1000x720 in English and Persian.
- Bundled Vazirmatn fonts and official Google Material SVG icons, available offline.
- Tiny always-on-top host participant panel with immediate disconnect, retained while the app is minimized.
- Independent guest pointer input by default, without moving the host system cursor; explicit host opt-in for shared cursor compatibility.
- Native Win32 and Chromium click checks verify delivery while the host cursor stays unchanged; fullscreen/overlay/compact layout checks exercise real Electron sessions.

## 0.3.0 — 2026-10-20

- Added automatic direct-IP listeners with a separate LAN password and native host approval; LAN video works without central registration, STUN or TURN.
- LAN sessions coexist with Internet registration and survive central broker outages.
- Server Manager now defaults to STUN-only direct P2P, with managed TURN disabled unless explicitly configured.
- Added direct-listener authorization/consent coverage and serverless direct-IP capture/encode/decode smoke coverage.

## 0.2.0 — 2026-10-20

- Renamed the product to Shatoot Connect, with English default and Persian/RTL in the client and Server Manager.
- Added a self-contained Windows Service and independent configuration UI, protected storage, service controls, failure recovery and bounded logs.
- Automatic startup ID registration with the last successful server, reconnect retries, persistent device IDs, password rotation and retained registration during outgoing sessions.
- Screen capture begins only after host approval, independently of ID registration.
- Cloudflare Realtime TURN integration with server-only API tokens, temporary ICE credentials, client enrollment and exported first-launch connection files.
- Real relay-only network probes and local forced-TURN video/profile-change validation. Target CDN/Cloudflare and elevated Windows Service acceptance remain pending deployment.

## Server bundle — 2026-10-20

- Added a separate Windows x64 signaling server ZIP with bundled Node.js runtime and a double-click launcher; no Node.js installation is needed on the server.
- Added editable server configuration, startup diagnostics, LAN addresses and occupied-port errors.
- Clarified that clients receive a temporary ID only after connecting to signaling and starting screen sharing; no public server is preconfigured.

## 0.1.0 — 2026-10-19

- Windows remote desktop app with a Persian RTL interface and portable x64 build.
- Direct WebRTC screen streaming, H.264/VP9 codec preferences, 720p through 4K target profiles and live quality changes.
- Monitor selection, temporary credentials, explicit host consent and optional Windows mouse/keyboard control.
- Emergency disconnect, input release on session termination, connection health and live WebRTC statistics.
- Standalone WebSocket signaling with TURN configuration, consent-gated forwarding, connection and credential attempt limits.
- Protocol integration tests and a real local capture/encode/decode smoke test.
