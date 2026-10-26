# Changelog

All notable changes are recorded here. Add work under Unreleased, then move it
into a dated version section before publishing. Versions follow major.minor.patch;
Git tags use v followed by the same package/lockfile version. Release automation
extracts the matching section and rejects missing or incomplete release notes.

## Unreleased

### Added

### Changed

### Fixed

## 0.21.0 — 2026-10-26

### Changed

- Shared mouse control is now the default, with a one-time migration of existing installations. The limited independent pointer remains available by disabling Use shared mouse in Host and access. Remote moves, clicks and wheel events use absolute SendInput coordinates across the virtual desktop, and moves travel on the ordered button/key channel to preserve drag ordering.
- All host sessions in one app instance use one native input worker. Only one authorized viewer can inject input at a time; held buttons/keys prevent handoff. A controller's idle turn expires after two seconds with no held inputs. Physical host mouse/keyboard activity preempts remote input and pauses all viewers until the host is quiet for two seconds with no physical buttons/keys held. Viewer status explains host activity or another controller.

### Fixed

- Focus loss, channel failure, session end and helper EOF release held remote inputs. Ending one non-controlling viewer does not release the active viewer's keys. The optional independent mode cancels unfinished button/menu actions instead of invoking them during release. Physical host keys/buttons are not artificially released, and host activity discards borrowed keyboard-layout restoration so it cannot override the host's layout choice.
- Late one-way input, presence and signaling events from a closed window are rejected without throwing an uncaught IPC error. Frame and session validation remain enforced.
- Native regression coverage drives the real stdin worker and Windows input stream to drag, select text, resize a window and release a held button on EOF, and verifies injected input does not trigger the physical-host monitor. Arbitration tests cover held drags/keys, idle handoff, host priority and invalid packets. The capture quality test now checks source-relative resolution and actual constraints on smaller displays.

## 0.20.9 — 2026-10-25

### Fixed

- A group's chosen background now appears on its contact card in the chat list, underneath the same dark purple readability overlay used for computer cards. It no longer changes the message timeline. Existing saved group backgrounds are reused automatically, including on other group members' clients.
- Group background actions explicitly say card background in English and Persian. The chat UI regression check verifies the owner and member cards receive the image while the timeline remains unchanged.

## 0.20.8 — 2026-10-25

### Fixed

- Sending chat text with the Send button or Enter no longer displays the generic Done snackbar. Pending/press feedback and actual error reporting remain available.
- Independent remote clicks on standard Windows push buttons deliver a single BN_CLICKED command to the button's immediate parent instead of relying on BM_CLICK's simulated mouse pair. This covers nested property-page and shield buttons such as Advanced Sharing without moving the host cursor. Release outside the button cancels the click; check/radio buttons keep native state handling. Windows integrity and secure-desktop restrictions still apply; the host must run this version for the input change.
- Native input regression checks now cover a nested property page with an overlapping group frame and shield button, one command per click, cancelled release and protected-overlay pass-through. Chat UI checks cover both Send and Enter without a redundant snackbar.

## 0.20.7 — 2026-10-25

### Added

- Each private or group chat has a Mute/Unmute notifications bell in its header and a muted indicator in the contact list. The local preference persists in encrypted history. New text, voice and completed-file popups are suppressed while messages, transfers, unread badges, history and explicit approval policies keep working.
- Chat message body text can be selected and copied as plain text, including partial selections. Other interface labels remain non-selectable and message text does not become draggable.

### Fixed

- All eight vertical Settings tabs share one delegated click handler. The first four static tabs work again; dynamic tabs no longer have a second independent click handler. Physical click regression checks verify one selection per tab.
- Contact selection uses its selected background/border instead of stacking a mouse-down scale with a second click pulse. Clicking an already selected contact no longer resets its history or scroll position. Settings tabs also use their selected state instead of a scale pulse.

## 0.20.6 — 2026-10-25

### Fixed

- Independent-pointer menu clicks now recognize Windows UI Automation menu items, including modern popup providers, without foregrounding/dismissing the popup or moving the host cursor. Invoke/ExpandCollapse patterns handle actions and submenus; checked MSAA menu-item actions remain a fallback for classic menus. Unsupported underlying controls are not accidentally invoked when a menu disappears. Install this fix on the host computer as well as the viewer; older hosts keep their older input helper.
- Remote-video window minimum/content dimensions are rounded to positive integers before calling native window APIs.

