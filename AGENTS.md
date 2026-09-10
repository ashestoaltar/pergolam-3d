# Pergolam 3D — project lock

Work-related CPQ preview for Anchor Pergolas. Do not mix with Bobiverse.

## Locked plan (do not re-mirror)

A normal Three.js camera looking from C toward A, and Top with `up = +Z`, puts **screen-right on world −X**. The model is built for that. Never flip the ortho frustum, never `scale.x = -1` the scene, never replace sprites with mirrored billboard hacks.

```
        U4 ---- A ---- U3          +Z = A (far / top of plan)
        D              B           −Z = C (near / bottom of plan)
        U1 ---- C ---- U2          +X = D (plan-left)
                                   −X = B (plan-right)
                                   +Y = up
```

- Front = outside C: U1 left, U2 right
- Iso = from U1: U1 near-left, U2 near-right, A far
- Side = outside B
- Motor Left = on D (screen-left). Motor Right = on B (screen-right)

Helpers in `js/pergola3d.js`: `xB = -W/2`, `xD = +W/2`. View angles: iso `[145, 30]`, front `[180, 0]`, side `[270, 0]`.

## Drain arrows (relative to the facing end)

Blue ground arrows. Not pipes. Direction is from the person looking at that end:

- **C-end (U1, U2):** stand outside C. Left = D, Right = B, Out = toward C, In = toward A.
- **A-end (U3, U4):** stand outside A. Left = B, Right = D, Out = toward A, In = toward C.

Do not use plan-left/plan-right for Left/Right on U3/U4.

## Fan bar

Hangs under the louver nearest mid-projection. Even louver count: pick the one toward C (−Z), `floor((n-1)/2)`. That blade stays closed (0°) while the others open. One bar per bay, same louver index.

If Iso looks mirrored again, the coordinates drifted — fix placement, not the camera.

## Serve

```
python3 -m http.server 8787 --bind 127.0.0.1
```

Open http://127.0.0.1:8787/ — bump `?v=` on script tags in `index.html` after JS changes.
