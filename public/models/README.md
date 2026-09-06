# Dropping authored art into REALMS

REALMS generates every model, texture and sound in code, so the game ships with
no binary assets at all. That is the default, not a constraint — this directory
is the seam where hand-authored art takes over, one piece at a time.

## How it works

At boot the game fetches `/models/manifest.json`. If it is missing or invalid,
nothing happens and the procedural content is used. If it exists, every entry is
loaded and **preferred** wherever its id matches something the game builds. You
can replace a single sword, or the entire cast, without touching game code.

```jsonc
{
  "characters": {
    "player": {
      "url": "/models/warden.glb",
      "scale": 1.0,
      "yaw": 180,              // use this if your model faces +Z
      "boneMap": {             // REALMS name -> your rig's bone name
        "hips": "mixamorig:Hips",
        "spine": "mixamorig:Spine",
        "chest": "mixamorig:Spine2",
        "neck": "mixamorig:Neck",
        "head": "mixamorig:Head",
        "upperArmL": "mixamorig:LeftArm",
        "lowerArmL": "mixamorig:LeftForeArm",
        "handL": "mixamorig:LeftHand",
        "upperArmR": "mixamorig:RightArm",
        "lowerArmR": "mixamorig:RightForeArm",
        "handR": "mixamorig:RightHand",
        "gripR": "mixamorig:RightHand",
        "upperLegL": "mixamorig:LeftUpLeg",
        "lowerLegL": "mixamorig:LeftLeg",
        "footL": "mixamorig:LeftFoot",
        "upperLegR": "mixamorig:RightUpLeg",
        "lowerLegR": "mixamorig:RightLeg",
        "footR": "mixamorig:RightFoot"
      }
    },
    "wolf": { "url": "/models/ashfang.glb", "scale": 1.16 }
  },
  "props": {
    "keep_gate": { "url": "/models/gate.glb", "at": [-60, 170, -430] }
  },
  "dracoPath": "/draco/",     // optional, if your GLBs are Draco-compressed
  "ktx2Path": "/basis/"       // optional, if your textures are KTX2/Basis
}
```

## The bone contract

An imported character keeps working with the game's animation, combat timing,
foot IK and weapon sockets because all of that is driven by **canonical bone
names**, never by imported clips. Map as many of these as your rig has:

```
root  hips  spine  chest  neck  head  headTop
clavL upperArmL lowerArmL handL fingersL
clavR upperArmR lowerArmR handR fingersR gripR
upperLegL lowerLegL footL toeL
upperLegR lowerLegR footR toeR
cloak1..cloak4          (optional — a cloak chain, driven from velocity)
```

Anything you leave unmapped is simply not animated. `gripR` is where the weapon
socket is parented; if you do not have a dedicated bone for it, map it to
`handR`.

Author in a **Y-up, -Z forward, metres** convention (Blender's glTF exporter
with "+Y up" does this). If your character faces +Z, set `"yaw": 180`.

## Baked animation clips

If your GLB contains clips you would rather use than the procedural ones, name
them in `clips`, keyed by REALMS state name:

```jsonc
"clips": { "idle": "Idle", "walk": "Walk_Fwd", "run": "Run_Fwd", "attack1": "Slash_A" }
```

States you do not list keep using the procedural version, so you can migrate
gradually — hand-authored attacks over procedural locomotion, for example.

## Environments

Props are plain GLB scenes. Give an entry an `at` position to have it placed
directly, or leave it out and reference the id from code. Imported materials are
patched into the world's atmosphere (height fog, aerial perspective, sun tint)
automatically, so they sit in the same air as everything else.

## Recommended export settings (Blender)

- glTF Binary (`.glb`), +Y up
- Apply modifiers, limit to selected objects
- Compression: Draco on meshes is fine (set `dracoPath`)
- Textures: KTX2/Basis if you have many (set `ktx2Path`); otherwise PNG/JPEG
- Keep each character under ~40k triangles; the game draws a lot of them