### Added

- Local-only Electron crash minidumps under the existing profile's `crashes` directory, with uploads disabled. Bounded `logs/process.log` diagnostics now record startup, normal exit, renderer/GPU exits, viewer frame dimensions and window hiding/close requests without participant names or message/clipboard contents. Minidumps are process-memory diagnostic files and remain local.
- A development-only isolated crash-recorder smoke test intentionally crashes a blank fixture renderer and verifies a real local dump and exit record with uploads disabled; both Windows CI workflows run it. The native popup-menu test now requires a successful UI Automation action with zero physical cursor moves. `test:smoke -- --quality-smoke` exercises VP9-quality remote viewing alongside the existing H.264 LAN path.

### Investigation

- A reported viewer exit when the first remote image appeared could not be reproduced locally: H.264 and VP9 connections decoded frames and continued through the full RTC/input/clipboard tests. No matching pre-existing application crash log or dump was available. This release does not claim that specific crash's cause is confirmed; the new recorder preserves evidence if it recurs.

## 0.20.5 — 2026-10-25

### Added

- Drag pinned chat rows or pinned saved/recent computer cards to arrange them. A drop indicator shows the destination; Alt+Up/Down provides keyboard reordering. Chat order persists in encrypted history and connection order in local preferences, independently. Incoming messages, reconnects, saving a recent connection and recognized device-address changes preserve the chosen order. Unpinned items retain their normal recent-first ordering.
- Reorder requests validate the complete current pinned set, rejecting stale, duplicate or foreign entries without replacing the stored order. Computer list refreshes wait until a drag ends so they cannot remove the dragged card mid-gesture. Other app text remains non-draggable.

### Changed

- Settings uses a vertical tab sidebar with independently scrollable content. English places the sidebar on the left; Persian/RTL places it on the right. All tabs, including dynamically added sections, support Up/Down and Home/End keyboard navigation. Light/dark themes and reduced-motion behavior are preserved.

## 0.20.4 — 2026-10-25

### Added

- The combined saved/recent connections list now has a translated Pin/Unpin action on every card. Pinned computers appear above unpinned computers; last-connection order is retained within each section. Pins persist locally across restarts, saving a recent computer and recognizing the same device through a known alternate address.

### Changed

- Active chat and connection pin icons tilt; unpinned icons remain upright. The change animates briefly and respects reduced-motion preferences.

## 0.20.3 — 2026-10-25

### Added

- Chat attachments have separate Open and Open containing folder actions. The folder action selects the original sent file or downloaded received file in Windows Explorer.
- Chat history groups messages by local calendar day, with small centered sticky dates in English/Persian and time-only message footers. A displaced sticky date fades after scrolling stops and reappears on the next scroll.
- A floating history button returns to the latest messages or jumps to the first new unread message, with a count of incoming messages received while reading older history.

### Fixed

- Message rows retain their DOM identity across refreshes, preserving voice playback, pointer clicks and reading position. Loading older history and late attachment previews retain the visible message anchor; background refreshes no longer cancel smooth scrolling.
- Chat file Copy now adds the native Windows preferred Copy drop effect and verifies that the original attachment paths reached the clipboard. Message actions keep their visual feedback without redundant Done snackbars.
- Focused chats scrolled into older history retain new-message unread counts until those messages are viewed or the user returns to the bottom. Existing settings, saved computers, downloaded files and encrypted history remain in place.

## 0.20.2 — 2026-10-25

### Added

- Settings > Display and language now offers Dark and Light themes, with translated English/Persian labels. Dark remains the default. The choice persists in the existing application settings and applies immediately to open main/chat windows, new notifications, host connection panels and native app appearance.
- A light purple palette covers inputs, settings, chat messages, attachment cards, controls and notifications. Remote video remains unchanged; wallpaper-backed computer cards retain a dark overlay and readable labels.

## 0.20.1 — 2026-10-25

### Added

- Inline previews for image attachments and file cards with names, types and sizes for sent/received files. Previews are decoded locally in a sandbox, cached with file modification checks, and open the matching attachment without exposing filesystem paths to the renderer.

### Fixed

