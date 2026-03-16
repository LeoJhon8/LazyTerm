# RDP Pipeline Comparison

```mermaid
flowchart LR
    subgraph LT["lazy-terminal RDP pipeline"]
        direction LR
        LT1["Server RDP updates"] --> LT2["IronRDP decode to DecodedImage"]
        LT2 --> LT3["App-level frame strategy\ninteraction policy / batching / refinement"]
        LT3 --> LT4["Re-encode frame\nRGBA direct or JPEG"]
        LT4 --> LT5["Tauri IPC channel"]
        LT5 --> LT6["WebView decode / putImageData / createImageBitmap"]
        LT6 --> LT7["Canvas compositing and presentation"]
    end

    subgraph MS["mstsc pipeline"]
        direction LR
        MS1["Server RDP updates"] --> MS2["Windows native RDP stack"]
        MS2 --> MS3["Native graphics / codec / cache path"]
        MS3 --> MS4["Native window presentation"]
    end

    H1["Hotspot 1\nApp-level re-encode"]
    H2["Hotspot 2\nIPC transfer"]
    H3["Hotspot 3\nWebView canvas presentation"]

    LT3 -. major latency .-> H1
    LT4 -. major latency .-> H1
    LT5 -. major latency .-> H2
    LT6 -. major latency .-> H3
    LT7 -. major latency .-> H3

    Gap1["Key gap:\nlazy-terminal adds an extra app-managed image pipeline"]
    Gap2["Key gap:\nmstsc stays closer to the native protocol and presentation stack"]

    LT7 --> Gap1
    MS4 --> Gap2

    classDef hotspot fill:#ffd6d6,stroke:#b42318,color:#7a271a,stroke-width:2px;
    classDef note fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:1px;
    class H1,H2,H3 hotspot;
    class Gap1,Gap2 note;
```

## Notes

- Hotspot 1 is where lazy-terminal still pays the largest CPU cost when frames are re-packed for the frontend.
- Hotspot 2 is the extra copy and transport layer between Rust and the WebView.
- Hotspot 3 is the browser-side rendering path, which mstsc does not have.