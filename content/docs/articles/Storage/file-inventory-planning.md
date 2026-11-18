---
weight: 10
title: "Bringing Order to Decades of Drives, Part 1: Planning a File Inventory"
draft: true
aiAssisted: true
---
# Bringing Order to Decades of Drives, Part 1: Planning a File Inventory

{{% hint info %}}
**Work in progress, November 2026.** This part describes the plan and the design decisions. Nothing of it is built
or measured yet. Later parts will cover the implementation, real throughput numbers and the results.
{{% /hint %}}

Over the years, I should almost say decades, I was not very diligent with backups and storage in general. The
result is a drawer with a number of external USB hard drives, a few internal drives and a NAS. Many files exist
more than once: some in duplicate, some even in triplicate, for example on the NAS and on one or two USB drives.
What I do not have is an overview. I cannot say how much of all this data is actually original, and I cannot say
whether it would fit on one drive in a sensible structure, or whether I have to split it across several drives.

In order to get there, I am going to write a small tool. Its working name is `drivecat`, short for drive catalogue.
The source code is on [GitHub](https://github.com/ThomasZeman/drivecat) under the MIT license. This article
explains the overall plan and the design of the first stage, which builds a registry of every file on every drive.

## The plan

The whole project has five stages. Only the first one is in scope for the first version of the tool:

1. **Inventory.** Scan a drive, NAS share or folder, record where it physically lives, and store every file with
   its relative path, size, modification time and checksum in a SQLite database.
2. **Duplicate analysis.** Once all drives are scanned, find out how many files are original and how much space
   they need.
3. **Target layout.** Decide whether everything fits on one drive or how to split it across several, and which
   files belong together.
4. **Classification.** Sort files into categories. Photos and videos will be structured by year and month, which
   the EXIF data (or the video metadata) provides without any guessing. For the many scans of bills and invoices,
   I plan to use Claude Haiku or Sonnet on [Amazon Bedrock](https://aws.amazon.com/bedrock/) to tell a scanned
   invoice from a family photo.
5. **Copy.** Copy the original files into the new structure and verify every copy against its checksum.

Please note, the tool never deletes or moves anything on the source drives. It only reads. The old drives stay as
they are until the new structure is complete and verified.

## Identifying a source

The first problem is to recognize a drive again. A drive letter is useless for this. If I plug in two different
USB drives one after the other, both of them will most likely show up as `E:`. A NAS share can be mapped to any
letter, or not at all.

Windows knows several identifiers for a drive, on different layers. Not all of them travel with the drive:

| Layer | Identifier | Travels with the drive | Remark |
|---|---|---|---|
| Physical disk | Model and serial number | Yes | Many USB enclosures report the serial of the USB bridge, or none at all |
| Partition table | GPT partition GUID | Yes | Written when the partition is created |
| Partition table | MBR disk signature + partition offset | Yes | For older drives with an MBR partition table |
| File system | Volume serial number | Yes | 64 bits on NTFS, 32 bits on FAT32 and exFAT, changes when the drive is formatted |
| Windows | Volume GUID path `\\?\Volume{...}\` | No | Assigned by the mount manager of each PC |

I am going to use the partition identifier together with the file system serial number as the fingerprint of a
drive. Both are stored on the drive itself, so it does not matter which PC, USB port or enclosure I use. A drive
which gets formatted gets a new fingerprint, which is correct, because its old content is gone anyway. The disk
model, serial number and bus type (USB, SATA or NVMe) are recorded as well, but only as information for me. On top
of that, I give each source a label of my own, such as "WD 2TB black", because a GUID does not tell me which drive
in the drawer is meant.

There is one case where the fingerprint is not unique: a drive which was cloned sector by sector carries the same
partition GUID and volume serial as the original. For this case, the tool can optionally write a small marker file
`.drivecat-id` with a random UUID into the root of the drive. This is the only time the tool writes to a source, and
only if I ask for it.

A NAS share is identified by its server and share name, for example `\\nas\photos`. The tool resolves a mapped
drive letter to this UNC path first. If the NAS is reached by IP address instead of its name, or gets renamed, the
two sources have to be merged by hand. I still have to check whether the volume serial number which Samba reports
for a share is stable enough to help here.

A source is always the whole drive or share. If I scan only a folder, the tool still records the paths relative to
the root of the drive, so a second scan of another folder on the same drive ends up in the same source.

## Choosing the checksum

To find duplicates, every file needs a checksum of its full content. The tool has to read every byte of every file
anyway, so the question is which algorithm keeps up with the drives.

The answer is that almost any algorithm does. A USB 3 hard drive delivers roughly 150 MB/s, a NAS behind a
Gigabit link at most around 110 MB/s, and an old USB 2 drive much less. A single CPU core computes SHA-256 several
times faster than that, in particular on CPUs with the [SHA extensions](https://en.wikipedia.org/wiki/Intel_SHA_extensions)
(Intel since Ice Lake, AMD since Zen). The drive is the bottleneck, not the checksum.

I chose [SHA-256](https://en.wikipedia.org/wiki/SHA-2) for the following reasons:

- With the SHA extensions it is not slower than SHA-1, which is broken and therefore no longer a good default.
- Standard tools compute the same value, `Get-FileHash` on Windows and `sha256sum` on the NAS. This allows me to
  verify any file without my own tool.
- [BLAKE3](https://en.wikipedia.org/wiki/BLAKE_(hash_function)#BLAKE3) would be faster, but as long as the drive is
  the bottleneck, this speed does not help.

It is worth mentioning what reading everything means in time: a 4 TB drive at 150 MB/s takes about seven and a half
hours. A scan must therefore survive an interruption. The tool commits its results in batches, and on a second run
it skips every file whose size and modification time have not changed since it was hashed.

## Choosing the language

I considered Node.js with TypeScript and Go. Keep in mind that the speed of the language matters less than one
might expect: the hashing in Node.js is done by OpenSSL, which is native code, and the drive is the bottleneck
anyway. I chose Go for other reasons:

- It builds a single executable without dependencies, which I can copy to any Windows PC.
- The Windows functions needed to identify a drive (volume information and the disk and partition `DeviceIoControl`
  queries) can be called directly from Go via `golang.org/x/sys/windows`. In Node.js I would have to call PowerShell
  for this.
- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) is a SQLite driver written in pure Go. No C compiler
  is needed.
- A pipeline of one directory walker, a few hashing workers and one database writer is straightforward to build
  with goroutines and channels.

### Installing Go

My PC already had an older Go version, installed some time ago with the official MSI installer from
[go.dev/dl](https://go.dev/dl/) into `C:\Program Files\Go`. The current SQLite driver requires a newer Go version,
so the first step was an upgrade. It is worth mentioning that winget recognizes an MSI installation as the package
`GoLang.Go`, even if it was not installed with winget. This means I could upgrade it in place:

```shell
PS C:\WINDOWS\system32> winget upgrade --id GoLang.Go -e
Found Go Programming Language [GoLang.Go] Version 1.27.4
This application is licensed to you by its owner.
Microsoft is not responsible for, nor does it grant any licenses to, third-party packages.
Downloading https://go.dev/dl/go1.27.4.windows-amd64.msi
  ██████████████████████████████  63.1 MB / 63.1 MB
Successfully verified installer hash
Starting package install...
Successfully installed
PS C:\WINDOWS\system32> go version
go version go1.27.4 windows/amd64
```

On a PC without Go, `winget install --id GoLang.Go -e` does the same. Both ask for administrator rights, because
the MSI installs for all users. The installation path stays the same, so there was no need to touch the `PATH`
variable.

(Note: Since Go 1.21, the `go` command can also download a newer toolchain by itself when a project requires it.
I prefer an installed version which I can see and update deliberately)

## The database

The database has three tables. `sources` holds one row per drive or share, `scans` one row per run of the tool,
and `files` one row per file:

```sql
CREATE TABLE sources (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,         -- 'disk' or 'smb'
  fingerprint  TEXT NOT NULL UNIQUE,  -- partition id + fs serial, or server/share
  label        TEXT NOT NULL,         -- my own name, e.g. 'WD 2TB black'
  bus_type     TEXT,                  -- USB, SATA, NVMe, SMB
  disk_model   TEXT,
  disk_serial  TEXT,
  disk_size    INTEGER,
  partition_id TEXT,                  -- GPT partition GUID or MBR signature + offset
  fs_type      TEXT,
  fs_serial    TEXT,
  fs_label     TEXT,
  smb_server   TEXT,
  smb_share    TEXT,
  marker_id    TEXT,                  -- UUID of the optional marker file
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);

CREATE TABLE scans (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES sources(id),
  root        TEXT NOT NULL,          -- scanned folder, relative to the source
  mounted_as  TEXT NOT NULL,          -- e.g. E:\ or \\nas\photos, information only
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL           -- running, done or aborted
);

CREATE TABLE files (
  id        INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  rel_path  TEXT NOT NULL,            -- relative to the source, '/' separated
  size      INTEGER NOT NULL,
  mtime     TEXT NOT NULL,
  sha256    BLOB,                     -- 32 bytes, NULL if the file was unreadable
  error     TEXT,
  scan_id   INTEGER NOT NULL REFERENCES scans(id),
  seen_at   TEXT NOT NULL,
  UNIQUE (source_id, rel_path)
);

CREATE INDEX files_sha256 ON files(sha256);
```

A file which was deleted from a drive since the last scan is recognized by a `seen_at` older than the latest
finished scan of its folder.

With this structure, the first question, how much of my data is actually original, is a single query:

```sql
SELECT
  (SELECT count(*)  FROM files WHERE sha256 IS NOT NULL) AS all_files,
  (SELECT sum(size) FROM files WHERE sha256 IS NOT NULL) AS all_bytes,
  count(*)  AS unique_files,
  sum(size) AS unique_bytes
FROM (
  SELECT sha256, max(size) AS size
  FROM files
  WHERE sha256 IS NOT NULL
  GROUP BY sha256
);
```

## Scanning

A few details decide whether a scan of an old drive runs through or stops after an hour:

- **Errors do not stop the scan.** A file which cannot be read is stored with its error message and without a
  checksum.
- **Junctions and symbolic links are not followed.** Otherwise a link can lead into another drive or into an
  endless loop.
- **System folders are skipped**, such as `$RECYCLE.BIN` and `System Volume Information`, as well as the snapshot
  folders of the NAS.
- **Cloud placeholders are skipped.** Reading a OneDrive file which is only online would download it first.
- **Paths are stored in one form.** The separator is `/`, and file names are normalized to Unicode NFC, because
  files copied from a Mac are often stored in NFD and would otherwise not match.
- **One reader per hard drive.** Several parallel reads make the head of a spinning drive jump back and forth,
  which is slower than reading one file after the other. On SSDs and NAS shares, a few parallel workers help. The
  tool asks Windows whether a drive has a seek penalty and picks the default accordingly.
- **Long paths** beyond 260 characters are common on old backup drives. Go handles them on Windows by itself.

The tool will offer these commands:

```shell
drivecat identify E:\
drivecat scan E:\ --label "WD 2TB black"
drivecat scan \\nas\photos --label "NAS photos"
drivecat sources
drivecat report
```

`identify` shows what the tool would record for a path, without scanning anything. `report` runs the query
above, per source and overall.

## Summary

The first version of `drivecat` reads every drive I own once, recognizes it again by identifiers stored on the
drive itself, and records every file with its SHA-256 checksum in SQLite. The next part will cover the
implementation and the real numbers from the first drives.