- Chat selection and pin buttons retain their DOM identity during focus/unread/discovery updates, so a pointer-down is not lost before pointer-up. Pin actions read the current state instead of a stale render snapshot. UI tests exercise real Chromium pointer events with a delayed release.
- Chat Paste handles browser text/image data directly and leaves Ctrl+V/Shift+Insert to the browser's paste event. Text paste no longer depends on the native file bridge or image clipboard API; Explorer files retain the native fallback. Clipboard image reads cannot prevent plain-text insertion.

### Upgrade note

- Version 0.19.3 and earlier can report Update installer could not start (0) before starting the downloaded installer. Their running legacy launcher cannot be repaired by the downloaded package. Run the latest Setup manually once over the existing installation, without uninstalling; settings/history remain. The replacement launcher introduced in 0.19.4 is covered by Windows updater and installer tests.

## 0.20.0 — 2026-10-25

### Added

- Pin/unpin private and group chats. Pins, the last selected conversation and local unread watermarks survive restarts in encrypted history. A new chat window restores the selection, or selects the first available conversation.
- Group owners can choose/remove a shared chat background independently of the group photo. Updated members receive the background immediately or after reconnecting.
- Unread counts beside contact names, a total on Chats and files, and Windows taskbar overlay badges. Reading a focused conversation clears its count; deleted messages no longer contribute.
- Native Windows virtual-file clipboard: copying files advertises names/sizes without downloading. Pasting requests contents over the existing encrypted remote channel; Explorer writes streams into the chosen destination. A private temporary cache supports rendering and is removed on normal application exit. Both peers need this version for deferred file clipboard.

### Changed

- Contact presence uses color indicators instead of textual online/offline labels. Notifications use smaller typography, spacing, borders and width while keeping their shared bottom-right queue and Hide/approval controls.
- The separate chat window is excluded from remote screen capture and remote pointer hit testing, like protected host controls and notification windows. Host users retain normal access to these windows.

### Fixed

- Incoming clipboard text/files respect a newer local clipboard change instead of overwriting it between polls. Local copies remain available for local Paste.
- Notification shutdown no longer reads a destroyed window webContents or leaves a stale queue entry that can crash the application.
- Starting a chat by a known address reuses its pending/connected session, avoiding a duplicate invitation being declined during automatic reconnect.
- Resizing a remote window below its minimum size clamps dimensions before computing the image aspect ratio, avoiding a distorted viewport.
- Native Windows context-menu items use their accessibility action, without moving the host pointer or activating/dismissing the popup window. Isolated native menu and OLE stream tests cover both paths.

## 0.19.4 — 2026-10-25

### Fixed

- Update helper startup no longer launches Windows PowerShell with Node's detached flag, which can exit successfully without executing its command. A hidden Windows Start-Process handoff keeps the worker independent after the app exits. Each update uses its own worker script, readiness token and bounded retained diagnostic files. Readiness and early-exit errors are checked before the app closes. The same detached-launch issue no longer prevents startup cache cleanup. Older affected clients need one manual installer upgrade to obtain this fix.
- Deleting an own message removes it from both peers' visible history and conversation preview, without a Message deleted bubble or empty row. Internal deletion records still prevent delayed/offline replay from restoring it; received files remain in their filesystem locations.
- Clicking a message, voice or file notification opens the correct chat and highlights the related message, restoring a minimized chat or creating it if closed. Update failure notices open Updates. Other passive notices restore their owner; clicking an approval notice never approves it. Hide continues to dismiss without navigating.

## 0.19.3 — 2026-10-25

### Fixed

- Selecting a chat contact or group no longer shows a redundant Done snackbar; click feedback and genuine errors remain available.
- Snackbars include an English/Persian OK button for immediate dismissal while retaining automatic expiry. The confirmation remains clickable inside modal dialogs.
- The header firewall shortcut starts hidden and appears only when a read-only check finds blocked/missing inbound permission for this executable on an active, enabled Windows firewall profile. Checks allow time for the initial Windows prompt, refresh on focus/periodically, and hide the shortcut after successful repair or when status cannot be determined. Settings retain manual repair. No peer/server reachability heuristic triggers this action.

## 0.19.2 — 2026-10-25

### Changed

- Compact share/connect headers place their icon beside the title and remove the redundant This device/Remote device labels. Consistent card/control spacing, centered edit icons and bottom-aligned host actions replace conflicting legacy CSS.
- Nearby computers use the remaining main-window height, with security/emergency-disconnect information at the bottom. Removed the idle LAN-ready sentence.
- A firewall button immediately after Settings retries Windows firewall access using the existing explicit administrator approval and private/domain LAN rules; success/cancellation use the shared action feedback. Windows controls the native permission UI.

