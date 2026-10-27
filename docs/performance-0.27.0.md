# Remote desktop latency investigation — 0.27.0

The local animated desktop fixture identified capture pacing, codec choice and reliable input ordering as separate costs. It did not show a large sender queue in Automatic mode, so capture flags and bitrate ceilings were not changed without evidence.

## Same-resolution Quality comparison

Both runs captured the same display and animated canvas at 1920 × 1200 with the same Quality preset. H.264 was already used in Automatic mode; the change extends that preference to Quality mode, which previously preferred VP9.

| Metric | Previous Quality preference (VP9) | H.264 preference |
|---|---:|---:|
| Received FPS | 32.9 | 36.3 |
| Mean encode time per frame | 15.7 ms | 13.1 ms |
| Mean decode time per frame | 3.38 ms | 1.09 ms |
| Median capture-to-frame-callback age | 115 ms | 69.8 ms |
| p95 capture-to-frame-callback age | 163.7 ms | 111.2 ms |
| Mean receiver jitter-buffer delay | 75.3 ms | 37.0 ms |

FPS/encode/decode/jitter rates use 15-second counter deltas after five seconds of warmup. Frame age uses the video callback's captureTime and callback timestamp over the fixture; it is not a physical input-to-photon measurement. The capture display is matched to the selected desktop source. These measurements are local to one Windows workstation and do not establish company VPN throughput or a comparison against AnyDesk.

Automatic H.264 remained the best tested default: approximately 32.4 FPS with 40.7 ms median / 66.2 ms p95 callback age at 1728 × 1080. A 720p capture did not materially raise FPS. VP8 reduced resolution under the adaptive bandwidth policy and was not selected as a new default. The alternate desktop-duplication flag produced lower FPS/higher frame age, and the experimental zero-copy desktop flag did not establish a usable stream; neither flag is shipped.

## Input transport

Reliable ordered motion can wait behind retransmission of an earlier packet. New peers negotiate disposable motion on the existing unordered channel, while button/keyboard actions remain reliable. Monotonic epochs prevent motion from crossing a button/release edge; sequence numbers reject reordered packets. Buttons carry their absolute coordinates. Pending timer-based motion is discarded at a barrier. Host physical-input priority and permission checks are unchanged; older clients retain ordered input.

## Reproduce

- npm run test:media-performance -- --mode=quality --codec=VP9
- npm run test:media-performance -- --mode=quality
- npm run test:media-ui
- npm test

The media fixtures use an isolated profile and their own visible test windows. Production interactive capture still needs an unlocked Windows desktop. Unit tests simulate packet reordering and cancellation; real RTC media acceptance checks fresh approval after a transport interruption and no recovery after an explicit host stop.