### Added

- Bounded local process diagnostics for fatal exceptions and renderer/GPU process exits. Chat, clipboard and profile payloads are excluded. The reported idle Alt+Tab/screenshot closure could not be reproduced; repeated native focus changes and window captures are covered by the UI smoke check.

## 0.19.1 — 2026-10-25

### Fixed

- Clipboard-image paste uses Electron's asynchronous ClipboardItem API instead of the removed clipboard.readImage method. Files still use the Windows file clipboard bridge.
- Save Profile explicitly confirms success, including after photo/name changes and when saving unchanged values. Other actions no longer lose feedback because an unrelated computer or chat list rerendered.
- Computer cards show the Windows wallpaper file rather than a screenshot. LAN discovery retrieves wallpaper for nearby and saved LAN computers before any chat or desktop connection; saved Internet-ID computers on the active server establish background chat for metadata. Wallpaper is bounded, cached encrypted for offline cards and refreshed periodically; obsolete screenshot caches are ignored. Both peers need the updated wallpaper feature; devices without a reachable peer or cached wallpaper retain a plain background. Solid-color Windows desktops are supported.

## 0.19.0 — 2026-10-25

### Added

- One computer list combining saved systems and connection history. Each system appears once, with a muted outline star for saved connections or a clock for recent connections, sorted together by the last successful connection. Canonical LAN addresses and known device identities prevent duplicate saved/recent cards; saved credentials, names and shortcut identities are retained.
- Automatic small desktop-card JPEG exchange over established chat connections, refreshed once per minute and cached encrypted for offline cards. Both peers need this feature. Thumbnail sharing is separate from full remote-screen/control permission.
- Copy actual file/voice attachments to the Windows file clipboard and paste copied Explorer/chat files into a conversation with Ctrl+V or Paste. Text and clipboard-image paste remain supported. Files retain the existing reception settings, transfer grants and hash verification.

### Changed

- Compact icon-only Rename actions, muted computer-type markers in the physical top-right corner, and removal of the two redundant ID/password helper sentences. Restyle action snackbars as passive status notices with an information icon and a subtle side accent rather than a button-like outline.
- Simplify the chat window: remove the extra heading, close, Connect/Disconnect and Show main window actions; reconnect known chats automatically. Move incoming-file reception preferences into contact/conversation settings. Use a circular combined Record/Send action inside the message field, with file upload below it, and a floating New group action over the contact list.
- Put Copy and attachment Open actions next to each other opposite the timestamp. Replace native chat-list/message scrollbar gutters with faint translucent overlay thumbs while preserving wheel, keyboard and thumb-drag scrolling. Fix desktop-card image stacking under the readable purple overlay.

### Compatibility

- Includes the previously local-only 0.18.2 and 0.18.3 changes. Existing settings, encrypted credentials, saved computers, shortcuts and chat history are retained. No coordinator upgrade is required for these client changes; ordinary messaging/desktop connections remain compatible with earlier clients. Automatic chat desktop thumbnails require upgraded clients at both ends.

## 0.18.3 — 2026-10-24

### Changed

- Local build: remove the chat heading/extra close button and use faint translucent scrollbar thumbs over the contact/message content without reserving a scrollbar gutter. Keep scrolling and thumb dragging available; simplify the address-field focus border.
- Place attachment Open and Copy actions together opposite the timestamp. Copying a file/voice attachment places its actual original/downloaded files on the Windows file clipboard, so they can be pasted into Explorer or chat. Missing/pending attachments cannot be copied as misleading filename text.
- Paste copied Explorer/chat files directly into the selected chat using Ctrl+V or Paste. Keep image and plain-text paste working through the combined composer; clipboard file paths remain in the local main process and file transfer still uses its existing grants, reception policy and content hashes.

## 0.18.2 — 2026-10-24

### Changed

- Local build: align message Copy/edit/delete controls opposite the timestamp, remove chat Connect/Disconnect and Show main window actions, and reconnect known chats automatically.
- Move incoming-file reception preferences into the contact-name/settings dialog. Place a combined circular Record/Send action inside the message field, with attachment upload beneath it; typing changes Record to Send. Keep New group floating over the bottom-right of the scrolling contact list.
- Exchange small desktop JPEG previews automatically over established chat connections, refresh every minute and retain the last image encrypted for offline cards. This explicitly shares a desktop thumbnail independently of full remote-screen/control permission; both clients need this feature. Fix card stacking so the desktop image is visible underneath the purple overlay and readable foreground content.

## 0.18.1 — 2026-10-24

### Added

- Copy beneath chat messages; senders can edit their text messages or delete their own text/file/voice messages. Changes persist in encrypted history, queue while offline, deduplicate by revision, and propagate through group owners. Deleted messages retain a tombstone; downloaded or original files are not erased from disk.
- Group owners can update the group name, description, photo and membership. Photos support the same PNG/JPEG/WebP/GIF/AVIF decoding as profile photos. Group revisions prevent older metadata from reverting a newer edit.

### Fixed

- Restrict list loading animations to the manual nearby-computer Refresh button. Background discovery, receipts and history updates no longer animate every list. Keep ordinary button feedback and align all top header buttons to the same height.
- Capture the first decoded/playing remote desktop frame automatically, including short sessions, and retain the preview offline. Reduce the dark-purple card overlay opacity so the cached desktop image is visible. Recent and saved computer cards now include profile avatars.
- Recheck GitHub releases immediately before downloading/installing and after download; select the highest stable published version instead of trusting a previously cached package or the latest-release marker. Verify package size and SHA-256 again before reusing a download; refuse an incomplete newer release rather than installing an older one.
- Wait for the validated update worker's readiness acknowledgement before quitting. Installed updates explicitly retain their installation scope, relaunch the application visibly and require the new version/executable to acknowledge startup. Preserve the last update result and surface failures on the next startup. Recognize four-part Windows product versions when cleaning old portable backups.
- Exercise the installed updater through real NSIS installation and packaged application restart in clean Windows CI, in addition to portable rollback, shortcut and profile-preservation checks.

### Compatibility

- Desktop protocol 2 and the existing coordinator remain compatible; no exact application version match is required. Synchronized message edit/delete requires version 0.18.0 or newer on each participant, including the group owner. Older clients still exchange ordinary messages/files; pending changes wait for a capable peer. Existing credentials, settings, contacts and chat history are retained.
- Desktop previews become available after viewing an approved remote desktop; chat alone does not grant screenshot access. Deleting a message removes it from the synchronized app history view, not from already exported/copied content or files on disk.

## 0.18.0 — 2026-10-24

### Build status

- Internal candidate only; no release was published. Installed-update verification exposed test assumptions about stable shortcuts and first-launch device identity initialization. Version 0.18.1 contains the same application changes with corrected preservation checks.

## 0.17.1 — 2026-10-24

### Fixed

- Show live download percentages on both the main-window update button and the Settings update button. A dedicated nonshrinking percentage badge remains visible when the translated status label is long or the header is narrow, including 0% and 100%; downloading buttons retain full contrast while disabled. Language changes refresh both button labels without losing the current progress.
- Give the chat window its own blue speech-bubble icon and a role-first native title: Chats · Shatoot Connect (or its Persian equivalent). Prevent the shared HTML page title from replacing that native title during loading. The chat document/favicon and native title now remain distinct from the purple main application window; global language changes update the chat title.

### Compatibility

- No coordinator, protocol or data-format changes. Settings, credentials, voice messages and chat history are preserved.

## 0.17.0 — 2026-10-24

### Added

- Record and send voice messages directly from private and group chats. Press Record voice to start, Send voice to finish/send, or Cancel recording to discard. A visible timer accompanies recording, with a five-minute limit and a bounded 10 MB payload.
- Play voice messages inside chat bubbles using standard audio controls. Playback is loaded only on explicit Play, pauses other voice players, and retains its player when history refreshes. Sent voice originals remain available through encrypted history attachment references; received recordings follow the Downloads file-transfer destination and reception policy.
- Microphone access is scoped to the requesting chat/main window and enabled only for a short startup interval after pressing Record. Camera access is not granted. Cancel, conversation changes and closing the chat release the recording stream; capture errors report a localized message.

### Fixed

- Enabled buttons and their nested icons/text consistently show the pointing-hand cursor throughout the application, including busy actions. Disabled buttons retain the unavailable cursor.

### Compatibility

- Voice messages are Opus audio in WebM files sent through the existing encrypted, hash-verified file-transfer channel. No coordinator/protocol upgrade or matching app version is required; older clients receive an ordinary WebM attachment. Inline voice playback/recording requires this client version. File recipients must be reachable/connected, including group recipients under the existing group-file rules.
- Voice recording needs an available microphone and Windows microphone privacy permission. It is independent of screen/control permission and is not desktop audio sharing. No sound plays automatically on receipt. Existing settings, chat history and credentials are preserved.

## 0.16.0 — 2026-10-24

### Added

- Automatic reconnection of known chats using discovered LAN routes or saved LAN/Internet routes, including while the main window stays in the tray. Selecting a conversation, sending queued text or sending files also establishes its connection automatically. Background retries are bounded and do not disable manual connection inputs.
- Paste clipboard images into the message field to send them as ordinary verified PNG file transfers. Sent images remain in the local history cache; normal text paste remains available.
- Open outgoing attachments from the original selected files/folders, and a dedicated remote-connect action plus a Material shortcut icon on saved computer cards.
- Shared button press feedback, animated data refreshes, and local themed snackbars for action/update feedback.

### Changed

- Remove redundant chat/profile explanatory copy. Chat reconnect is automatic instead of requiring a Connect chat button. Static app text and images cannot be selected or dragged; editing and external file drops remain enabled.
- Size the initial remote view to the largest native host image fitting the guest display work area. Later sessions reuse the last remote view size, bounded by the host resolution and guest work area. Preserve and restore the main window's previous bounds/maximized state.
- Clicking an attachment explicitly opens its local file (or the containing directory for multiple files); files still never open automatically on reception.

### Fixed

- Incoming ordinary messages now use the shared bottom-right notification queue when their conversation is not actively focused. Duplicate delivery and messages read in the focused chat do not produce repeated notifications.
- Keep update download progress visible on the main-window button, show download/install errors through local feedback, retain retry after a failed download and publish the installing state before restart.
- Closing a remote viewing window ends its desktop session, releases input/capture state and then hides the app in the tray. Chats remain available.
- Resolve simultaneous outgoing chat invitations deterministically instead of maintaining competing sessions. Sender file history now retains original paths, including empty selected folders.

### Compatibility

- An exact app-version match is not required. Desktop protocol 2 and the collaboration-v1 capability remain unchanged; compatible older clients/coordinators can still connect. Clipboard images use the existing file-transfer protocol. Peers must be reachable/running; saved Internet chats require their coordinator connection.
- Settings, encrypted credentials, private names and existing chat history remain in the same Windows profile. Background chat is available while the application is in the tray, not after Quit completely.

## 0.15.0 — 2026-10-24

### Added

- Shared private computer nicknames across saved computers, recent connections, nearby cards, chat lists/titles/history/group members and file notices. Rename a private chat contact with its name button; remote profile updates preserve the local nickname, and nicknames are not sent as the other person's published name.
- Visible self-profile chips in the main and chat windows open Profile settings. A chosen display name and photo propagate to peers; chat lists always render a profile photo or a default icon.
- Last-received desktop thumbnails behind saved/recent/nearby/chat cards with a dark purple overlay. Thumbnails refresh during an authorized received video session and at disconnect, remain available offline, are bounded and encrypted with Windows DPAPI, and follow known LAN/ID device identities. Devices never viewed have no desktop thumbnail; there is no background remote-screen capture.
- Installer background-app closing for verified Shatoot Connect processes in the same Windows account/session. Current clients exit gracefully through a background-exit command; older clients without that command are closed only after verifying no visible windows. Visible application/chat windows and unknown same-name programs block installation with the existing Retry/1618 behavior.

### Fixed

- Notifications measure their rendered text/buttons before appearing and use only the required width/height, bounded by available screen space. The common priority queue reflows mixed-height notices without overlap; queued-window events are ignored safely after removal.
- The chat sidebar now separates fixed connection/group/profile controls from a scrolling contact list. Profile pictures align with names, narrow English/Persian layouts remain usable and cards no longer shrink into overlapping rows.
- Cached settings and decoded thumbnails avoid repeated disk reads/decryption in the live input/presence path. Preview capture uses a small JPEG, runs at most once per minute plus connection/disconnection, and does not transmit screenshots through discovery or chat.
- Extended Windows/UI tests cover nickname privacy, profile changes, persistent offline thumbnails, avatar rendering, compact/long notices, narrow bilingual layouts and visible-versus-hidden installer process handling.

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
